"""Engine/session construction with bounded pools."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.errors import AppError


def make_engine(settings: Settings) -> Engine | None:
    if settings.database_url is None:
        return None
    return create_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={
            "connect_timeout": 5,
            "options": f"-c statement_timeout={settings.db_statement_timeout_ms}",
        },
    )


def get_session(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] | None = request.app.state.session_factory
    if factory is None:
        raise AppError(503, "service_unavailable", "Database is not configured")
    session = factory()
    try:
        yield session
    finally:
        session.close()  # rolls back anything not committed


def get_read_session(request: Request) -> Iterator[Session]:
    """Session for GET handlers: one REPEATABLE READ, read-only snapshot.

    Metadata, counts and financial aggregates of a response are read by several
    statements; under READ COMMITTED a concurrent commit between them could make
    a response contradict itself. Read-only snapshot transactions never raise
    serialization failures, so no retry loop is needed. Writes keep READ
    COMMITTED (their idempotency claim relies on it). The isolation level must
    be applied before the transaction's first statement, hence it is set here.
    """
    factory: sessionmaker[Session] | None = request.app.state.session_factory
    if factory is None:
        raise AppError(503, "service_unavailable", "Database is not configured")
    session = factory()
    try:
        session.connection(
            execution_options={"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}
        )
        yield session
    finally:
        session.close()
