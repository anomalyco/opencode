#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "src/Scripts/validate_step2_reevaluation.py"


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def parser_payload(scenario: str, log_path: str, created_at: str | None = None, **overrides: object) -> dict:
    now = datetime.now(timezone.utc)
    payload = {
        "scenario": scenario,
        "passed": True,
        "metrics": {
            "log_path": log_path,
            "log_window_selected": True,
            "global_stop_count": 1 if scenario == "step2_operational_stop" else 0,
            "global_close_count": 1 if scenario == "step2_operational_stop" else 0,
            "orders_after_global_stop_count": 0,
            "no_money_count": 0,
            "margin_error_count": 0,
        },
        "failed_rules": [],
        "warnings": [],
        "created_at": created_at or (now + timedelta(seconds=3)).isoformat(),
    }
    payload["metrics"].update(overrides.pop("metrics", {}))
    payload.update(overrides)
    return payload


class ValidateStep2ReevaluationTest(unittest.TestCase):
    def run_validator(self, tmp: Path):
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(tmp),
                "--summary",
                str(tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"),
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def make_valid_tree(self, tmp: Path, created_at_fns: list[str] | None = None):
        results = tmp / "backtest/results"
        results.mkdir(parents=True)

        logs = [
            "backtest/results/task-d1r-20260613.log",
            "backtest/results/task-d2r-20260613.log",
            "backtest/results/task-d3r-20260613.log",
        ]
        for log_path in logs:
            path = tmp / log_path
            path.write_text(f"fresh log: {log_path}\n", encoding="utf-8")

        created_at_values = created_at_fns or [None, None, None]
        write_json(
            results / "step2_global_stop_retest.json",
            parser_payload(
                "step2_operational_stop",
                "backtest/results/task-d1r-20260613.log",
                created_at=created_at_values[0],
            ),
        )
        write_json(
            results / "step2_daily_stop_retest.json",
            parser_payload(
                "step2_operational_stop_daily",
                "backtest/results/task-d2r-20260613.log",
                created_at=created_at_values[1],
            ),
        )
        write_json(
            results / "step2_monthly_stop_retest.json",
            parser_payload(
                "step2_operational_stop_monthly",
                "backtest/results/task-d3r-20260613.log",
                created_at=created_at_values[2],
            ),
        )

        write_json(
            results / "step2_operational_stop_reevaluation_summary.json",
            {
                "date": "2026-06-13",
                "decision": "pass",
                "sentinel_unblocked": True,
                "scenarios": {
                    "D1": {
                        "scenario": "step2_operational_stop",
                        "status": "pass",
                        "reason": "fresh global evidence",
                        "result_path": "backtest/results/step2_global_stop_retest.json",
                        "log_path": "backtest/results/task-d1r-20260613.log",
                    },
                    "D2": {
                        "scenario": "step2_operational_stop_daily",
                        "status": "pass",
                        "reason": "fresh daily evidence",
                        "result_path": "backtest/results/step2_daily_stop_retest.json",
                        "log_path": "backtest/results/task-d2r-20260613.log",
                    },
                    "D3": {
                        "scenario": "step2_operational_stop_monthly",
                        "status": "pass",
                        "reason": "fresh monthly evidence",
                        "result_path": "backtest/results/step2_monthly_stop_retest.json",
                        "log_path": "backtest/results/task-d3r-20260613.log",
                    },
                },
                "notes": [],
            },
        )

        # default payload timestamps use now + 3 seconds so they remain after log mtimes.

    def test_valid_summary_passes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_template_status_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            summary = tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["decision"] = "pass|hold|reject"
            write_json(summary, payload)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("template decision remains: pass|hold|reject", result.stdout)

    def test_unblocked_hold_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            summary = tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["decision"] = "hold"
            payload["sentinel_unblocked"] = True
            write_json(summary, payload)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("sentinel_unblocked requires decision pass", result.stdout)

    def test_sentinel_unblocked_type_required(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            summary = tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["sentinel_unblocked"] = "true"
            write_json(summary, payload)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("sentinel_unblocked must be boolean", result.stdout)

    def test_pass_requires_pass_statuses(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            summary = tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["scenarios"]["D2"]["status"] = "hold"
            write_json(summary, payload)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("decision pass requires all scenario status=pass", result.stdout)

    def test_hold_decision_fails_validator(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            summary = tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["decision"] = "hold"
            payload["sentinel_unblocked"] = False
            write_json(summary, payload)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("validator requires decision pass", result.stdout)

    def test_summary_scenario_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            self.make_valid_tree(tmp)
            summary = tmp / "backtest/results/step2_operational_stop_reevaluation_summary.json"
            payload = json.loads(summary.read_text(encoding="utf-8"))
            payload["scenarios"]["D3"]["scenario"] = "step2_operational_stop"
            write_json(summary, payload)
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("D3: summary scenario mismatch", result.stdout)

    def test_created_at_freshness_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            fixed = "2026-01-01T00:00:00+00:00"
            self.make_valid_tree(tmp, created_at_fns=[fixed, fixed, fixed])
            result = self.run_validator(tmp)
            self.assertEqual(result.returncode, 1)
            self.assertIn("created_at not after log mtime", result.stdout)


if __name__ == "__main__":
    unittest.main()
