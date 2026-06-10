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

SENTINEL_PASS_LOG = """RiskManager Version: RISK_V3_ORDER_CALC_PROFIT
STRATEGY_VERSION: SENTINEL_BREAKOUT_XAUUSD_M15_V1
BROKER_SYMBOL_PROFILE: symbol=XAUUSD account=JPY digits=2 point=0.01 spread_points=25 stop_level=50 freeze_level=30
SKIP_REASON: SPREAD_TOO_WIDE
Trade skipped: SESSION_CLOSED
market buy 0.05 XAUUSD
"""

SENTINEL_INVALID_STOPS_LOG = SENTINEL_PASS_LOG + """failed market buy 0.05 XAUUSD sl: 2330.00 tp: 2340.00 [Invalid stops]
Order failed (attempt 1): 10016 - Invalid stops
"""

SENTINEL_ORDER_REJECTION_LOG = SENTINEL_PASS_LOG + """Order failed (attempt 1): 10030 - TRADE_RETCODE_INVALID_FILL
"""

SENTINEL_JPY_RISK_BREACH_LOG = SENTINEL_PASS_LOG + """JPY_RISK_BREACH: requested risk 7500 exceeds cap 5000
"""

SENTINEL_SKIP_WITHOUT_REASON_LOG = SENTINEL_PASS_LOG + """SKIPPED_TRADE
"""

SENTINEL_SKIP_INVALID_STOPS_LOG = SENTINEL_PASS_LOG + """SKIP_REASON: INVALID_STOPS
"""

STEP2_LOG = """CS\t0\t12:52:42.438\tTester\tXAUUSD,M15: testing of Experts\\opencode-trade\\Expert_Main.ex5 from 2024.06.01 00:00 to 2024.12.31 00:00 started with inputs:
CS\t0\t12:52:42.438\tTester\t  InpGlobalDDLimit=-0.0005
CS\t0\t12:52:42.524\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:45:00   RiskManager Version: RISK_V3_ORDER_CALC_PROFIT
CS\t0\t12:52:42.524\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:45:00   Order placed successfully: 0 0.14 lots at 2330.54
CS\t0\t12:52:42.524\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:45:20   CRITICAL: Global Drawdown limit reached: -0.09%
CS\t0\t12:52:42.524\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:45:20   GLOBAL STOP: closed position 2 on XAUUSD
CS\t0\t12:52:42.796\tTester\tXAUUSD,M15: 823720 ticks, 13756 bars generated. Test passed in 0:00:00.392 (including ticks preprocessing 0:00:00.031).
CS\t0\t12:52:42.796\tTester\ttest Experts\\opencode-trade\\Expert_Main.ex5 on XAUUSD,M15 thread finished
"""

