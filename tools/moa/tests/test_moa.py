"""Tests for lib/moa.py — the local MoA (Mixture of Agents) runner.

All model calls are mocked (moa.chat_completions is the single network seam);
these tests never touch live quota or the Aperture route.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import moa  # noqa: E402

FAKE_ADVISORS = [
    {"model": "mock/advisor-a", "label": "a"},
    {"model": "mock/advisor-b", "label": "b"},
]
FAKE_AGGREGATOR = {"model": "mock/aggregator", "label": "agg", "reasoning_effort": "max"}


def _fake_config() -> moa.MoaConfig:
    return moa.MoaConfig(
        base_url="http://mock/v1",
        api_key="test-key",
        advisors=[moa.RoleConfig(**a) for a in FAKE_ADVISORS],
        aggregator=moa.RoleConfig(**FAKE_AGGREGATOR),
    )


def _reply(content: str, reasoning: str = "") -> dict:
    message = {"role": "assistant", "content": content}
    if reasoning:
        message["reasoning"] = reasoning
    return {"choices": [{"message": message}]}


class TestConfig:
    def test_defaults_match_captain_test_preset(self, monkeypatch):
        monkeypatch.delenv("MOA_BASE_URL", raising=False)
        monkeypatch.delenv("OLLAMA_API_BASE", raising=False)
        monkeypatch.delenv("MOA_API_KEY", raising=False)
        monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
        cfg = moa.load_config(None)
        assert cfg.base_url == "http://ai.tail492ce8.ts.net/v1"
        assert cfg.api_key == "not-required"
        assert [a.model for a in cfg.advisors] == [
            "ollama-cloud/glm-5.2",
            "ollama-cloud/minimax-m3",
        ]
        assert cfg.aggregator.model == "ollama-cloud/deepseek-v4-flash:0731"
        assert cfg.aggregator.reasoning_effort == "max"

    def test_env_overrides(self, monkeypatch):
        monkeypatch.setenv("MOA_BASE_URL", "http://env/v1")
        monkeypatch.setenv("MOA_API_KEY", "env-key")
        cfg = moa.load_config(None)
        assert cfg.base_url == "http://env/v1"
        assert cfg.api_key == "env-key"

    def test_ollama_env_fallback(self, monkeypatch):
        monkeypatch.delenv("MOA_BASE_URL", raising=False)
        monkeypatch.delenv("MOA_API_KEY", raising=False)
        monkeypatch.setenv("OLLAMA_API_BASE", "http://ollama/v1")
        monkeypatch.setenv("OLLAMA_API_KEY", "ollama-key")
        cfg = moa.load_config(None)
        assert cfg.base_url == "http://ollama/v1"
        assert cfg.api_key == "ollama-key"

    def test_yaml_file(self, tmp_path, monkeypatch):
        monkeypatch.delenv("MOA_BASE_URL", raising=False)
        monkeypatch.delenv("OLLAMA_API_BASE", raising=False)
        (tmp_path / "moa.yaml").write_text(
            "base_url: http://yaml/v1\n"
            "advisors:\n"
            "  - model: mock/one\n"
            "  - model: mock/two\n"
            "aggregator:\n"
            "  model: mock/agg\n"
            "timeout: 42\n",
            encoding="utf-8",
        )
        cfg = moa.load_config(tmp_path / "moa.yaml")
        assert cfg.base_url == "http://yaml/v1"
        assert [a.model for a in cfg.advisors] == ["mock/one", "mock/two"]
        assert cfg.aggregator.model == "mock/agg"
        assert cfg.timeout == 42

    def test_missing_config_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            moa.load_config(tmp_path / "nope.yaml")

    def test_yaml_never_supplies_api_key(self, tmp_path, monkeypatch):
        monkeypatch.delenv("MOA_API_KEY", raising=False)
        monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
        (tmp_path / "moa.yaml").write_text(
            "api_key: super-secret\n", encoding="utf-8"
        )
        cfg = moa.load_config(tmp_path / "moa.yaml")
        assert cfg.api_key == "not-required"


class TestExtraction:
    def test_content_used(self):
        assert moa.extract_message_text({"content": "answer", "reasoning": "thinking"}) == "answer"

    def test_reasoning_fallback(self):
        assert moa.extract_message_text({"content": "", "reasoning": "thinking"}) == "thinking"

    def test_empty_message(self):
        assert moa.extract_message_text({}) == ""


class TestAggregatorMessages:
    def test_combines_task_context_and_analyses(self):
        messages = moa.build_aggregator_messages(
            "the task",
            "the ctx",
            [("a", "mock/a", "analysis-a"), ("b", "mock/b", "analysis-b")],
            "sys",
        )
        assert messages[0]["content"] == "sys"
        user = messages[1]["content"]
        assert "the task" in user
        assert "the ctx" in user
        assert "analysis-a" in user
        assert "analysis-b" in user
        assert "mock/a" in user


class TestRunMoa:
    def test_full_pipeline_fanout_and_verdict(self, tmp_path, monkeypatch):
        calls: list[dict] = []

        def fake_chat(base_url, api_key, model, messages, **kwargs):
            calls.append({"model": model, "messages": messages, **kwargs})
            if model == "mock/aggregator":
                return _reply("FINAL VERDICT")
            return _reply(f"analysis from {model}")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        result = moa.run_moa(
            "solve this",
            context="some context",
            config=_fake_config(),
            trace_dir=str(tmp_path / "traces"),
        )
        assert result["verdict"] == "FINAL VERDICT"
        assert result["model"] == "mock/aggregator"
        assert len(result["advisors"]) == 2
        assert {a["label"] for a in result["advisors"]} == {"a", "b"}
        assert all(a["error"] is None for a in result["advisors"])
        assert result["trace_dir"] is not None

        # Fan-out is parallel: both advisor calls must be submitted before the
        # aggregator is called.
        assert len(calls) == 3
        agg_index = next(i for i, c in enumerate(calls) if c["model"] == "mock/aggregator")
        assert agg_index == 2
        # Aggregator receives both analyses.
        agg_user = calls[agg_index]["messages"][1]["content"]
        assert "analysis from mock/advisor-a" in agg_user
        assert "analysis from mock/advisor-b" in agg_user

    def test_traces_written_for_audit(self, tmp_path, monkeypatch):
        def fake_chat(base_url, api_key, model, messages, **kwargs):
            return _reply(f"analysis from {model}")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        result = moa.run_moa("trace me", config=_fake_config(), trace_dir=str(tmp_path / "traces"))
        trace_dir = Path(result["trace_dir"])
        assert trace_dir.is_dir()
        assert (trace_dir / "run.json").is_file()
        assert (trace_dir / "advisor-a.json").is_file()
        assert (trace_dir / "advisor-b.json").is_file()
        assert (trace_dir / "aggregator.json").is_file()
        for name in ("advisor-a.json", "advisor-b.json", "aggregator.json"):
            payload = json.loads((trace_dir / name).read_text(encoding="utf-8"))
            assert payload["response"]["choices"]
            assert "extracted" in payload

    def test_advisor_failure_isolated_and_aggregator_still_runs(self, tmp_path, monkeypatch):
        def fake_chat(base_url, api_key, model, messages, **kwargs):
            if model == "mock/advisor-a":
                raise RuntimeError("boom-a")
            if model == "mock/aggregator":
                return _reply("verdict from surviving advisor")
            return _reply("analysis from b")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        result = moa.run_moa("partial", config=_fake_config(), trace_dir=str(tmp_path / "traces"))
        assert result["verdict"] == "verdict from surviving advisor"
        by_label = {a["label"]: a for a in result["advisors"]}
        assert by_label["a"]["error"] is not None
        assert by_label["b"]["error"] is None
        # Failed advisor's trace still records the error.
        err_trace = json.loads(
            (Path(result["trace_dir"]) / "advisor-a.json").read_text(encoding="utf-8")
        )
        assert "error" in err_trace

    def test_all_advisors_failed_raises(self, tmp_path, monkeypatch):
        def fake_chat(base_url, api_key, model, messages, **kwargs):
            raise RuntimeError("nope")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        with pytest.raises(moa.MoaAllAdvisorsFailed):
            moa.run_moa("doomed", config=_fake_config(), trace_dir=str(tmp_path / "traces"))

    def test_aggregator_failure_raises(self, tmp_path, monkeypatch):
        def fake_chat(base_url, api_key, model, messages, **kwargs):
            if model == "mock/aggregator":
                raise RuntimeError("agg down")
            return _reply(f"analysis from {model}")

        monkeypatch.setattr(moa, "chat_completions", fake_chat)
        with pytest.raises(moa.MoaAggregatorFailed):
            moa.run_moa("agg fail", config=_fake_config(), trace_dir=str(tmp_path / "traces"))
