from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_dockerfile_is_non_root_and_does_not_migrate_on_start() -> None:
    text = (ROOT / "Dockerfile").read_text()
    assert "USER 10001" in text
    cmd = text.split("CMD", 1)[1]
    assert "app.main:app_factory" in cmd and "--factory" in cmd
    assert "alembic" not in cmd and "app.migrate" not in cmd


def test_migrate_entrypoint_and_alembic_files_ship_in_image() -> None:
    text = (ROOT / "Dockerfile").read_text()
    for needle in ("COPY alembic.ini", "COPY migrations", "COPY app"):
        assert needle in text
    assert (ROOT / "app" / "migrate.py").is_file()


def test_no_obsolete_railway_descriptor() -> None:
    assert not (ROOT / "railway.json").exists()
