import pytest

from app.money import Totals, div_round_half_away, format_hundredths, labor_minor, summary_dict


def test_labor_rounds_half_up_per_entry() -> None:
    assert labor_minor(1, 30) == 1  # 0.5 -> 1
    assert labor_minor(1, 29) == 0  # 0.483 -> 0
    assert labor_minor(1, 89) == 1  # 1.48
    assert labor_minor(1, 90) == 2  # 1.5 -> 2
    assert labor_minor(60, 6000) == 6000
    assert labor_minor(90, 0) == 0


def test_sum_of_rounded_entries_differs_from_rounded_sum() -> None:
    assert sum(labor_minor(1, 30) for _ in range(2)) == 2  # not round(1.0)=1


def test_division_half_away_from_zero() -> None:
    assert div_round_half_away(5, 2) == 3
    assert div_round_half_away(-5, 2) == -3
    assert div_round_half_away(-4, 3) == -1
    assert div_round_half_away(0, 7) == 0
    with pytest.raises(ValueError):
        div_round_half_away(1, 0)


def test_profit_formulas_and_negatives() -> None:
    t = Totals(received=1000, expense=2500, labor=500, minutes=90, contract=10_000)
    assert t.cash_surplus == -1500
    assert t.actual_profit == -2000
    assert t.projected_profit == 7000
    assert t.profit_per_hour == -1333  # -2000*60/90 = -1333.33
    s = summary_dict(t)
    assert s["actual_profit_minor"] == "-2000"
    assert s["margin_percent"] == "-200.00"
    assert s["total_minutes"] == 90


def test_no_time_and_zero_revenue_are_null_not_zero() -> None:
    s = summary_dict(Totals(received=0, expense=0, labor=0, minutes=0, contract=5))
    assert s["profit_per_hour_minor"] is None
    assert s["margin_percent"] is None
    assert s["projected_profit_minor"] == "5"
    assert s["actual_profit_minor"] == "0"


def test_margin_rounding_and_format() -> None:
    assert summary_dict(Totals(3, 0, 0, 1))["margin_percent"] == "100.00"
    assert summary_dict(Totals(3, 1, 0, 1))["margin_percent"] == "66.67"
    assert summary_dict(Totals(100_000, 0, 150_000, 1))["margin_percent"] == "-50.00"
    assert format_hundredths(-5) == "-0.05"
    assert format_hundredths(0) == "0.00"


def test_jpy_zero_decimal_uses_same_integer_math() -> None:
    # JPY minor unit == yen: 45 min at 1500 yen/h = 1125 yen exactly.
    assert labor_minor(45, 1500) == 1125
    t = Totals(received=50_000, expense=1_000, labor=1125, minutes=45)
    assert t.actual_profit == 47_875
    assert t.profit_per_hour == 63_833  # 47875*60/45 = 63833.33


def test_huge_integers_exact() -> None:
    big = 10**15 - 1
    assert labor_minor(1440, big) == (1440 * big + 30) // 60
    n = 10**6
    t = Totals(received=big * n, expense=0, labor=labor_minor(1440, big) * n, minutes=1440 * n)
    assert t.actual_profit == big * n - labor_minor(1440, big) * n
    assert t.profit_per_hour is not None
    assert isinstance(t.profit_per_hour, int)
    assert t.margin_hundredths is not None
