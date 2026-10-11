from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from starlette.types import Message, Scope

from app.config import Settings
from app.errors import MAX_BODY_BYTES
from app.main import create_app

REQUEST_ID = "body-limit-test"


def body_of_size(size: int) -> bytes:
    return b'{"name":"' + b"x" * (size - 11) + b'"}'


@pytest.mark.parametrize("declared", [MAX_BODY_BYTES + 1, 10 * MAX_BODY_BYTES])
def test_oversized_declared_body_rejected_before_auth(declared: int) -> None:
    with TestClient(create_app(Settings.from_env({}))) as client:
        response = client.post(
            "/v1/workspaces",
            content=b"{}",
            headers={"Content-Length": str(declared), "X-Request-ID": REQUEST_ID},
        )
    assert response.status_code == 413
    assert response.json()["error"] == {
        "code": "validation_error",
        "message": "Request body too large",
        "request_id": REQUEST_ID,
    }
    assert response.headers["x-request-id"] == REQUEST_ID


def test_exact_body_boundary_reaches_authentication() -> None:
    with TestClient(create_app(Settings.from_env({}))) as client:
        response = client.post("/v1/workspaces", content=body_of_size(MAX_BODY_BYTES))
    assert response.status_code == 401


@pytest.mark.parametrize("declared", [None, b"1"])
def test_stream_is_bounded_without_trusting_content_length(declared: bytes | None) -> None:
    app = create_app(Settings.from_env({}))
    body = body_of_size(3 * MAX_BODY_BYTES)
    chunk_size = 16 * 1024
    messages: list[Message] = []
    reads = 0
    headers = [(b"content-type", b"application/json"), (b"x-request-id", REQUEST_ID.encode())]
    if declared is not None:
        headers.append((b"content-length", declared))
    scope: Scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/workspaces",
        "raw_path": b"/v1/workspaces",
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
    }

    async def receive() -> Message:
        nonlocal reads
        start = reads * chunk_size
        reads += 1
        return {
            "type": "http.request",
            "body": body[start : start + chunk_size],
            "more_body": start + chunk_size < len(body),
        }

    async def send(message: Message) -> None:
        messages.append(message)

    asyncio.run(app(scope, receive, send))
    start = next(message for message in messages if message["type"] == "http.response.start")
    assert start["status"] == 413
    assert reads == MAX_BODY_BYTES // chunk_size + 1
    envelope = json.loads(
        b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )
    )
    assert envelope["error"]["code"] == "validation_error"
    assert envelope["error"]["request_id"] == REQUEST_ID
    assert (b"x-request-id", REQUEST_ID.encode()) in start["headers"]


@pytest.mark.parametrize("value", ["-1", "invalid"])
def test_invalid_content_length_is_explicit(value: str) -> None:
    with TestClient(create_app(Settings.from_env({}))) as client:
        response = client.post("/v1/workspaces", content=b"{}", headers={"Content-Length": value})
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "Invalid content length"
