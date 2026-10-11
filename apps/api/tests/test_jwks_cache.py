from __future__ import annotations

from typing import Any

import pytest

from app import auth
from app.auth import JWKSCache, JWKSUnavailable
from app.config import AuthSettings


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make(ttl: int = 60, refresh: int = 10) -> tuple[JWKSCache, Clock, dict[str, Any]]:
    clock = Clock()
    state: dict[str, Any] = {"fail": False, "calls": 0, "keys": {"k1": object()}}
    cache = JWKSCache(
        AuthSettings("https://idp.test/jwks", "i", "a", 0, 1.0, ttl, refresh), clock=clock
    )

    def fetch() -> dict[str, Any]:
        state["calls"] += 1
        if state["fail"]:
            raise JWKSUnavailable
        return dict(state["keys"])

    cache._fetch = fetch  # type: ignore[method-assign]
    return cache, clock, state


def test_fresh_cache_served_without_refetch() -> None:
    cache, clock, state = make()
    key = cache.get("k1")
    clock.t += 59
    assert cache.get("k1") is key and state["calls"] == 1


def test_fresh_cache_longer_than_stale_limit_is_not_invalidated() -> None:
    cache, clock, state = make(ttl=7200)
    key = cache.get("k1")
    state["fail"] = True
    clock.t += auth.MAX_STALE_SECONDS + 500  # older than the outage limit, still fresh
    assert cache.get("k1") is key and state["calls"] == 1


def test_outage_stale_allowed_within_grace() -> None:
    cache, clock, state = make(ttl=60, refresh=10)
    key = cache.get("k1")
    state["fail"] = True
    clock.t += 100  # expired, refresh fails, inside grace
    assert cache.get("k1") is key
    clock.t += 5  # inside the cooldown, still inside grace
    assert cache.get("k1") is key
    with pytest.raises(JWKSUnavailable):  # outage: unknown kid is not a plain 401
        cache.get("other")


def test_too_stale_refused_on_every_call_inside_cooldown() -> None:
    cache, clock, state = make(ttl=60, refresh=10)
    cache.get("k1")
    state["fail"] = True
    clock.t = 1000 + 60 + auth.MAX_STALE_SECONDS + 1
    calls_before = state["calls"]
    for _ in range(5):
        with pytest.raises(JWKSUnavailable):
            cache.get("k1")
        clock.t += 1
    assert state["calls"] == calls_before + 1  # cooldown honoured, stale key never served


def test_recovery_after_outage() -> None:
    cache, clock, state = make(ttl=60, refresh=10)
    cache.get("k1")
    state["fail"] = True
    clock.t += auth.MAX_STALE_SECONDS + 1000
    with pytest.raises(JWKSUnavailable):
        cache.get("k1")
    state["fail"] = False
    clock.t += 11
    assert cache.get("k1") is not None


def test_unknown_kid_with_healthy_provider_is_keyerror() -> None:
    cache, clock, _ = make()
    cache.get("k1")
    clock.t += 11
    with pytest.raises(KeyError):
        cache.get("nope")