STEP2_OLD_ERROR_LOG = """CS\t2\t12:10:00.027\tTrades\t2024.12.24 22:00:00   failed market sell 0.2 XAUUSD sl: 2616.98 tp: 2610.78 [Invalid stops]
CS\t0\t12:10:00.027\tExpert_Main (XAUUSD,M15)\t2024.12.24 22:00:00   Order failed (attempt 1): 10016 - Invalid stops
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
            "require_report_metrics": True,
            "min_sharpe": 1.5,
            "min_profit_factor": 1.2,
            "max_drawdown_pct": 15.0,
            "min_trades": 50,
            "required_log_markers": ["RISK_V3_ORDER_CALC_PROFIT"],
            "reject_no_money": True,
            "reject_margin_error": True,
            "warn_largest_lot_above": 1.0,
            "warn_drawdown_gap_pct": 3.0,
        },
        "step2_operational_stop": {
            "require_report_metrics": False,
            "log_window_start_pattern": r"XAUUSD,M15: testing of Experts\\opencode-trade\\Expert_Main\.ex5 .* started with inputs:",
            "required_log_markers": [
                "RISK_V3_ORDER_CALC_PROFIT",
                "InpGlobalDDLimit=-0.0005",
                "CRITICAL: Global Drawdown limit reached",
                "GLOBAL STOP: closed position",
                "Test passed",
                "test Experts\\opencode-trade\\Expert_Main.ex5 on XAUUSD,M15 thread finished",
            ],
            "reject_no_money": True,
            "reject_margin_error": True,
            "reject_orders_after_global_stop": True,
            "warn_largest_lot_above": 1.0,
        },
        "sentinel_xauusd_m15": {
            "required_log_markers": ["RISK_V3_ORDER_CALC_PROFIT"],
            "required_log_patterns": [
                r"(?:Strategy Version|STRATEGY_VERSION)\s*[:=]\s*SENTINEL_BREAKOUT_XAUUSD_M15_V\d+",
                r"BROKER_SYMBOL_PROFILE:",
            ],
            "reject_no_money": True,
            "reject_margin_error": True,
            "reject_invalid_stops": True,
            "reject_order_rejection": True,
            "reject_jpy_risk_breach": True,
            "reject_skip_without_reason": True,
            "reject_skip_reasons": ["INVALID_STOPS"],
            "warn_largest_lot_above": 1.0,
        }
    }


class AnalyzeMt5ReportTest(unittest.TestCase):
    def run_parser(self, report: str | None, log: str, scenario: str, config: dict | None = None, report_encoding: str = "utf-8"):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            report_path = tmp / "report.html"
            log_path = tmp / "tester.log"
            out_path = tmp / "out.json"
            config_path = tmp / "gate_config.json"
            log_path.write_text(log, encoding="utf-8")
            config_path.write_text(json.dumps(config or default_config()), encoding="utf-8")
            command = [
                sys.executable,
                str(SCRIPT),
                "--log",
                str(log_path),
                "--scenario",
                scenario,
                "--config",
                str(config_path),
                "--out",
                str(out_path),
            ]
            if report is not None:
                report_path.write_text(report, encoding=report_encoding)
                command[2:2] = ["--report", str(report_path)]
            result = subprocess.run(
                command,
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

    def test_default_scenario_requires_report(self):
        result, payload = self.run_parser(None, PASS_LOG, "default-no-report")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing required report", payload["failed_rules"])

    def test_step2_log_only_passes_without_report(self):
        result, payload = self.run_parser(None, STEP2_LOG, "step2_operational_stop")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(payload["passed"])
        self.assertTrue(payload["metrics"]["log_window_selected"])
        self.assertEqual(payload["metrics"]["global_stop_count"], 1)
        self.assertEqual(payload["metrics"]["global_close_count"], 1)
        self.assertEqual(payload["metrics"]["orders_after_global_stop_count"], 0)

    def test_step2_ignores_old_errors_outside_selected_window(self):
        result, payload = self.run_parser(None, STEP2_OLD_ERROR_LOG + STEP2_LOG, "step2_operational_stop")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(payload["passed"])

    def test_step2_fails_when_global_close_marker_missing(self):
        result, payload = self.run_parser(None, STEP2_LOG.replace("GLOBAL STOP: closed position 2 on XAUUSD\n", ""), "step2_operational_stop")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing log marker: GLOBAL STOP: closed position", payload["failed_rules"])

    def test_step2_fails_when_order_is_placed_after_global_stop(self):
        log = STEP2_LOG + "CS\t0\t12:52:42.900\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:46:00   Order placed successfully: 0 0.10 lots at 2331.00\n"
        result, payload = self.run_parser(None, log, "step2_operational_stop")
        self.assertEqual(result.returncode, 1)
        self.assertIn("orders placed after global stop: 1", payload["failed_rules"])

    def test_step2_fails_when_order_is_placed_after_first_global_stop(self):
        log = STEP2_LOG + (
            "CS\t0\t12:52:42.900\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:46:00   Order placed successfully: 0 0.10 lots at 2331.00\n"
            "CS\t0\t12:52:43.000\tExpert_Main (XAUUSD,M15)\t2024.06.03 13:46:20   CRITICAL: Global Drawdown limit reached: -0.10%\n"
        )
        result, payload = self.run_parser(None, log, "step2_operational_stop")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(payload["metrics"]["orders_after_global_stop_count"], 1)
        self.assertIn("orders placed after global stop: 1", payload["failed_rules"])

    def test_step2_fails_when_margin_error_is_in_selected_window(self):
        result, payload = self.run_parser(None, STEP2_LOG + "margin check failed\n", "step2_operational_stop")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains margin-related errors", payload["failed_rules"])

    def test_step2_missing_window_does_not_report_old_noise(self):
        result, payload = self.run_parser(None, STEP2_OLD_ERROR_LOG, "step2_operational_stop")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing log window start pattern", payload["failed_rules"])
        self.assertNotIn("log contains margin-related errors", payload["failed_rules"])
        self.assertNotIn("missing log marker: RISK_V3_ORDER_CALC_PROFIT", payload["failed_rules"])

    def test_utf16le_report_is_supported(self):
        result, payload = self.run_parser(PASS_REPORT, PASS_LOG, "utf16", report_encoding="utf-16le")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(payload["passed"])

    def test_sentinel_pass_case_extracts_strategy_and_skip_metrics(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_PASS_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(payload["metrics"]["strategy_version_marker"], "SENTINEL_BREAKOUT_XAUUSD_M15_V1")
        self.assertEqual(payload["metrics"]["skip_reason_count"], 2)
        self.assertEqual(payload["metrics"]["skip_reason_counts"]["SPREAD_TOO_WIDE"], 1)
        self.assertEqual(payload["metrics"]["skip_reason_counts"]["SESSION_CLOSED"], 1)
        self.assertEqual(payload["metrics"]["skip_without_reason_count"], 0)

    def test_sentinel_fails_when_strategy_version_marker_missing(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_PASS_LOG.replace("STRATEGY_VERSION: SENTINEL_BREAKOUT_XAUUSD_M15_V1\n", ""), "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertIn(
            "missing log pattern: (?:Strategy Version|STRATEGY_VERSION)\\s*[:=]\\s*SENTINEL_BREAKOUT_XAUUSD_M15_V\\d+",
            payload["failed_rules"],
        )

    def test_sentinel_fails_when_broker_profile_marker_missing(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_PASS_LOG.replace("BROKER_SYMBOL_PROFILE: symbol=XAUUSD account=JPY digits=2 point=0.01 spread_points=25 stop_level=50 freeze_level=30\n", ""), "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing log pattern: BROKER_SYMBOL_PROFILE:", payload["failed_rules"])

    def test_sentinel_fails_on_invalid_stops(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_INVALID_STOPS_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains invalid stops: 2", payload["failed_rules"])

    def test_sentinel_fails_on_order_rejection(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_ORDER_REJECTION_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains order rejections: 1", payload["failed_rules"])

    def test_sentinel_fails_on_jpy_risk_breach(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_JPY_RISK_BREACH_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains JPY risk breaches: 1", payload["failed_rules"])

    def test_sentinel_fails_on_skip_without_reason(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_SKIP_WITHOUT_REASON_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertIn("log contains skipped trades without reason: 1", payload["failed_rules"])

    def test_sentinel_fails_on_rejected_invalid_stops_skip_reason(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_SKIP_INVALID_STOPS_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(payload["metrics"]["skip_reason_counts"]["INVALID_STOPS"], 1)
        self.assertIn("log contains rejected skip reason INVALID_STOPS: 1", payload["failed_rules"])

    def test_sentinel_allows_spread_skip_reason(self):
        result, payload = self.run_parser(PASS_REPORT, SENTINEL_PASS_LOG, "sentinel_xauusd_m15")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(payload["metrics"]["skip_reason_counts"]["SPREAD_TOO_WIDE"], 1)

if __name__ == "__main__":
    unittest.main()
