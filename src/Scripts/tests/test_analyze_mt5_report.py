#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "src/Scripts/analyze_mt5_report.py"

PASS_REPORT = """<!DOCTYPE html>
<html>
<body>
<table>
<tr align="right"><td nowrap colspan="3">Total Net Profit:</td><td nowrap><b>123 456</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Factor:</td><td nowrap><b>1.23</b></td><td nowrap colspan="3">Sharpe Ratio:</td><td nowrap><b>1.50</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Absolute:</td><td nowrap><b>120 000</b></td><td nowrap colspan="3">Equity Drawdown Absolute:</td><td nowrap><b>122 000</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Relative:</td><td nowrap><b>10% (120 000)</b></td><td nowrap colspan="3">Equity Drawdown Relative:</td><td nowrap><b>11% (122 000)</b></td></tr>
<tr align="right"><td nowrap colspan="3">Total Trades:</td><td nowrap><b>55</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Trades (% of total):</td><td nowrap><b>30 (54.55%)</b></td><td nowrap colspan="3">Loss Trades (% of total):</td><td nowrap colspan="2"><b>25 (45.45%)</b></td></tr>
</table>
</body>
</html>
"""

COMMA_REPORT = """<!DOCTYPE html>
<html>
<body>
<table>
<tr align="right"><td nowrap colspan="3">Total Net Profit:</td><td nowrap><b>1.234,50</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Factor:</td><td nowrap><b>1,23</b></td><td nowrap colspan="3">Sharpe Ratio:</td><td nowrap><b>1,50</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Absolute:</td><td nowrap><b>120 000</b></td><td nowrap colspan="3">Equity Drawdown Absolute:</td><td nowrap><b>122 000</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Relative:</td><td nowrap><b>10,5% (120 000)</b></td><td nowrap colspan="3">Equity Drawdown Relative:</td><td nowrap><b>11,5% (122 000)</b></td></tr>
<tr align="right"><td nowrap colspan="3">Total Trades:</td><td nowrap><b>55</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Trades (% of total):</td><td nowrap><b>30 (54,55%)</b></td><td nowrap colspan="3">Loss Trades (% of total):</td><td nowrap colspan="2"><b>25 (45,45%)</b></td></tr>
</table>
</body>
</html>
"""

PASS_LOG = """RiskManager Version: RISK_V3_ORDER_CALC_PROFIT
market buy 0.05 XAUUSD
"""

NO_MONEY_LOG = """No money
"""

MARGIN_LOG = """margin check failed
"""

TRADE_WARNING_REPORT = """<!DOCTYPE html>
<html>
<body>
<table>
<tr align="right"><td nowrap colspan="3">Total Net Profit:</td><td nowrap><b>123 456</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Factor:</td><td nowrap><b>1.23</b></td><td nowrap colspan="3">Sharpe Ratio:</td><td nowrap><b>1.50</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Absolute:</td><td nowrap><b>120 000</b></td><td nowrap colspan="3">Equity Drawdown Absolute:</td><td nowrap><b>122 000</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Relative:</td><td nowrap><b>10% (120 000)</b></td><td nowrap colspan="3">Equity Drawdown Relative:</td><td nowrap><b>11% (122 000)</b></td></tr>
<tr align="right"><td nowrap colspan="3">Total Trades:</td><td nowrap><b>55</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Trades (% of total):</td><td nowrap><b>30 (54.55%)</b></td><td nowrap colspan="3">Loss Trades (% of total):</td><td nowrap colspan="2"><b>20 (36.36%)</b></td></tr>
</table>
</body>
</html>
"""

DRAWDOWN_WARNING_REPORT = """<!DOCTYPE html>
<html>
<body>
<table>
<tr align="right"><td nowrap colspan="3">Total Net Profit:</td><td nowrap><b>123 456</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Factor:</td><td nowrap><b>1.23</b></td><td nowrap colspan="3">Sharpe Ratio:</td><td nowrap><b>1.50</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Absolute:</td><td nowrap><b>120 000</b></td><td nowrap colspan="3">Equity Drawdown Absolute:</td><td nowrap><b>180 000</b></td></tr>
<tr align="right"><td nowrap colspan="3">Balance Drawdown Relative:</td><td nowrap><b>9% (120 000)</b></td><td nowrap colspan="3">Equity Drawdown Relative:</td><td nowrap><b>15% (180 000)</b></td></tr>
<tr align="right"><td nowrap colspan="3">Total Trades:</td><td nowrap><b>55</b></td></tr>
<tr align="right"><td nowrap colspan="3">Profit Trades (% of total):</td><td nowrap><b>30 (54.55%)</b></td><td nowrap colspan="3">Loss Trades (% of total):</td><td nowrap colspan="2"><b>25 (45.45%)</b></td></tr>
</table>
</body>
</html>
"""


def default_config() -> dict:
    return {
        "default": {
            "min_sharpe": 1.5,
            "min_profit_factor": 1.2,
            "max_drawdown_pct": 15.0,
            "min_trades": 50,
            "required_log_markers": ["RISK_V3_ORDER_CALC_PROFIT"],
            "reject_no_money": True,
            "reject_margin_error": True,
            "warn_largest_lot_above": 1.0,
            "warn_drawdown_gap_pct": 3.0,
        }
    }


