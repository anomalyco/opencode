"""Tests for AI-facing SDK ergonomics (no relay required)."""

from __future__ import annotations

import inspect
import unittest

import veritly_univer_sdk
from veritly_univer_sdk import CHART_BAR, RangeRect, UniverSDK, sdk_help


class TestSdkHelp(unittest.TestCase):
    def test_sdk_help_mentions_pyodide_and_asyncio(self) -> None:
        text = sdk_help()
        self.assertIn("asyncio.run", text)
        self.assertIn("async def main", text)
        self.assertIn("get_sheet", text)

    def test_sdk_help_mentions_chart_type_int(self) -> None:
        text = sdk_help()
        self.assertIn("CHART_BAR", text)
        self.assertIn("int", text.lower())


class TestRangeRect(unittest.TestCase):
    def test_block_from_origin(self) -> None:
        r = RangeRect.block(10, 5)
        self.assertEqual((r.startRow, r.endRow, r.startColumn, r.endColumn), (0, 10, 0, 5))

    def test_block_rejects_negative(self) -> None:
        with self.assertRaises(ValueError):
            RangeRect.block(-1, 0)


class TestUniverSdkSignatures(unittest.TestCase):
    def test_get_sheet_keyword_only_bounds(self) -> None:
        sig = inspect.signature(UniverSDK.get_sheet)
        self.assertIn("max_row", sig.parameters)
        self.assertEqual(sig.parameters["max_row"].default, 500)

    def test_add_chart_chart_type_keyword_only(self) -> None:
        sig = inspect.signature(UniverSDK.add_chart)
        self.assertIn("chart_type", sig.parameters)
        self.assertEqual(sig.parameters["chart_type"].default, CHART_BAR)

    def test_get_range_requires_range_rect(self) -> None:
        sig = inspect.signature(UniverSDK.get_range)
        p = sig.parameters["range_rect"]
        self.assertEqual(p.default, inspect.Parameter.empty)

    def test_docstrings_present(self) -> None:
        self.assertIn("asyncio", veritly_univer_sdk.__doc__ or "")
        self.assertIn("chart_type", UniverSDK.add_chart.__doc__ or "")
        self.assertIn("max_row", UniverSDK.get_sheet.__doc__ or "")


class TestPyodideSnippetPatterns(unittest.TestCase):
    """Patterns agents should be able to copy without relay."""

    def test_minimal_import_line(self) -> None:
        ns: dict[str, object] = {}
        exec("from veritly_univer_sdk import RangeRect, UniverSDK, sdk_help", ns)
        self.assertIs(ns["UniverSDK"], UniverSDK)
        self.assertIs(ns["RangeRect"], RangeRect)

    def test_range_rect_block_one_liner(self) -> None:
        r = RangeRect.block(3, 2)
        self.assertEqual(r.endRow, 3)
        self.assertEqual(r.endColumn, 2)


if __name__ == "__main__":
    unittest.main()
