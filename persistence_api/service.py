from __future__ import annotations

import json
import logging
from datetime import UTC

from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from persistence_api.config import ApiSettings
from persistence_api.repository import (
    IdempotencyConflict,
    InteractionRepository,
    render_human_readable,
)
from persistence_api.schemas import (
    InteractionHistoryItem,
    InteractionHistoryResponse,
    PersistenceRequest,
    PersistenceResponse,
    calculate_payload_hash,
)

logger = logging.getLogger(__name__)


class PayloadHashMismatch(RuntimeError):
    pass


class PayloadTooLarge(RuntimeError):
    pass


class PersistenceFailure(RuntimeError):
    pass


class DatabaseUnavailable(PersistenceFailure):
    pass


class PersistenceService:
    def __init__(self, settings: ApiSettings, engine: Engine) -> None:
        self._settings = settings
        self._repository = InteractionRepository(engine)

    def save(self, request: PersistenceRequest) -> PersistenceResponse:
        if len(request.user_input) > self._settings.max_input_chars:
            raise ValueError("user_input exceeds the configured limit.")
        result_bytes = json.dumps(
            request.result_json, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
        if len(result_bytes) > self._settings.max_result_bytes:
            raise PayloadTooLarge("result_json exceeds the configured limit.")
        metadata_bytes = json.dumps(
            request.metadata, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
        if len(metadata_bytes) > self._settings.max_request_bytes:
            raise PayloadTooLarge("metadata exceeds the configured limit.")

        if request.agent_name != self._settings.agent_name or (
            request.agent_version != self._settings.agent_version
        ):
            raise ValueError("Agent identity does not match the persistence API configuration.")
        if (
            request.schema_version != self._settings.schema_version
            or request.result_json.get("schema_version") != self._settings.schema_version
        ):
            raise ValueError("Result schema version does not match persistence configuration.")

        server_payload_hash = calculate_payload_hash(request)
        if server_payload_hash != request.payload_hash:
            raise PayloadHashMismatch("payload_hash does not match the canonical request.")

        try:
            response = self._repository.save(
                request,
                server_payload_hash=server_payload_hash,
                agent_response=render_human_readable(request),
            )
        except IdempotencyConflict:
            raise
        except OperationalError as exc:
            logger.error(
                "Database connection failed",
                extra={
                    "request_id": str(request.request_id),
                    "agent_name": self._settings.agent_name,
                    "error_code": "database_unavailable",
                },
            )
            raise DatabaseUnavailable("Database is temporarily unavailable.") from exc
        except SQLAlchemyError as exc:
            logger.error(
                "Database persistence failed",
                extra={
                    "request_id": str(request.request_id),
                    "agent_name": self._settings.agent_name,
                    "error_code": "database_error",
                },
            )
            raise PersistenceFailure("Database transaction failed.") from exc

        logger.info(
            "Agent interaction persisted",
            extra={
                "request_id": str(response.request_id),
                "interaction_id": str(response.interaction_id),
                "agent_name": self._settings.agent_name,
                "agent_version": self._settings.agent_version,
                "prompt_version": request.prompt_version,
                "prompt_hash": request.prompt_hash,
                "schema_version": request.schema_version,
                "duration_ms": request.duration_ms,
                "input_tokens": request.input_tokens,
                "output_tokens": request.output_tokens,
                "status": "completed",
                "duplicate": response.duplicate,
            },
        )
        return response

    def list_interactions(self, *, limit: int, offset: int) -> InteractionHistoryResponse:
        try:
            items, has_more = self._repository.list_interactions(limit=limit, offset=offset)
        except OperationalError as exc:
            logger.error("Database connection failed", extra={"error_code": "database_unavailable"})
            raise DatabaseUnavailable("Database is temporarily unavailable.") from exc
        except SQLAlchemyError as exc:
            logger.error("Database query failed", extra={"error_code": "database_error"})
            raise PersistenceFailure("Database query failed.") from exc

        return InteractionHistoryResponse(
            items=[InteractionHistoryItem.model_validate(item) for item in items],
            limit=limit,
            offset=offset,
            has_more=has_more,
        )

    def delete_expired(self) -> int:
        from datetime import datetime, timedelta

        if self._settings.retention_days == 0:
            return 0
        cutoff = datetime.now(UTC) - timedelta(days=self._settings.retention_days)
        try:
            return self._repository.delete_before(cutoff)
        except SQLAlchemyError as exc:
            logger.error("Retention cleanup failed", extra={"error_code": "retention_error"})
            raise PersistenceFailure("Retention cleanup failed.") from exc