class AnalyzeMt5ReportTest(unittest.TestCase):
    def run_parser(self, report: str, log: str, scenario: str, config: dict | None = None, report_encoding: str = "utf-8"):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            report_path = tmp / "report.html"
            log_path = tmp / "tester.log"
            out_path = tmp / "out.json"
            config_path = tmp / "gate_config.json"
            report_path.write_text(report, encoding=report_encoding)
            log_path.write_text(log, encoding="utf-8")
            config_path.write_text(json.dumps(config or default_config()), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--report",
                    str(report_path),
                    "--log",
                    str(log_path),
                    "--scenario",
                    scenario,
                    "--config",
                    str(config_path),
                    "--out",
                    str(out_path),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            payload = json.loads(out_path.read_text(encoding="utf-8"))
            return result, payload

    def test_pass_case_extracts_metrics(self):
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG, "pass")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(payload["passed"])
        self.assertEqual(payload["metrics"]["profit_factor"], 1.23)
        self.assertEqual(payload["metrics"]["balance_drawdown_relative_pct"], 10.0)
        self.assertEqual(payload["metrics"]["win_count"], 30)
        self.assertEqual(payload["metrics"]["loss_count"], 25)

    def test_fail_case_reports_missing_marker_and_no_money(self):
        result, payload = self.run_parser(PASS_REPORT, NO_MONEY_LOG, "fail")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(payload["passed"])
        self.assertIn("missing log marker: RISK_V3_ORDER_CALC_PROFIT", payload["failed_rules"])
        self.assertIn("log contains 'No money'", payload["failed_rules"])

    def test_margin_error_is_rejected(self):
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG + MARGIN_LOG, "margin")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains margin-related errors", payload["failed_rules"])

    def test_trade_consistency_warning_is_reported(self):
        result, payload = self.run_parser(TRADE_WARNING_REPORT, PASS_LOG, "trade-warning")
        self.assertEqual(result.returncode, 0)
        self.assertIn("trade counts are inconsistent: wins+losses=50 total_trades=55", payload["warnings"])

    def test_drawdown_gap_warning_is_reported(self):
        result, payload = self.run_parser(DRAWDOWN_WARNING_REPORT, PASS_LOG, "dd-warning")
        self.assertEqual(result.returncode, 0)
        self.assertIn("drawdown gap exceeds warning threshold: balance=9.0 equity=15.0", payload["warnings"])

    def test_largest_lot_warning_is_reported(self):
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG + "market buy 1.50 XAUUSD\n", "lot-warning")
        self.assertEqual(result.returncode, 0)
        self.assertIn("largest lot exceeds warning threshold: 1.5", payload["warnings"])

    def test_profit_factor_threshold_failure_is_reported(self):
        config = default_config()
        config["default"]["min_profit_factor"] = 1.5
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG, "pf-fail", config=config)
        self.assertEqual(result.returncode, 1)
        self.assertIn("profit factor below minimum: 1.23", payload["failed_rules"])

    def test_sharpe_and_trade_threshold_failure_are_reported(self):
        config = default_config()
        config["default"]["min_sharpe"] = 2.0
        config["default"]["min_trades"] = 60
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG, "threshold-fail", config=config)
        self.assertEqual(result.returncode, 1)
        self.assertIn("sharpe ratio below minimum: 1.5", payload["failed_rules"])
        self.assertIn("total trades below minimum: 55", payload["failed_rules"])

    def test_missing_drawdown_percent_is_reported(self):
        report = PASS_REPORT.replace('<tr align="right"><td nowrap colspan="3">Balance Drawdown Relative:</td><td nowrap><b>10% (120 000)</b></td><td nowrap colspan="3">Equity Drawdown Relative:</td><td nowrap><b>11% (122 000)</b></td></tr>\n', '')
        result, payload = self.run_parser(report, PASS_LOG, "missing-dd")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing drawdown percent", payload["failed_rules"])

    def test_comma_and_decimal_metrics_are_supported(self):
        result, payload = self.run_parser(COMMA_REPORT, PASS_LOG, "comma")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(payload["metrics"]["net_profit"], 1234.5)
        self.assertEqual(payload["metrics"]["profit_factor"], 1.23)
        self.assertEqual(payload["metrics"]["balance_drawdown_relative_pct"], 10.5)
        self.assertEqual(payload["metrics"]["equity_drawdown_relative_pct"], 11.5)

    def test_drawdown_threshold_failure_is_reported(self):
        config = default_config()
        config["default"]["max_drawdown_pct"] = 10.0
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG, "dd-fail", config=config)
        self.assertEqual(result.returncode, 1)
        self.assertIn("drawdown percent above maximum: 11.0", payload["failed_rules"])

    def test_missing_metric_failure_is_reported(self):
        report = PASS_REPORT.replace('<tr align="right"><td nowrap colspan="3">Profit Factor:</td><td nowrap><b>1.23</b></td><td nowrap colspan="3">Sharpe Ratio:</td><td nowrap><b>1.50</b></td></tr>\n', '')
        result, payload = self.run_parser(report, PASS_LOG, "missing-metric")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing metric: profit_factor", payload["failed_rules"])
        self.assertIn("missing metric: sharpe_ratio", payload["failed_rules"])

    def test_trade_retcode_no_money_is_rejected(self):
        result, payload = self.run_parser(PASS_REPORT, "TRADE_RETCODE_NO_MONEY\n10019\n", "retcode-no-money")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains 'No money'", payload["failed_rules"])
        self.assertIn("log contains margin-related errors", payload["failed_rules"])


    def test_utf16le_report_is_supported(self):
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG, "utf16", report_encoding="utf-16le")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(payload["passed"])

if __name__ == "__main__":
    unittest.main()
