"""Pure financial rules. Money is integer minor units; no floats anywhere."""

from __future__ import annotations

import re
from dataclasses import dataclass

CURRENCY_EXPONENT: dict[str, int] = {"THB": 2, "USD": 2, "EUR": 2, "GBP": 2, "JPY": 0}
MONEY_PATTERN = r"^(0|[1-9][0-9]{0,14})$"
MONEY_RE = re.compile(MONEY_PATTERN)


def labor_minor(minutes: int, hourly_minor: int) -> int:
    """round-half-up(minutes * hourly / 60) for non-negative inputs."""
    return (minutes * hourly_minor + 30) // 60


def div_round_half_away(numerator: int, denominator: int) -> int:
    """Integer division rounded half away from zero (denominator must be > 0)."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    q, r = divmod(abs(numerator), denominator)
    if 2 * r >= denominator:
        q += 1
    return -q if numerator < 0 else q


@dataclass(frozen=True)
class Totals:
    received: int
    expense: int
    labor: int
    minutes: int
    contract: int = 0

    @property
    def cash_surplus(self) -> int:
        return self.received - self.expense

    @property
    def actual_profit(self) -> int:
        return self.received - self.expense - self.labor

    @property
    def projected_profit(self) -> int:
        return self.contract - self.expense - self.labor

    @property
    def profit_per_hour(self) -> int | None:
        if self.minutes == 0:
            return None
        return div_round_half_away(self.actual_profit * 60, self.minutes)

    @property
    def margin_hundredths(self) -> int | None:
        """100 * profit / received in hundredths of a percent."""
        if self.received == 0:
            return None
        return div_round_half_away(self.actual_profit * 10_000, self.received)


def format_hundredths(value: int) -> str:
    sign = "-" if value < 0 else ""
    q, r = divmod(abs(value), 100)
    return f"{sign}{q}.{r:02d}"


def summary_dict(t: Totals) -> dict[str, str | int | None]:
    pph = t.profit_per_hour
    margin = t.margin_hundredths
    return {
        "received_minor": str(t.received),
        "expense_minor": str(t.expense),
        "labor_cost_minor": str(t.labor),
        "cash_surplus_minor": str(t.cash_surplus),
        "actual_profit_minor": str(t.actual_profit),
        "projected_profit_minor": str(t.projected_profit),
        "total_minutes": t.minutes,
        "profit_per_hour_minor": None if pph is None else str(pph),
        "margin_percent": None if margin is None else format_hundredths(margin),
    }
