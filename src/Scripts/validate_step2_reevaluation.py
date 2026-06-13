#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXPECTED = {
    "D1": (
        "step2_operational_stop",
        "backtest/results/step2_global_stop_retest.json",
        "backtest/results/task-d1r-20260613.log",
    ),
    "D2": (
        "step2_operational_stop_daily",
        "backtest/results/step2_daily_stop_retest.json",
        "backtest/results/task-d2r-20260613.log",
    ),
    "D3": (
        "step2_operational_stop_monthly",
        "backtest/results/step2_monthly_stop_retest.json",
        "backtest/results/task-d3r-20260613.log",
    ),
}


def main() -> int:
    args = parse_args()
    root = Path(args.root)
    summary_path = Path(args.summary)
    if not summary_path.is_absolute():
        summary_path = root / summary_path
    summary = load_json(summary_path)
    errors = validate_summary(root, summary)
    for error in errors:
        print(error)
    return 1 if errors else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--summary", required=True)
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_iso8601(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def validate_summary(root: Path, summary: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    decision = summary.get("decision")
    if decision == "pass|hold|reject":
        errors.append("template decision remains: pass|hold|reject")
    if decision not in {"pass", "hold", "reject"}:
        errors.append(f"invalid decision: {decision}")
    elif decision != "pass":
        errors.append("validator requires decision pass")

    sentinel_unblocked = summary.get("sentinel_unblocked")
    if not isinstance(sentinel_unblocked, bool):
        errors.append("sentinel_unblocked must be boolean")
        sentinel_unblocked = False

    if sentinel_unblocked and decision != "pass":
        errors.append("sentinel_unblocked requires decision pass")

    scenarios = summary.get("scenarios")
    if not isinstance(scenarios, dict):
        return errors + ["missing scenarios object"]

    for key, (scenario_name, result_path, log_path) in EXPECTED.items():
        errors.extend(validate_scenario(root, key, scenario_name, result_path, log_path, scenarios.get(key)))

    if decision == "pass" and all(scenarios.get(key, {}).get("status") == "pass" for key in EXPECTED):
        pass
    elif decision == "pass":
        errors.append("decision pass requires all scenario status=pass")

    if decision == "pass" and not errors:
        return []
    if decision == "pass":
        errors.append("decision pass is invalid while scenario validation errors exist")

    return errors


def validate_scenario(
    root: Path,
    key: str,
    scenario_name: str,
    result_path: str,
    log_path: str,
    item: dict[str, Any] | None,
) -> list[str]:
    errors: list[str] = []

    if not isinstance(item, dict):
        return [f"{key}: missing scenario summary"]

    status = item.get("status")
    if status == "pass|hold|reject":
        errors.append(f"{key}: template status remains")
    if status not in {"pass", "hold", "reject"}:
        errors.append(f"{key}: invalid status {status}")

    if not item.get("reason"):
        errors.append(f"{key}: empty reason")
    if item.get("result_path") != result_path:
        errors.append(f"{key}: result_path mismatch")
    if item.get("log_path") != log_path:
        errors.append(f"{key}: log_path mismatch")
    if item.get("scenario") != scenario_name:
        errors.append(f"{key}: summary scenario mismatch")

    result_file = root / result_path
    log_file = root / log_path
    if not result_file.is_file():
        errors.append(f"{key}: missing result file {result_path}")
        return errors
    if not log_file.is_file():
        errors.append(f"{key}: missing log file {log_path}")
        return errors

    payload = load_json(result_file)
    if payload.get("scenario") != scenario_name:
        errors.append(f"{key}: parser scenario mismatch")
    if payload.get("passed") is not True:
        errors.append(f"{key}: parser did not pass")
    if payload.get("failed_rules") != []:
        errors.append(f"{key}: failed_rules not empty")
    if payload.get("warnings") != []:
        errors.append(f"{key}: warnings not empty")

    created_at = payload.get("created_at")
    if not isinstance(created_at, str):
        errors.append(f"{key}: parser created_at missing")
    else:
        try:
            created_ts = parse_iso8601(created_at).timestamp()
            if created_ts <= log_file.stat().st_mtime:
                errors.append(f"{key}: parser created_at not after log mtime")
        except ValueError:
            errors.append(f"{key}: parser created_at invalid")

    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        errors.append(f"{key}: parser metrics missing")
        return errors

    if metrics.get("log_path") != log_path:
        errors.append(f"{key}: parser metrics log_path mismatch")
    if metrics.get("log_window_selected") is not True:
        errors.append(f"{key}: log_window_selected is not true")

    if key == "D1":
        if metrics.get("global_stop_count", 0) < 1:
            errors.append("D1: global_stop_count below 1")
        if metrics.get("global_close_count", 0) < 1:
            errors.append("D1: global_close_count below 1")
        if metrics.get("orders_after_global_stop_count") != 0:
            errors.append("D1: orders_after_global_stop_count is not 0")
    else:
        if metrics.get("global_stop_count") != 0:
            errors.append(f"{key}: global_stop_count is not 0")
        if metrics.get("global_close_count") != 0:
            errors.append(f"{key}: global_close_count is not 0")

    if metrics.get("no_money_count") != 0:
        errors.append(f"{key}: no_money_count is not 0")
    if metrics.get("margin_error_count") != 0:
        errors.append(f"{key}: margin_error_count is not 0")

    return errors


if __name__ == "__main__":
    sys.exit(main())
