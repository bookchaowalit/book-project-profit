"""Explicit release command: ``python -m app.migrate`` (alias for ``alembic upgrade head``)."""

import os
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import ConfigError, normalize_database_url


def main() -> int:
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    try:
        url = normalize_database_url(raw)
    except ConfigError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")
    print("migrations applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
