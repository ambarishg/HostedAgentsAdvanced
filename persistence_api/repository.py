from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import Engine, delete, func, select, true
from sqlalchemy.dialects.postgresql import insert

from persistence_api.models import AgentInteraction
from persistence_api.schemas import PersistenceRequest, PersistenceResponse


class IdempotencyConflict(RuntimeError):
    pass


class InteractionRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def save(
        self, request: PersistenceRequest, *, server_payload_hash: str, agent_response: str
    ) -> PersistenceResponse:
        values = {
            "id": uuid.uuid4(),
            "request_id": request.request_id,
            "agent_name": request.agent_name,
            "agent_version": request.agent_version,
            "prompt_version": request.prompt_version,
            "prompt_hash": request.prompt_hash,
            "schema_version": request.schema_version,
            "user_input": request.user_input,
            "result_json": request.result_json,
            "agent_response": agent_response,
            "metadata_json": request.metadata,
            "status": "completed",
            "error_code": None,
            "completed_at": datetime.now(UTC),
            "duration_ms": request.duration_ms,
            "input_tokens": request.input_tokens,
            "output_tokens": request.output_tokens,
            "provider_response_id": request.provider_response_id,
            "payload_hash": server_payload_hash,
        }

        with self._engine.begin() as connection:
            inserted_id = connection.execute(
                insert(AgentInteraction)
                .values(**values)
                .on_conflict_do_nothing(index_elements=[AgentInteraction.request_id])
                .returning(AgentInteraction.id)
            ).scalar_one_or_none()
            if inserted_id is not None:
                return PersistenceResponse(
                    interaction_id=inserted_id,
                    request_id=request.request_id,
                    duplicate=False,
                )

            existing = connection.execute(
                select(AgentInteraction.id, AgentInteraction.payload_hash).where(
                    AgentInteraction.request_id == request.request_id
                )
            ).one_or_none()
            if existing is None:
                raise RuntimeError("Conflicting request was not visible after database insert.")
            if existing.payload_hash != server_payload_hash:
                raise IdempotencyConflict(
                    "request_id has already been used for a different payload."
                )
            return PersistenceResponse(
                interaction_id=existing.id,
                request_id=request.request_id,
                duplicate=True,
            )

    def delete_before(self, cutoff: datetime) -> int:
        with self._engine.begin() as connection:
            result = connection.execute(
                delete(AgentInteraction).where(AgentInteraction.created_at < cutoff)
            )
            return result.rowcount or 0

    def list_interactions(self, *, limit: int, offset: int) -> tuple[list[dict[str, Any]], bool]:
        statement = (
            select(
                AgentInteraction.request_id,
                AgentInteraction.agent_name,
                AgentInteraction.user_input,
                AgentInteraction.result_json,
            )
            .order_by(AgentInteraction.created_at.desc(), AgentInteraction.id.desc())
            .limit(limit + 1)
            .offset(offset)
        )
        with self._engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        has_more = len(rows) > limit
        return [dict(row) for row in rows[:limit]], has_more

    def pcr_analytics(
        self,
        *,
        start_date: date | None,
        end_date: date | None,
        contact_reasons: list[str],
    ) -> list[dict[str, Any]]:
        reason = AgentInteraction.result_json["result"]["primary_contact_reason"].astext
        statement = (
            select(reason.label("reason"), func.count(AgentInteraction.id).label("count"))
            .where(AgentInteraction.status == "completed", reason.is_not(None))
            .group_by(reason)
            .order_by(func.count(AgentInteraction.id).desc(), reason.asc())
        )
        if start_date is not None:
            statement = statement.where(
                AgentInteraction.created_at >= datetime.combine(start_date, time.min, tzinfo=UTC)
            )
        if end_date is not None:
            statement = statement.where(
                AgentInteraction.created_at
                < datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=UTC)
            )
        if contact_reasons:
            statement = statement.where(reason.in_(contact_reasons))

        with self._engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        return [dict(row) for row in rows]

    def demand_driver_analytics(
        self,
        *,
        start_date: date | None,
        end_date: date | None,
        categories: list[str],
    ) -> list[dict[str, Any]]:
        demand_driver = AgentInteraction.result_json["result"]["demand_driver"].astext
        statement = (
            select(demand_driver.label("reason"), func.count(AgentInteraction.id).label("count"))
            .where(AgentInteraction.status == "completed", demand_driver.is_not(None))
            .group_by(demand_driver)
            .order_by(func.count(AgentInteraction.id).desc(), demand_driver.asc())
        )
        if start_date is not None:
            statement = statement.where(
                AgentInteraction.created_at >= datetime.combine(start_date, time.min, tzinfo=UTC)
            )
        if end_date is not None:
            statement = statement.where(
                AgentInteraction.created_at
                < datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=UTC)
            )
        if categories:
            statement = statement.where(demand_driver.in_(categories))

        with self._engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        return [dict(row) for row in rows]

    def vulnerability_analytics(
        self,
        *,
        start_date: date | None,
        end_date: date | None,
        categories: list[str],
    ) -> list[dict[str, Any]]:
        category_values = AgentInteraction.result_json["result"]["vulnerability_assessment"][
            "vulnerability_indicator_category"
        ]
        category_rows = (
            func.jsonb_array_elements_text(category_values)
            .table_valued("category")
            .render_derived(name="vulnerability_categories")
        )
        category = category_rows.c.category
        statement = (
            select(category.label("reason"), func.count(AgentInteraction.id).label("count"))
            .select_from(AgentInteraction)
            .join(category_rows, true())
            .where(AgentInteraction.status == "completed", category.is_not(None))
            .group_by(category)
            .order_by(func.count(AgentInteraction.id).desc(), category.asc())
        )
        if start_date is not None:
            statement = statement.where(
                AgentInteraction.created_at >= datetime.combine(start_date, time.min, tzinfo=UTC)
            )
        if end_date is not None:
            statement = statement.where(
                AgentInteraction.created_at
                < datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=UTC)
            )
        if categories:
            statement = statement.where(category.in_(categories))

        with self._engine.connect() as connection:
            rows = connection.execute(statement).mappings().all()
        return [dict(row) for row in rows]


def render_human_readable(request: PersistenceRequest) -> str:
    if request.result_json.get("summary"):
        return str(request.result_json["summary"])
    return json.dumps(request.result_json["result"], ensure_ascii=False, indent=2)
