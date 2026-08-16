"""Tests for bin/moa-run — the MoA CLI.

Model calls are mocked via lib/moa.chat_completions (the single network seam);
no live quota is consumed.
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
BIN_DIR = HERE.parent / "bin"

sys.path.insert(0, str(HERE.parent / "lib"))
import moa  # noqa: E402


def _import_moa_run():
    loader = importlib.machinery.SourceFileLoader("moa_run", str(BIN_DIR / "moa-run"))
    spec = importlib.util.spec_from_loader("moa_run", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


moa_run = _import_moa_run()


def _reply(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


@pytest.fixture
def fake_route(monkeypatch):
    """Stub chat_completions so runs are deterministic and quota-free."""
    calls: list[dict] = []

    def fake_chat(base_url, api_key, model, messages, **kwargs):
        calls.append({"model": model, "messages": messages})
        if model == "mock/aggregator":
            return _reply("VERDICT TEXT")
        return _reply(f"analysis from {model}")

    monkeypatch.setattr(moa, "chat_completions", fake_chat)
    monkeypatch.setenv("MOA_BASE_URL", "http://mock/v1")
    monkeypatch.setenv("MOA_API_KEY", "test-key")
    return calls


MOCK_ROLES = ("--advisors", "mock/advisor-a,mock/advisor-b", "--aggregator", "mock/aggregator")


@pytest.fixture
def cli_env(tmp_path, monkeypatch):
    monkeypatch.setenv("MOA_TRACES_DIR", str(tmp_path / "traces"))
    return tmp_path


def _run(monkeypatch, *args):
    monkeypatch.setattr(sys, "argv", ["moa-run", *args])
    return moa_run.main()


class TestMoaRunCli:
    def test_no_args_prints_usage_exit_2(self, capsys, monkeypatch):
        rc = _run(monkeypatch)
        out = capsys.readouterr().out
        assert rc == moa_run.EXIT_USAGE
        assert "moa-run" in out

    def test_help_exits_0(self, capsys, monkeypatch):
        rc = _run(monkeypatch, "--help")
        assert rc == 0
        assert "advisors" in capsys.readouterr().out

    def test_unknown_flag_errors(self, capsys, monkeypatch):
        rc = _run(monkeypatch, "--bogus", "x")
        assert rc == moa_run.EXIT_USAGE
        assert "unknown flag" in capsys.readouterr().err

    def test_missing_prompt_errors(self, capsys, monkeypatch):
        rc = _run(monkeypatch, "--out", "/tmp/x.json")
        assert rc == moa_run.EXIT_USAGE

    def test_missing_file_errors(self, capsys, monkeypatch):
        rc = _run(monkeypatch, "--file", "/nonexistent/task.md")
        assert rc == moa_run.EXIT_USAGE

    def test_verdict_to_stdout(self, capsys, monkeypatch, fake_route, cli_env):
        rc = _run(monkeypatch, "check the config", *MOCK_ROLES)
        out = capsys.readouterr().out
        assert rc == 0
        assert out.strip() == "VERDICT TEXT"
        assert [c["model"] for c in fake_route] == [
            "mock/advisor-a",
            "mock/advisor-b",
            "mock/aggregator",
        ]

    def test_out_file_written_with_verdict_shape(self, tmp_path, monkeypatch, fake_route, cli_env):
        out_path = tmp_path / "verdict.json"
        rc = _run(monkeypatch, "task", "--out", str(out_path), *MOCK_ROLES)
        assert rc == 0
        payload = json.loads(out_path.read_text(encoding="utf-8"))
        assert payload["verdict"] == "VERDICT TEXT"
        assert payload["model"] == "mock/aggregator"
        assert len(payload["advisors"]) == 2

    def test_file_prompt_and_context(self, tmp_path, monkeypatch, fake_route, cli_env):
        task = tmp_path / "task.md"
        task.write_text("prompt from file", encoding="utf-8")
        rc = _run(monkeypatch, "--file", str(task), "--context", "ctx data", *MOCK_ROLES)
        assert rc == 0
        all_messages = [m for c in fake_route for m in c["messages"]]
        assert any("prompt from file" in m["content"] for m in all_messages)
        assert any("ctx data" in m["content"] for m in all_messages)

    def test_traces_dir_written(self, tmp_path, monkeypatch, fake_route, cli_env):
        rc = _run(monkeypatch, "trace me", *MOCK_ROLES)
        assert rc == 0
        trace_root = cli_env  # MOA_TRACES_DIR = <tmp>/traces
        run_dirs = [p for p in Path(trace_root).glob("traces/*/run.json")]
        assert run_dirs, "expected a run.json under the traces dir"
        assert list(Path(trace_root).glob("traces/*/advisor-*.json")), "expected advisor traces"

    def test_all_advisors_failed_exit_3(self, capsys, monkeypatch, cli_env):
        def fake_chat(base_url, api_key, model, messages, **kwargs):
            raise RuntimeError("down")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        rc = _run(monkeypatch, "doomed", *MOCK_ROLES)
        assert rc == moa_run.EXIT_PIPELINE
        assert "failed" in capsys.readouterr().err

    def test_aggregator_failure_exit_3(self, capsys, monkeypatch, cli_env):
        def fake_chat(base_url, api_key, model, messages, **kwargs):
            if model == "mock/aggregator":
                raise RuntimeError("agg down")
            return _reply("analysis")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        rc = _run(monkeypatch, "agg fail", *MOCK_ROLES)
        assert rc == moa_run.EXIT_PIPELINE
