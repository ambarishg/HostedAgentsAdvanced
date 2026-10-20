from __future__ import annotations

import json
import logging
from datetime import date
from functools import lru_cache
from typing import Any, get_args

import azure.functions as func
from pydantic import ValidationError

from hosted_agent.schemas import ContactReason
from persistence_api.auth import AuthenticationError, EntraTokenValidator
from persistence_api.config import ApiSettings, get_settings
from persistence_api.database import get_engine
from persistence_api.repository import IdempotencyConflict
from persistence_api.schemas import ErrorResponse, PersistenceRequest
from persistence_api.service import (
    DatabaseUnavailable,
    PayloadHashMismatch,
    PayloadTooLarge,
    PersistenceFailure,
    PersistenceService,
)

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _token_validator() -> EntraTokenValidator:
    return EntraTokenValidator(get_settings())


@lru_cache(maxsize=1)
def _persistence_service() -> PersistenceService:
    return PersistenceService(get_settings(), get_engine())


def _json_response(body: Any, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, ensure_ascii=False, separators=(",", ":")),
        status_code=status_code,
        mimetype="application/json",
    )


def _error(code: str, message: str, status_code: int) -> func.HttpResponse:
    return _json_response(
        ErrorResponse(error={"code": code, "message": message}).model_dump(mode="json"),
        status_code,
    )


@app.route(route="pcr-results", methods=["POST"])
def save_pcr_result(req: func.HttpRequest) -> func.HttpResponse:
    try:
        settings: ApiSettings = get_settings()
    except (ValueError, OSError):
        logger.exception(
            "Persistence API configuration failed", extra={"error_code": "config_error"}
        )
        return _error("configuration_error", "Persistence API is not configured.", 500)

    try:
        _token_validator().validate(req.headers.get("Authorization"))
    except AuthenticationError as exc:
        logger.warning(
            "Persistence API rejected caller",
            extra={"error_code": exc.code, "status_code": exc.status_code},
        )
        return _error(exc.code, "Caller authentication or authorization failed.", exc.status_code)

    body = req.get_body()
    if len(body) > settings.max_request_bytes:
        return _error("request_too_large", "Request body exceeds the configured limit.", 413)
    try:
        payload = PersistenceRequest.model_validate_json(body)
    except ValidationError:
        return _error("invalid_request", "Request body does not match the persistence schema.", 422)

    try:
        result = _persistence_service().save(payload)
    except PayloadHashMismatch:
        return _error(
            "payload_hash_mismatch", "payload_hash does not match the validated payload.", 422
        )
    except PayloadTooLarge as exc:
        return _error("payload_too_large", str(exc), 413)
    except IdempotencyConflict:
        return _error(
            "idempotency_conflict", "request_id is already used by a different payload.", 409
        )
    except ValueError:
        return _error(
            "invalid_request", "Request does not match configured persistence limits.", 422
        )
    except DatabaseUnavailable:
        return _error(
            "database_unavailable", "Persistence service is temporarily unavailable.", 503
        )
    except PersistenceFailure:
        return _error("persistence_failed", "The database transaction did not complete.", 500)

    status = 200 if result.duplicate else 201
    return _json_response(result.model_dump(mode="json"), status)


@app.route(route="agent-interactions", methods=["GET"])
def list_agent_interactions(req: func.HttpRequest) -> func.HttpResponse:
    try:
        get_settings()
    except (ValueError, OSError):
        logger.exception(
            "Persistence API configuration failed", extra={"error_code": "config_error"}
        )
        return _error("configuration_error", "Persistence API is not configured.", 500)

    try:
        _token_validator().validate(req.headers.get("Authorization"))
    except AuthenticationError as exc:
        logger.warning(
            "Persistence API rejected caller",
            extra={"error_code": exc.code, "status_code": exc.status_code},
        )
        return _error(exc.code, "Caller authentication or authorization failed.", exc.status_code)

    try:
        limit = int(req.params.get("limit", "100"))
        offset = int(req.params.get("offset", "0"))
    except ValueError:
        return _error("invalid_pagination", "limit and offset must be integers.", 400)
    if not 1 <= limit <= 100 or offset < 0:
        return _error(
            "invalid_pagination",
            "limit must be between 1 and 100 and offset must not be negative.",
            400,
        )

    try:
        result = _persistence_service().list_interactions(limit=limit, offset=offset)
    except DatabaseUnavailable:
        return _error(
            "database_unavailable", "Persistence service is temporarily unavailable.", 503
        )
    except PersistenceFailure:
        return _error("persistence_failed", "The database query did not complete.", 500)

    return _json_response(result.model_dump(mode="json"), 200)


