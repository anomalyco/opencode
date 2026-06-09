#!/usr/bin/env python3
"""Minimal MT5 backtest gate for risk safety markers."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def main() -> int:
    args = parse_args()
    config = load_json(Path(args.config))
    rules = config.get("default", {})
    report_text = read_text(Path(args.report))
    log_text = read_text(Path(args.log))
    metrics = {
        "report_path": str(Path(args.report)),
        "log_path": str(Path(args.log)),
        "risk_version_marker": first_match(log_text, [r"(RISK_V\d+_[A-Z0-9_]+)"]),
        "no_money_count": count_patterns(log_text, [r"\bNo money\b", r"\bTRADE_RETCODE_NO_MONEY\b", r"\b10019\b"]),
        "margin_error_count": count_patterns(
            log_text,
            [
                r"\bTRADE_RETCODE_NO_MONEY\b",
                r"\bnot enough money\b",
                r"\bnot enough margin\b",
                r"\bmargin check failed\b",
                r"\bmargin call\b",
            ],
        ),
        "largest_lot": extract_largest_lot(log_text),
        "net_profit": extract_number(report_text, [r"Net Profit[^\d\-]*([\-\d.,]+)"]),
        "profit_factor": extract_number(report_text, [r"Profit Factor[^\d]*([\d.,]+)"]),
        "sharpe_ratio": extract_number(report_text, [r"Sharpe Ratio[^\d\-]*([\-\d.,]+)"]),
        "balance_drawdown_percent": extract_percent(report_text, [r"Balance Drawdown[^\n%]*?([\d.,]+)\s*%"]),
        "equity_drawdown_percent": extract_percent(report_text, [r"Equity Drawdown[^\n%]*?([\d.,]+)\s*%"]),
        "total_trades": extract_int(report_text, [r"Total Trades[^\d]*([\d,]+)"]),
        "win_count": extract_int(report_text, [r"Profit Trades[^\d]*([\d,]+)", r"Winning Trades[^\d]*([\d,]+)"]),
        "loss_count": extract_int(report_text, [r"Loss Trades[^\d]*([\d,]+)", r"Losing Trades[^\d]*([\d,]+)"]),
    }
    metrics["win_rate"] = calculate_win_rate(metrics["win_count"], metrics["loss_count"])
    failed_rules: list[str] = []
    warnings: list[str] = []

    for marker in rules.get("required_log_markers", []):
        if marker not in log_text:
            failed_rules.append(f"missing log marker: {marker}")

    if rules.get("reject_no_money", False) and metrics["no_money_count"] > 0:
        failed_rules.append("log contains 'No money'")

    if rules.get("reject_margin_error", False) and metrics["margin_error_count"] > 0:
        failed_rules.append("log contains margin-related errors")

    require_metric(metrics, "profit_factor", failed_rules)
    require_metric(metrics, "sharpe_ratio", failed_rules)
    require_metric(metrics, "total_trades", failed_rules)

    min_profit_factor = rules.get("min_profit_factor")
    if isinstance(min_profit_factor, (int, float)) and metrics["profit_factor"] is not None:
        if metrics["profit_factor"] < float(min_profit_factor):
            failed_rules.append(f"profit factor below minimum: {metrics['profit_factor']}")

    min_sharpe = rules.get("min_sharpe")
    if isinstance(min_sharpe, (int, float)) and metrics["sharpe_ratio"] is not None:
        if metrics["sharpe_ratio"] < float(min_sharpe):
            failed_rules.append(f"sharpe ratio below minimum: {metrics['sharpe_ratio']}")

    min_trades = rules.get("min_trades")
    if isinstance(min_trades, int) and metrics["total_trades"] is not None:
        if metrics["total_trades"] < min_trades:
            failed_rules.append(f"total trades below minimum: {metrics['total_trades']}")

    max_drawdown_pct = rules.get("max_drawdown_pct")
    if isinstance(max_drawdown_pct, (int, float)):
        drawdown_values = [value for value in (metrics["balance_drawdown_percent"], metrics["equity_drawdown_percent"]) if value is not None]
        if not drawdown_values:
            failed_rules.append("missing drawdown percent")
        elif max(drawdown_values) > float(max_drawdown_pct):
            failed_rules.append(f"drawdown percent above maximum: {max(drawdown_values)}")

    warn_largest_lot_above = rules.get("warn_largest_lot_above")
    if isinstance(warn_largest_lot_above, (int, float)) and metrics["largest_lot"] is not None:
        if metrics["largest_lot"] > float(warn_largest_lot_above):
            warnings.append(f"largest lot exceeds warning threshold: {metrics['largest_lot']}")

    output = {
        "scenario": args.scenario,
        "passed": not failed_rules,
        "metrics": metrics,
        "failed_rules": failed_rules,
        "warnings": warnings,
        "report_path": str(Path(args.report)),
        "log_path": str(Path(args.log)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    if failed_rules:
        return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze MT5 backtest report/log with minimal safety gates")
    parser.add_argument("--report", required=True, help="Path to MT5 HTML report")
    parser.add_argument("--log", required=True, help="Path to MT5 tester log")
    parser.add_argument("--scenario", required=True, help="Scenario name")
    parser.add_argument("--config", required=True, help="Gate config JSON path")
    parser.add_argument("--out", required=True, help="Output JSON path")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path: Path) -> str:
    data = path.read_bytes()
    encodings = ("utf-16le", "utf-8", "utf-8-sig", "cp932") if looks_like_utf16le(data) else ("utf-8", "utf-8-sig", "cp932", "utf-16le")
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", b"", 0, 1, f"unable to decode {path}")


def extract_largest_lot(text: str) -> float | None:
    values = [float(match) for match in re.findall(r"\b(?:lots?|volume)\s*[:=]?\s*(\d+(?:\.\d+)?)", text, flags=re.IGNORECASE)]
    values.extend(float(match) for match in re.findall(r"\b(\d+(?:\.\d+)?)\s+lots?\b", text, flags=re.IGNORECASE))
    values.extend(float(match) for match in re.findall(r"\b(?:market|deal)\s+(?:buy|sell)\s+(\d+(?:\.\d+)?)\b", text, flags=re.IGNORECASE))
    return max(values) if values else None


def looks_like_utf16le(data: bytes) -> bool:
    if data.startswith(b"\xff\xfe"):
        return True
    if len(data) < 4:
        return False
    return data[1::2].count(0) / max(1, len(data[1::2])) > 0.3


def count_patterns(text: str, patterns: list[str]) -> int:
    return sum(len(re.findall(pattern, text, flags=re.IGNORECASE)) for pattern in patterns)


def extract_number(text: str, patterns: list[str]) -> float | None:
    value = first_match(text, patterns)
    if value is None:
        return None
    try:
        return parse_number(value)
    except ValueError:
        return None


def extract_int(text: str, patterns: list[str]) -> int | None:
    value = first_match(text, patterns)
    if value is None:
        return None
    try:
        return int(value.replace(",", ""))
    except ValueError:
        return None


def first_match(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1)
    return None


def extract_percent(text: str, patterns: list[str]) -> float | None:
    return extract_number(text, patterns)


def parse_number(value: str) -> float:
    cleaned = value.strip().replace(" ", "")
    if "," in cleaned and "." not in cleaned:
        parts = cleaned.split(",")
        if len(parts[-1]) <= 2:
            return float(".".join(parts))
    return float(cleaned.replace(",", ""))


def calculate_win_rate(win_count: int | None, loss_count: int | None) -> float | None:
    if win_count is None or loss_count is None:
        return None
    total = win_count + loss_count
    if total <= 0:
        return None
    return win_count / total


def require_metric(metrics: dict[str, Any], key: str, failed_rules: list[str]) -> None:
    if metrics.get(key) is None:
        failed_rules.append(f"missing metric: {key}")


if __name__ == "__main__":
    sys.exit(main())
