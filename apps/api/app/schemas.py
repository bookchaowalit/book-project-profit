"""Request schemas (strict) for the v1 API."""

from __future__ import annotations

import datetime as dt
import re
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

from app.money import MONEY_PATTERN

_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
Money = Annotated[str, Field(pattern=MONEY_PATTERN, max_length=16)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ClientName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Currency = Literal["THB", "USD", "EUR", "GBP", "JPY"]
Status = Literal["active", "completed", "archived"]


def _parse_date(v: object) -> object:
    """Accept only YYYY-MM-DD strings (FastAPI validates in python mode)."""
    if isinstance(v, str):
        if not _DATE_RE.match(v):
            raise ValueError("invalid date")
        return dt.date.fromisoformat(v)
    raise ValueError("invalid date")


StrictDate = Annotated[dt.date, BeforeValidator(_parse_date)]


def _check_date(v: dt.date) -> dt.date:
    if not 1970 <= v.year <= 2200:
        raise ValueError("date out of range")
    return v


def _positive(v: str | None) -> str | None:
    if v is not None and int(v) <= 0:
        raise ValueError("must be greater than zero")
    return v


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class WorkspaceCreate(_Body):
    name: Name


class ProjectCreate(_Body):
    name: Name
    client_name: ClientName
    currency: Currency
    contract_value_minor: Money
    hourly_cost_minor: Money


class ProjectPatch(_Body):
    name: Name | None = None
    client_name: ClientName | None = None
    contract_value_minor: Money | None = None
    hourly_cost_minor: Money | None = None
    status: Status | None = None


class TimeEntryCreate(_Body):
    worked_on: StrictDate
    minutes: Annotated[int, Field(strict=True, ge=1, le=1440)]
    hourly_cost_minor: Money | None = None
    note: Note | None = None

    _d = field_validator("worked_on")(_check_date)


class ExpenseCreate(_Body):
    spent_on: StrictDate
    amount_minor: Money
    description: Description

    _d = field_validator("spent_on")(_check_date)
    _p = field_validator("amount_minor")(_positive)


class PaymentCreate(_Body):
    received_on: StrictDate
    amount_minor: Money
    note: Note | None = None

    _d = field_validator("received_on")(_check_date)
    _p = field_validator("amount_minor")(_positive)
