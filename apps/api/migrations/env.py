"""Alembic environment. URL comes from the caller (attributes) or DATABASE_URL."""

import os

from alembic import context
from sqlalchemy import create_engine

from app.config import normalize_database_url
from app.models import Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    url = config.attributes.get("database_url") or os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    return normalize_database_url(str(url))


def run() -> None:
    engine = create_engine(_url())
    try:
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=target_metadata)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


run()
