from __future__ import annotations

import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import pytest
from sqlalchemy import create_engine, text

from persistence_api.models import Base
from persistence_api.repository import IdempotencyConflict, InteractionRepository
from persistence_api.schemas import PersistenceRequest

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.mark.integration
@pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="Set TEST_DATABASE_URL to an isolated PostgreSQL test DB."
)
def test_concurrent_identical_requests_commit_once() -> None:
    assert TEST_DATABASE_URL is not None
    database_name = TEST_DATABASE_URL.rsplit("/", 1)[-1].split("?", 1)[0]
    if not re.search(r"(^|[_-])test([_-]|$)", database_name, flags=re.IGNORECASE):
        pytest.fail("TEST_DATABASE_URL database name must contain a standalone 'test' token.")
    if os.getenv("ALLOW_TEST_DB_DDL") != "true":
        pytest.fail("Set ALLOW_TEST_DB_DDL=true only for a disposable test database.")
    hostname = urlparse(TEST_DATABASE_URL).hostname
    if (
        hostname not in {"localhost", "127.0.0.1", "::1"}
        and os.getenv("ALLOW_REMOTE_TEST_DB_DDL") != "true"
    ):
        pytest.fail(
            "Remote PostgreSQL DDL requires ALLOW_REMOTE_TEST_DB_DDL=true after confirming "
            "the target is disposable."
        )

    schema = f"it_agent_{uuid.uuid4().hex}"
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"options": f"-c search_path={schema},public"},
        pool_size=5,
    )
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        Base.metadata.create_all(engine)
        repository = InteractionRepository(engine)
        request_id = uuid.uuid4()
        request = PersistenceRequest(
            request_id=request_id,
            user_input="same request",
            result_json={"schema_version": "generic-v1", "result": {"answer": "ok"}},
            agent_name="test-agent",
            agent_version="test",
            prompt_version="test-v1",
            prompt_hash="a" * 64,
            schema_version="generic-v1",
            metadata=None,
            payload_hash="b" * 64,
        )

        def insert_one():
            return repository.save(
                request,
                server_payload_hash="b" * 64,
                agent_response="ok",
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: insert_one(), range(2)))

        assert len({item.interaction_id for item in results}) == 1
        assert sorted(item.duplicate for item in results) == [False, True]

        conflicting = request.model_copy(update={"user_input": "different"})
        with pytest.raises(IdempotencyConflict):
            repository.save(
                conflicting,
                server_payload_hash="c" * 64,
                agent_response="different",
            )
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()