@app.route(route="pcr-analytics", methods=["GET"])
def get_pcr_analytics(req: func.HttpRequest) -> func.HttpResponse:
    try:
        get_settings()
    except (ValueError, OSError):
        logger.exception(
            "Persistence API configuration failed", extra={"error_code": "config_error"}
        )
        return _error("configuration_error", "Persistence API is not configured.", 500)

    try:
        _token_validator().validate(req.headers.get("Authorization"))
    except AuthenticationError as exc:
        logger.warning(
            "Persistence API rejected caller",
            extra={"error_code": exc.code, "status_code": exc.status_code},
        )
        return _error(exc.code, "Caller authentication or authorization failed.", exc.status_code)

    try:
        start_date = (
            date.fromisoformat(req.params["start_date"]) if req.params.get("start_date") else None
        )
        end_date = (
            date.fromisoformat(req.params["end_date"]) if req.params.get("end_date") else None
        )
    except ValueError:
        return _error("invalid_date_range", "Dates must use the YYYY-MM-DD format.", 400)
    if start_date is not None and end_date is not None and start_date > end_date:
        return _error("invalid_date_range", "start_date must not be after end_date.", 400)

    contact_reasons = [
        reason.strip()
        for reason in req.params.get("contact_reasons", "").split(",")
        if reason.strip()
    ]
    valid_reasons = {*get_args(ContactReason), "Not identified"}
    if any(reason not in valid_reasons for reason in contact_reasons):
        return _error("invalid_contact_reason", "One or more contact reasons are invalid.", 400)
    contact_reasons = list(dict.fromkeys(contact_reasons))

    try:
        result = _persistence_service().pcr_analytics(
            start_date=start_date,
            end_date=end_date,
            contact_reasons=contact_reasons,
        )
    except DatabaseUnavailable:
        return _error(
            "database_unavailable", "Persistence service is temporarily unavailable.", 503
        )
    except PersistenceFailure:
        return _error("persistence_failed", "The database query did not complete.", 500)

    return _json_response(result.model_dump(mode="json"), 200)


@app.route(route="demand-driver-analytics", methods=["GET"])
def get_demand_driver_analytics(req: func.HttpRequest) -> func.HttpResponse:
    try:
        get_settings()
    except (ValueError, OSError):
        logger.exception(
            "Persistence API configuration failed", extra={"error_code": "config_error"}
        )
        return _error("configuration_error", "Persistence API is not configured.", 500)

    try:
        _token_validator().validate(req.headers.get("Authorization"))
    except AuthenticationError as exc:
        logger.warning(
            "Persistence API rejected caller",
            extra={"error_code": exc.code, "status_code": exc.status_code},
        )
        return _error(exc.code, "Caller authentication or authorization failed.", exc.status_code)

    try:
        start_date = (
            date.fromisoformat(req.params["start_date"]) if req.params.get("start_date") else None
        )
        end_date = (
            date.fromisoformat(req.params["end_date"]) if req.params.get("end_date") else None
        )
    except ValueError:
        return _error("invalid_date_range", "Dates must use the YYYY-MM-DD format.", 400)
    if start_date is not None and end_date is not None and start_date > end_date:
        return _error("invalid_date_range", "start_date must not be after end_date.", 400)

    contact_reasons = [
        reason.strip()
        for reason in req.params.get("contact_reasons", "").split(",")
        if reason.strip()
    ]
    valid_reasons = {*get_args(ContactReason), "Not identified"}
    if any(reason not in valid_reasons for reason in contact_reasons):
        return _error("invalid_contact_reason", "One or more contact reasons are invalid.", 400)
    contact_reasons = list(dict.fromkeys(contact_reasons))

    try:
        result = _persistence_service().demand_driver_analytics(
            start_date=start_date,
            end_date=end_date,
            contact_reasons=contact_reasons,
        )
    except DatabaseUnavailable:
        return _error(
            "database_unavailable", "Persistence service is temporarily unavailable.", 503
        )
    except PersistenceFailure:
        return _error("persistence_failed", "The database query did not complete.", 500)

    return _json_response(result.model_dump(mode="json"), 200)


@app.timer_trigger(schedule="0 0 3 * * *", arg_name="timer", run_on_startup=False)
def retention_cleanup(timer: func.TimerRequest) -> None:
    settings = get_settings()
    if settings.retention_days == 0:
        logger.info("Interaction retention cleanup is disabled.")
        return
    try:
        deleted = _persistence_service().delete_expired()
    except PersistenceFailure:
        logger.error("Retention cleanup failed", extra={"error_code": "retention_error"})
        return
    logger.info(
        "Interaction retention cleanup completed",
        extra={"deleted_count": deleted, "retention_days": settings.retention_days},
    )
