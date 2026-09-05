"""moa — local Mixture-of-Agents runner (captain-test preset).

Fans a task prompt out to several advisor models in parallel, collects their
analyses, then hands the combined analyses plus the original prompt to an
aggregator model that produces the final verdict. The same pattern as the
Hermes `captain-test` MOA preset, but runnable locally from opencode via
Aperture (the captain's Ollama Cloud route).

Route: OpenAI-compatible ``/v1/chat/completions`` at MOA_BASE_URL (default
``http://ai.tail492ce8.ts.net/v1``) with MOA_API_KEY (default "not-required" —
the Aperture route requires no client auth). Keys come from the environment,
never from code or committed config. OLLAMA_API_BASE / OLLAMA_API_KEY are
honored as fallbacks, matching the rest of the lab.

Default roles (captain-test preset):
  advisors   = ollama-cloud/glm-5.2, ollama-cloud/minimax-m3
  aggregator = ollama-cloud/deepseek-v4-flash:0731 (reasoning_effort=max)

Design notes:
  - Advisors run concurrently on a thread pool (stdlib urllib only — the lab
    venv does not ship requests/httpx).
  - ``chat_completions`` is the only network seam; tests mock it, so the test
    suite never touches live quota.
  - Advisor failures are collected per-advisor and never abort siblings; the
    aggregator runs whenever at least one analysis exists.
  - Traces (save_traces equivalent) are written as JSON files into a traces
    dir: one file per advisor (request + raw response + extracted analysis),
    one for the aggregator call, and one run manifest.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - config parsing only needs yaml
    yaml = None  # type: ignore[assignment]

DEFAULT_BASE_URL = "http://ai.tail492ce8.ts.net/v1"
DEFAULT_API_KEY = "not-required"
DEFAULT_TIMEOUT = 300.0

DEFAULT_ADVISORS: list[dict[str, Any]] = [
    {
        "model": "ollama-cloud/glm-5.2",
        "label": "glm-5.2",
        "max_tokens": 2048,
        "extra": {},
    },
    {
        "model": "ollama-cloud/minimax-m3",
        "label": "minimax-m3",
        "max_tokens": 2048,
        "extra": {},
    },
]

DEFAULT_AGGREGATOR: dict[str, Any] = {
    "model": "ollama-cloud/deepseek-v4-flash:0731",
    "label": "deepseek-v4-flash:0731",
    "reasoning_effort": "max",
    "max_tokens": 8192,
    "extra": {},
}

DEFAULT_ADVISOR_SYSTEM = (
    "You are an expert advisor in a mixture-of-agents ensemble. "
    "Analyze the user's task thoroughly and independently. Be concrete, "
    "rigorous, and specific. Do not mention the ensemble; produce the best "
    "analysis you can on your own."
)

DEFAULT_AGGREGATOR_SYSTEM = (
    "You are the final aggregator in a mixture-of-agents ensemble. "
    "Below are independent analyses from several expert advisors, followed by "
    "the original task. Synthesize them into one final, coherent answer: "
    "resolve contradictions, keep the strongest evidence and reasoning, and "
    "produce the definitive verdict. Output only the final answer."
)


@dataclass
class RoleConfig:
    """A model role (advisor or aggregator) in the ensemble."""

    model: str
    label: str = ""
    max_tokens: int = 2048
    reasoning_effort: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class MoaConfig:
    """Resolved MOA configuration (env + yaml + CLI overrides)."""

    base_url: str = DEFAULT_BASE_URL
    api_key: str = DEFAULT_API_KEY
    advisors: list[RoleConfig] = field(default_factory=list)
    aggregator: RoleConfig = field(default_factory=lambda: RoleConfig(**DEFAULT_AGGREGATOR))
    system_prompt_advisor: str = DEFAULT_ADVISOR_SYSTEM
    system_prompt_aggregator: str = DEFAULT_AGGREGATOR_SYSTEM
    timeout: float = DEFAULT_TIMEOUT

    def __post_init__(self) -> None:
        if not self.advisors:
            self.advisors = [RoleConfig(**a) for a in DEFAULT_ADVISORS]
        for role in self.advisors + [self.aggregator]:
            if not role.label:
                role.label = role.model


def _env_or(env_names: tuple[str, ...], default: str) -> str:
    for name in env_names:
        value = os.environ.get(name)
        if value:
            return value
    return default


def load_config(config_path: str | os.PathLike[str] | None = None) -> MoaConfig:
    """Load MOA config from an optional yaml file + environment, with defaults.

    Precedence (lowest to highest): built-in defaults -> yaml file -> env.
    ``base_url``/``api_key`` env names: MOA_BASE_URL/MOA_API_KEY, falling back
    to OLLAMA_API_BASE/OLLAMA_API_KEY (the lab's existing route vars).
    """
    raw: dict[str, Any] = {}
    if config_path is not None:
        path = Path(config_path)
        if not path.is_file():
            raise FileNotFoundError(f"config file not found: {path}")
        if yaml is None:  # pragma: no cover - yaml is a lab dependency
            raise RuntimeError("pyyaml is required to read a yaml config")
        with path.open(encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}

    base_url = _env_or(("MOA_BASE_URL", "OLLAMA_API_BASE"), raw.get("base_url", DEFAULT_BASE_URL))
    key_env = raw.get("api_key_env", "MOA_API_KEY")
    # Keys come from the environment only — never from the yaml file.
    api_key = _env_or((key_env, "MOA_API_KEY", "OLLAMA_API_KEY"), DEFAULT_API_KEY)

    advisors_raw = raw.get("advisors") or DEFAULT_ADVISORS
    advisors = [RoleConfig(**dict(a)) for a in advisors_raw]
    aggregator_raw = raw.get("aggregator") or DEFAULT_AGGREGATOR
    aggregator = RoleConfig(**dict(aggregator_raw))

    return MoaConfig(
        base_url=base_url,
        api_key=api_key,
        advisors=advisors,
        aggregator=aggregator,
        system_prompt_advisor=raw.get("system_prompt_advisor", DEFAULT_ADVISOR_SYSTEM),
        system_prompt_aggregator=raw.get("system_prompt_aggregator", DEFAULT_AGGREGATOR_SYSTEM),
        timeout=float(raw.get("timeout", DEFAULT_TIMEOUT)),
    )


def chat_completions(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    reasoning_effort: str | None = None,
    extra_body: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """POST /v1/chat/completions and return the parsed JSON response.

    The single network seam of the library; tests replace this function.
    Raises urllib.error.URLError / HTTPError / ValueError on transport or
    JSON errors — callers decide what to do with the failure.
    """
    url = base_url.rstrip("/") + "/chat/completions"
    body: dict[str, Any] = {"model": model, "messages": messages}
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if reasoning_effort:
        body["reasoning_effort"] = reasoning_effort
    if extra_body:
        body.update(extra_body)

    # S310 is suppressed: the URL is constructed from lab-owned config/env
    # (MOA_BASE_URL / OLLAMA_API_BASE), never from target-influenced input.
    req = urllib.request.Request(  # noqa: S310
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def extract_message_text(message: dict[str, Any]) -> str:
    """Extract the assistant text from a chat-completion message.

    Aperture's proxy returns ``message.content`` for plain answers but puts
    the text in ``message.reasoning`` for reasoning-capable models when
    thinking kicks in — so fall back to reasoning when content is empty.
    """
    content = message.get("content") or ""
    if content.strip():
        return content
    return message.get("reasoning") or ""


def advisor_analysis(
    prompt: str,
    context: str,
    role: RoleConfig,
    config: MoaConfig,
) -> tuple[str, str, dict[str, Any]]:
    """Run one advisor against the task; returns (label, analysis, trace_meta).

    trace_meta carries the raw response and request body so the caller can
    persist an auditable trace. Raises on network/parse errors; the fan-out
    loop is responsible for catching and recording the failure.
    """
    user_parts: list[str] = []
    if context.strip():
        user_parts.append(f"## Context\n{context.strip()}")
    user_parts.append(f"## Task\n{prompt}")
    messages = [
        {"role": "system", "content": config.system_prompt_advisor},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]
    started = time.monotonic()
    response = chat_completions(
        config.base_url,
        config.api_key,
        role.model,
        messages,
        max_tokens=role.max_tokens,
        reasoning_effort=role.reasoning_effort,
        extra_body=role.extra,
        timeout=config.timeout,
    )
    duration_ms = int((time.monotonic() - started) * 1000)
    message = (response.get("choices") or [{}])[0].get("message", {})
    analysis = extract_message_text(message)
    meta = {
        "label": role.label,
        "model": role.model,
        "request": messages,
        "response": response,
        "extracted": analysis,
        "duration_ms": duration_ms,
    }
    return role.label, analysis, meta


def build_aggregator_messages(
    prompt: str,
    context: str,
    analyses: list[tuple[str, str, str]],  # (label, model, analysis)
    system_prompt: str,
) -> list[dict[str, str]]:
    """Combine the original task + context + all advisor analyses."""
    blocks: list[str] = []
    for label, model, analysis in analyses:
        blocks.append(f"### Advisor: {label} ({model})\n{analysis}")
    body = "\n\n".join(blocks)
    user_parts: list[str] = []
    if context.strip():
        user_parts.append(f"## Context\n{context.strip()}")
    user_parts.append(f"## Original task\n{prompt}")
    user_parts.append(f"## Advisor analyses\n\n{body}")
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]


def run_moa(
    prompt: str,
    context: str = "",
    config: MoaConfig | None = None,
    trace_dir: str | os.PathLike[str] | None = None,
) -> dict[str, Any]:
    """Run the full MOA pipeline: parallel advisors -> aggregator -> verdict.

    Returns the run envelope:
      {
        "verdict": <aggregator answer text>,
        "model": <aggregator model>,
        "reasoning_effort": ...,
        "advisors": [ {"label","model","analysis","error"} ... ],
        "trace_dir": <str|None>,
      }
    Raises MoaAllAdvisorsFailed when every advisor errors, MoaAggregatorFailed
    when no verdict could be produced. Traces are written best-effort before
    raising so partial runs are still auditable.
    """
    config = config or load_config()
    trace_dir_path: Path | None = None
    if trace_dir:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        prompt_slug = _slugify(prompt[:40]).strip("_") or "run"
        trace_dir_path = Path(trace_dir) / f"{stamp}-{prompt_slug}"
        trace_dir_path.mkdir(parents=True, exist_ok=True)
        _write_json(trace_dir_path / "run.json", {
            "prompt": prompt,
            "context": context,
            "config": _config_snapshot(config),
        })

    advisor_results: list[tuple[str, str, str, dict[str, Any] | None]] = []
    # ^ (label, model, analysis, trace_meta) — trace_meta carries the raw
    #   response for audit, or {"error": ...} when the advisor call failed.
    with ThreadPoolExecutor(max_workers=len(config.advisors)) as pool:
        futures = {
            pool.submit(advisor_analysis, prompt, context, role, config): role
            for role in config.advisors
        }
        for future in as_completed(futures):
            role = futures[future]
            try:
                label, analysis, meta = future.result()
                advisor_results.append((label, role.model, analysis, meta))
            except Exception as exc:  # noqa: BLE001 - per-advisor isolation
                meta: dict[str, Any] = {"error": repr(exc)}
                advisor_results.append((role.label, role.model, "", meta))
                if trace_dir_path is not None:
                    _write_json(advisor_trace_path(trace_dir_path, role.label), meta)

    ok = [(label, model, analysis) for label, model, analysis, meta in advisor_results if analysis]
    failed = [a for a in advisor_results if not a[2]]
    if not ok:
        raise MoaAllAdvisorsFailed(
            "every advisor failed: "
            + "; ".join(
                f"{label}: {meta.get('error', 'unknown')}"
                for label, _model, _analysis, meta in failed
            )
        )

    for label, _model, _analysis, meta in advisor_results:
        if meta is not None and trace_dir_path is not None:
            _write_json(advisor_trace_path(trace_dir_path, label), meta)

    messages = build_aggregator_messages(
        prompt, context, ok, config.system_prompt_aggregator
    )
    started = time.monotonic()
    try:
        response = chat_completions(
            config.base_url,
            config.api_key,
            config.aggregator.model,
            messages,
            max_tokens=config.aggregator.max_tokens,
            reasoning_effort=config.aggregator.reasoning_effort,
            extra_body=config.aggregator.extra,
            timeout=config.timeout,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced as MoaAggregatorFailed
        if trace_dir_path is not None:
            _write_json(trace_dir_path / "aggregator.json", {"error": repr(exc)})
        raise MoaAggregatorFailed(f"aggregator call failed: {exc}") from exc
    duration_ms = int((time.monotonic() - started) * 1000)
    message = (response.get("choices") or [{}])[0].get("message", {})
    verdict = extract_message_text(message)
    if not verdict.strip():
        verdict = "[aggregator returned an empty answer]"
    if trace_dir_path is not None:
        _write_json(trace_dir_path / "aggregator.json", {
            "request": messages,
            "response": response,
            "extracted": verdict,
            "duration_ms": duration_ms,
        })

    return {
        "verdict": verdict,
        "model": config.aggregator.model,
        "reasoning_effort": config.aggregator.reasoning_effort,
        "advisors": [
            {
                "label": label,
                "model": model,
                "analysis": analysis,
                "error": meta.get("error") if meta else None,
            }
            for label, model, analysis, meta in advisor_results
        ],
        "trace_dir": str(trace_dir_path) if trace_dir_path else None,
    }


class MoaError(Exception):
    """Base class for MOA pipeline failures."""


class MoaAllAdvisorsFailed(MoaError):
    """Every advisor call failed; there is nothing to aggregate."""


class MoaAggregatorFailed(MoaError):
    """Advisors produced analyses but the aggregator call failed."""


def _config_snapshot(config: MoaConfig) -> dict[str, Any]:
    return {
        "base_url": config.base_url,
        "api_key_env": "set" if config.api_key else "unset",
        "advisors": [
            {"label": a.label, "model": a.model, "max_tokens": a.max_tokens}
            for a in config.advisors
        ],
        "aggregator": {
            "label": config.aggregator.label,
            "model": config.aggregator.model,
            "reasoning_effort": config.aggregator.reasoning_effort,
            "max_tokens": config.aggregator.max_tokens,
        },
        "timeout": config.timeout,
    }


def _write_json(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def _slugify(value: str) -> str:
    """Safe filename fragment: keep word chars and -_. only."""
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in value) or "role"


def advisor_trace_path(trace_dir_path: Path | None, label: str) -> Path | None:
    """Trace file path for an advisor (label-safe filename)."""
    if trace_dir_path is None:
        return None
    return trace_dir_path / f"advisor-{_slugify(label)}.json"
