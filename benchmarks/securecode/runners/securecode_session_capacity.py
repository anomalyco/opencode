#!/usr/bin/env python3
"""Run session-oriented SecureCode capacity tests."""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from securecode_capacity import (
    ASSET_DIR,
    DEFAULT_BASE_URL,
    DEFAULT_BACKING_MODEL,
    DEFAULT_MODEL,
    DEFAULT_REMOTE_RUN_ROOT,
    DEFAULT_SEC_CODE_BENCH_REF,
    DEFAULT_SEC_CODE_BENCH_REPO,
    apply_monitoring_to_phases,
    ensure_sec_code_bench,
    fetch_monitoring,
    parse_timestamp,
    percentile,
    run_remote,
    stats_for,
)


SCENARIO_PROMPT_SUFFIX = {
    "gen": "",
    "gen-hints": "Hints",
    "fix": "Fix",
    "fix-hints": "FixHints",
}
SCENARIO_WEIGHTS = {
    "gen": 0.12,
    "gen-hints": 0.18,
    "fix": 0.34,
    "fix-hints": 0.36,
}
CASE_FOCUS_BY_SCENARIO = {
    "gen": "functional",
    "gen-hints": "functional",
    "fix": "security",
    "fix-hints": "security",
}
PROMPT_PATH_FORMAT = "datasets/benchmark/java/prompts/{prompt}{suffix}.{locale}"
DEFAULT_SESSION_SEED = 42


@dataclass(frozen=True)
class SessionProfile:
    name: str
    think_time_median_s: float
    think_time_sigma: float
    arrival_spread_s: float
    artifact_chars: int
    expectation_chars: int
    final_max_tokens: int
    summary_max_tokens: int


@dataclass(frozen=True)
class SecureCodeCase:
    case_id: str
    template: str
    prompt_name: str
    severity: str
    notes: str
    params: dict[str, str]
    template_dir: Path
    prompt_dir: Path

    def prompt_text(self, scenario: str, locale: str) -> str:
        suffix = SCENARIO_PROMPT_SUFFIX[scenario]
        prompt_path = self.prompt_dir / f"{self.prompt_name}{suffix}.{locale}"
        return prompt_path.read_text()


@dataclass(frozen=True)
class SessionPlan:
    session_id: str
    case: SecureCodeCase
    scenario: str
    profile: SessionProfile
    focus_role: str
    expectation_focus: str
    arrival_delay_s: float
    think_times_s: tuple[float, float, float, float, float, float]


@dataclass
class SessionRequestResult:
    phase: int
    concurrency: int
    session_id: str
    case_id: str
    scenario: str
    severity: str
    profile: str
    request_index: int
    stage_name: str
    request_kind: str
    started_at: str
    ended_at: str
    latency_s: float
    success: bool
    status_code: int | None
    error: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    output_chars: int | None
    tool_call_count: int
    tool_names: str
    think_time_before_s: float


@dataclass
class SessionResult:
    phase: int
    concurrency: int
    session_id: str
    case_id: str
    scenario: str
    severity: str
    profile: str
    started_at: str
    ended_at: str
    elapsed_s: float
    request_count: int
    success: bool
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int
    total_tool_calls: int


PROFILES = (
    SessionProfile(
        name="light",
        think_time_median_s=1.6,
        think_time_sigma=0.45,
        arrival_spread_s=4.0,
        artifact_chars=1800,
        expectation_chars=1400,
        final_max_tokens=320,
        summary_max_tokens=160,
    ),
    SessionProfile(
        name="medium",
        think_time_median_s=2.8,
        think_time_sigma=0.55,
        arrival_spread_s=8.0,
        artifact_chars=3600,
        expectation_chars=2600,
        final_max_tokens=448,
        summary_max_tokens=220,
    ),
    SessionProfile(
        name="heavy",
        think_time_median_s=4.4,
        think_time_sigma=0.60,
        arrival_spread_s=12.0,
        artifact_chars=5600,
        expectation_chars=4200,
        final_max_tokens=640,
        summary_max_tokens=280,
    ),
)
PROFILE_WEIGHTS = (0.24, 0.51, 0.25)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key, value)


def load_securecode_cases(
    *,
    workload_file: Path,
    sec_code_bench_dir: Path,
) -> list[SecureCodeCase]:
    workload_spec = json.loads(workload_file.read_text())
    benchmark = json.loads(
        (sec_code_bench_dir / "datasets" / "benchmark" / "java" / "java.json").read_text()
    )
    prompt_dir = sec_code_bench_dir / "datasets" / "benchmark" / "java" / "prompts"

    notes_by_case = {item["id"]: item["notes"] for item in workload_spec}
    selected_case_ids = [item["id"] for item in workload_spec]

    cases: list[SecureCodeCase] = []
    for case_id in selected_case_ids:
        case_meta = benchmark[case_id]
        template_dir = sec_code_bench_dir / "datasets" / "templates" / "java" / case_meta["template"]
        cases.append(
            SecureCodeCase(
                case_id=case_id,
                template=case_meta["template"],
                prompt_name=case_meta["prompt"],
                severity=case_meta["severity"],
                notes=notes_by_case[case_id],
                params=case_meta["params"],
                template_dir=template_dir,
                prompt_dir=prompt_dir,
            )
        )
    return cases


def lognormal_sample(rng: random.Random, median: float, sigma: float, low: float, high: float) -> float:
    value = rng.lognormvariate(mu=0.0, sigma=sigma) * median
    return max(low, min(high, value))


def choose_weighted(items: list[str], weights: list[float], rng: random.Random) -> str:
    return rng.choices(items, weights=weights, k=1)[0]


def build_session_plan(case: SecureCodeCase, session_index: int, rng: random.Random) -> SessionPlan:
    scenarios = list(SCENARIO_WEIGHTS.keys())
    scenario = choose_weighted(scenarios, [SCENARIO_WEIGHTS[item] for item in scenarios], rng)
    profile = rng.choices(list(PROFILES), weights=PROFILE_WEIGHTS, k=1)[0]
    focus_role = "security_test" if CASE_FOCUS_BY_SCENARIO[scenario] == "security" else "functional_test"
    expectation_focus = "both" if profile.name != "light" else focus_role.split("_")[0]
    arrival_delay_s = rng.uniform(0.0, profile.arrival_spread_s)
    think_times = tuple(
        lognormal_sample(rng, profile.think_time_median_s, profile.think_time_sigma, 0.2, 18.0)
        for _ in range(6)
    )
    return SessionPlan(
        session_id=f"session-{session_index:04d}",
        case=case,
        scenario=scenario,
        profile=profile,
        focus_role=focus_role,
        expectation_focus=expectation_focus,
        arrival_delay_s=arrival_delay_s,
        think_times_s=think_times,
    )


def build_session_plans(cases: list[SecureCodeCase], session_count: int, seed: int) -> list[SessionPlan]:
    rng = random.Random(seed)
    return [build_session_plan(rng.choice(cases), index + 1, rng) for index in range(session_count)]


def list_template_files(case: SecureCodeCase) -> list[str]:
    files = []
    for path in sorted(case.template_dir.rglob("*")):
        if path.is_file():
            files.append(path.relative_to(case.template_dir).as_posix())
    target_rel_paths = set(case.params.values())
    for target_rel_path in sorted(target_rel_paths):
        if target_rel_path not in files:
            files.append(f"{target_rel_path} (missing; to be created by the model)")
    return files


def read_artifact_text(case: SecureCodeCase, role: str, max_chars: int) -> dict[str, Any]:
    role_map = {
        "pom_xml": case.template_dir / "pom.xml",
        "functional_test": case.template_dir / "src" / "test" / "java" / "com" / "example" / "service" / "FunctionalTest.java",
        "security_test": case.template_dir / "src" / "test" / "java" / "com" / "example" / "service" / "SecurityTest.java",
        "target_source": case.template_dir / next(iter(case.params.values())),
    }
    path = role_map.get(role, role_map["security_test"])
    if not path.exists():
        return {
            "role": role,
            "path": path.relative_to(case.template_dir).as_posix(),
            "exists": False,
            "content_excerpt": "File does not exist in the template workspace. The implementation is expected to create it.",
            "truncated": False,
            "total_chars": 0,
        }

    text = path.read_text()
    truncated = len(text) > max_chars
    excerpt = text[:max_chars]
    return {
        "role": role,
        "path": path.relative_to(case.template_dir).as_posix(),
        "exists": True,
        "content_excerpt": excerpt,
        "truncated": truncated,
        "total_chars": len(text),
    }


def summarize_expectations(case: SecureCodeCase, focus: str, max_chars: int) -> dict[str, Any]:
    selected_roles = []
    if focus in {"functional", "both"}:
        selected_roles.append("functional_test")
    if focus in {"security", "both"}:
        selected_roles.append("security_test")
    snippets: list[str] = []
    assertions = 0
    for role in selected_roles:
        artifact = read_artifact_text(case, role, max_chars=max_chars * 2)
        excerpt = artifact["content_excerpt"]
        lines = []
        for line in excerpt.splitlines():
            stripped = line.strip()
            if (
                "@Test" in stripped
                or "assert" in stripped
                or "fail(" in stripped
                or "TESTCASE-" in stripped
                or stripped.startswith("public void test")
            ):
                lines.append(stripped)
        assertions += sum(1 for line in lines if "assert" in line or "fail(" in line)
        snippet = f"[{role}]\n" + "\n".join(lines[:60])
        snippets.append(snippet)
    joined = "\n\n".join(snippets)
    truncated = len(joined) > max_chars
    return {
        "focus": focus,
        "selected_roles": selected_roles,
        "assertion_like_lines": assertions,
        "expectation_excerpt": joined[:max_chars],
        "truncated": truncated,
        "total_chars": len(joined),
    }


def build_tool_specs() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "workspace_manifest",
                "description": "Return the real file layout of the current SecCodeBench template workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_workspace_artifact",
                "description": "Read a named workspace artifact such as the pom file or a test file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "artifact_role": {
                            "type": "string",
                            "enum": ["pom_xml", "functional_test", "security_test", "target_source"],
                        },
                        "max_chars": {
                            "type": "integer",
                            "minimum": 256,
                            "maximum": 12000,
                        },
                    },
                    "required": ["artifact_role"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "inspect_test_expectations",
                "description": "Extract the concrete functional and security expectations from the real SecCodeBench test files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "focus": {
                            "type": "string",
                            "enum": ["functional", "security", "both"],
                        },
                        "max_chars": {
                            "type": "integer",
                            "minimum": 256,
                            "maximum": 12000,
                        },
                    },
                    "required": ["focus"],
                    "additionalProperties": False,
                },
            },
        },
    ]


def parse_tool_arguments(raw_arguments: str | None) -> dict[str, Any]:
    if not raw_arguments:
        return {}
    try:
        value = json.loads(raw_arguments)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def execute_tool_call(
    *,
    tool_name: str,
    arguments: dict[str, Any],
    case: SecureCodeCase,
    plan: SessionPlan,
) -> str:
    if tool_name == "workspace_manifest":
        return json.dumps(
            {
                "case_id": case.case_id,
                "template": case.template,
                "scenario": plan.scenario,
                "severity": case.severity,
                "files": list_template_files(case),
                "target_outputs": list(case.params.values()),
            },
            ensure_ascii=False,
        )

    if tool_name == "read_workspace_artifact":
        artifact_role = arguments.get("artifact_role")
        if artifact_role not in {"pom_xml", "functional_test", "security_test", "target_source"}:
            artifact_role = plan.focus_role
        max_chars = int(arguments.get("max_chars", plan.profile.artifact_chars))
        return json.dumps(
            read_artifact_text(case, artifact_role, max_chars=max_chars),
            ensure_ascii=False,
        )

    if tool_name == "inspect_test_expectations":
        focus = arguments.get("focus")
        if focus not in {"functional", "security", "both"}:
            focus = plan.expectation_focus
        max_chars = int(arguments.get("max_chars", plan.profile.expectation_chars))
        return json.dumps(
            summarize_expectations(case, focus, max_chars=max_chars),
            ensure_ascii=False,
        )

    return json.dumps({"error": f"unknown tool: {tool_name}"}, ensure_ascii=False)


def post_chat_completion(
    *,
    base_url: str,
    api_key: str | None,
    payload: dict[str, Any],
    timeout_s: int,
) -> tuple[dict[str, Any], int | None]:
    req = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "chat/completions"),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")

    with urllib.request.urlopen(req, timeout=timeout_s) as response:
        return json.loads(response.read()), response.status


def issue_request(
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    tool_choice: dict[str, Any] | str | None,
    max_tokens: int,
    temperature: float,
    timeout_s: int,
    phase_index: int,
    concurrency: int,
    plan: SessionPlan,
    request_index: int,
    stage_name: str,
    request_kind: str,
    think_time_before_s: float,
) -> tuple[SessionRequestResult, dict[str, Any] | None]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
    if tool_choice is not None:
        payload["tool_choice"] = tool_choice

    started = datetime.now(UTC)
    start_ts = time.perf_counter()
    try:
        body, status_code = post_chat_completion(
            base_url=base_url,
            api_key=api_key,
            payload=payload,
            timeout_s=timeout_s,
        )
        ended = datetime.now(UTC)
        latency = time.perf_counter() - start_ts
        message = body.get("choices", [{}])[0].get("message", {})
        usage = body.get("usage", {})
        tool_calls = message.get("tool_calls") or []
        tool_names = []
        for tool_call in tool_calls:
            function_payload = tool_call.get("function", {})
            tool_names.append(function_payload.get("name", ""))
        assistant_text = message.get("content", "") or ""
        result = SessionRequestResult(
            phase=phase_index,
            concurrency=concurrency,
            session_id=plan.session_id,
            case_id=plan.case.case_id,
            scenario=plan.scenario,
            severity=plan.case.severity,
            profile=plan.profile.name,
            request_index=request_index,
            stage_name=stage_name,
            request_kind=request_kind,
            started_at=started.isoformat(),
            ended_at=ended.isoformat(),
            latency_s=latency,
            success=True,
            status_code=status_code,
            error=None,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            output_chars=len(assistant_text),
            tool_call_count=len(tool_calls),
            tool_names=",".join(name for name in tool_names if name),
            think_time_before_s=think_time_before_s,
        )
        return result, message
    except urllib.error.HTTPError as exc:
        ended = datetime.now(UTC)
        latency = time.perf_counter() - start_ts
        body = exc.read().decode("utf-8", errors="ignore")
        result = SessionRequestResult(
            phase=phase_index,
            concurrency=concurrency,
            session_id=plan.session_id,
            case_id=plan.case.case_id,
            scenario=plan.scenario,
            severity=plan.case.severity,
            profile=plan.profile.name,
            request_index=request_index,
            stage_name=stage_name,
            request_kind=request_kind,
            started_at=started.isoformat(),
            ended_at=ended.isoformat(),
            latency_s=latency,
            success=False,
            status_code=exc.code,
            error=body[:600],
            prompt_tokens=None,
            completion_tokens=None,
            total_tokens=None,
            output_chars=None,
            tool_call_count=0,
            tool_names="",
            think_time_before_s=think_time_before_s,
        )
        return result, None
    except Exception as exc:  # noqa: BLE001
        ended = datetime.now(UTC)
        latency = time.perf_counter() - start_ts
        result = SessionRequestResult(
            phase=phase_index,
            concurrency=concurrency,
            session_id=plan.session_id,
            case_id=plan.case.case_id,
            scenario=plan.scenario,
            severity=plan.case.severity,
            profile=plan.profile.name,
            request_index=request_index,
            stage_name=stage_name,
            request_kind=request_kind,
            started_at=started.isoformat(),
            ended_at=ended.isoformat(),
            latency_s=latency,
            success=False,
            status_code=None,
            error=str(exc),
            prompt_tokens=None,
            completion_tokens=None,
            total_tokens=None,
            output_chars=None,
            tool_call_count=0,
            tool_names="",
            think_time_before_s=think_time_before_s,
        )
        return result, None


def append_tool_messages(
    *,
    messages: list[dict[str, Any]],
    assistant_message: dict[str, Any],
    case: SecureCodeCase,
    plan: SessionPlan,
) -> int:
    messages.append(
        {
            "role": "assistant",
            "content": assistant_message.get("content"),
            "tool_calls": assistant_message.get("tool_calls", []),
        }
    )
    tool_calls = assistant_message.get("tool_calls") or []
    for tool_call in tool_calls:
        function_payload = tool_call.get("function", {})
        tool_name = function_payload.get("name", "")
        arguments = parse_tool_arguments(function_payload.get("arguments"))
        tool_output = execute_tool_call(
            tool_name=tool_name,
            arguments=arguments,
            case=case,
            plan=plan,
        )
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call.get("id"),
                "content": tool_output,
            }
        )
    return len(tool_calls)


def maybe_sleep(seconds: float) -> None:
    if seconds > 0:
        time.sleep(seconds)


def run_session(
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    phase_index: int,
    concurrency: int,
    plan: SessionPlan,
    tool_specs: list[dict[str, Any]],
    locale: str,
    timeout_s: int,
    temperature: float,
) -> tuple[SessionResult, list[SessionRequestResult]]:
    maybe_sleep(plan.arrival_delay_s)
    started = datetime.now(UTC)
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "You are a secure coding assistant working inside a terminal IDE. "
                "Keep non-final answers concise. When tools are available, inspect the workspace before proposing a fix."
            ),
        }
    ]

    original_prompt = plan.case.prompt_text(plan.scenario, locale)
    session_requests: list[SessionRequestResult] = []
    request_index = 0

    def call_and_store(
        *,
        user_content: str,
        stage_name: str,
        request_kind: str,
        tool_choice: dict[str, Any] | str | None,
        max_tokens: int,
        think_time_before_s: float,
        include_tools: bool,
    ) -> dict[str, Any] | None:
        nonlocal request_index
        messages.append({"role": "user", "content": user_content})
        request_index += 1
        result, assistant_message = issue_request(
            base_url=base_url,
            model=model,
            api_key=api_key,
            messages=messages,
            tools=tool_specs if include_tools else None,
            tool_choice=tool_choice,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout_s=timeout_s,
            phase_index=phase_index,
            concurrency=concurrency,
            plan=plan,
            request_index=request_index,
            stage_name=stage_name,
            request_kind=request_kind,
            think_time_before_s=think_time_before_s,
        )
        session_requests.append(result)
        if not result.success or assistant_message is None:
            return None
        if request_kind == "tool":
            append_tool_messages(messages=messages, assistant_message=assistant_message, case=plan.case, plan=plan)
        else:
            messages.append({"role": "assistant", "content": assistant_message.get("content", "") or ""})
        return assistant_message

    if (
        call_and_store(
            user_content=(
                original_prompt
                + "\n\nBefore writing code, inspect the real workspace layout with the tool. "
                + "Do not provide the final implementation yet."
            ),
            stage_name="manifest",
            request_kind="tool",
            tool_choice={"type": "function", "function": {"name": "workspace_manifest"}},
            max_tokens=128,
            think_time_before_s=plan.arrival_delay_s,
            include_tools=True,
        )
        is None
    ):
        return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests

    maybe_sleep(plan.think_times_s[0])
    if (
        call_and_store(
            user_content=(
                "Summarize the important files and the likely security hotspot in at most five bullets. "
                "Do not write code yet."
            ),
            stage_name="manifest-summary",
            request_kind="chat",
            tool_choice=None,
            max_tokens=plan.profile.summary_max_tokens,
            think_time_before_s=plan.think_times_s[0],
            include_tools=False,
        )
        is None
    ):
        return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests

    maybe_sleep(plan.think_times_s[1])
    if (
        call_and_store(
            user_content=(
                f"Inspect the most relevant artifact for this task. Prefer `{plan.focus_role}` unless another file is strictly necessary."
            ),
            stage_name="artifact-read",
            request_kind="tool",
            tool_choice={"type": "function", "function": {"name": "read_workspace_artifact"}},
            max_tokens=128,
            think_time_before_s=plan.think_times_s[1],
            include_tools=True,
        )
        is None
    ):
        return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests

    maybe_sleep(plan.think_times_s[2])
    if (
        call_and_store(
            user_content=(
                "Based on the artifact you just inspected, explain the concrete risk and the main implementation constraint. "
                "Keep it short."
            ),
            stage_name="artifact-summary",
            request_kind="chat",
            tool_choice=None,
            max_tokens=plan.profile.summary_max_tokens,
            think_time_before_s=plan.think_times_s[2],
            include_tools=False,
        )
        is None
    ):
        return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests

    maybe_sleep(plan.think_times_s[3])
    if (
        call_and_store(
            user_content=(
                f"Extract the functional and security expectations from the tests. Use focus=`{plan.expectation_focus}`."
            ),
            stage_name="expectation-inspection",
            request_kind="tool",
            tool_choice={"type": "function", "function": {"name": "inspect_test_expectations"}},
            max_tokens=128,
            think_time_before_s=plan.think_times_s[3],
            include_tools=True,
        )
        is None
    ):
        return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests

    maybe_sleep(plan.think_times_s[4])
    if (
        call_and_store(
            user_content=(
                "Now propose a patch plan that will satisfy the functional and security expectations. "
                "Do not write the final code yet."
            ),
            stage_name="patch-plan",
            request_kind="chat",
            tool_choice=None,
            max_tokens=plan.profile.summary_max_tokens + 60,
            think_time_before_s=plan.think_times_s[4],
            include_tools=False,
        )
        is None
    ):
        return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests

    maybe_sleep(plan.think_times_s[5])
    call_and_store(
        user_content=(
            "Write the final implementation now. Follow the original output contract from the SecureCode prompt exactly."
        ),
        stage_name="final-answer",
        request_kind="chat",
        tool_choice=None,
        max_tokens=plan.profile.final_max_tokens,
        think_time_before_s=plan.think_times_s[5],
        include_tools=False,
    )
    return build_session_result(phase_index, concurrency, plan, started, session_requests), session_requests


def build_session_result(
    phase_index: int,
    concurrency: int,
    plan: SessionPlan,
    started: datetime,
    requests: list[SessionRequestResult],
) -> SessionResult:
    ended = parse_timestamp(requests[-1].ended_at) if requests else datetime.now(UTC)
    if ended is None:
        ended = datetime.now(UTC)
    success = bool(requests) and all(item.success for item in requests)
    prompt_tokens = sum(item.prompt_tokens or 0 for item in requests)
    completion_tokens = sum(item.completion_tokens or 0 for item in requests)
    total_tokens = sum(item.total_tokens or 0 for item in requests)
    total_tool_calls = sum(item.tool_call_count for item in requests)
    return SessionResult(
        phase=phase_index,
        concurrency=concurrency,
        session_id=plan.session_id,
        case_id=plan.case.case_id,
        scenario=plan.scenario,
        severity=plan.case.severity,
        profile=plan.profile.name,
        started_at=started.isoformat(),
        ended_at=ended.isoformat(),
        elapsed_s=(ended - started).total_seconds(),
        request_count=len(requests),
        success=success,
        total_prompt_tokens=prompt_tokens,
        total_completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        total_tool_calls=total_tool_calls,
    )


def build_concurrency_series(
    *,
    items: list[tuple[datetime, datetime]],
    phase_start: datetime,
    phase_end: datetime,
    bucket_seconds: int,
) -> dict[int, list[int]]:
    if phase_end <= phase_start:
        return {}
    total_buckets = max(1, int(((phase_end - phase_start).total_seconds() // bucket_seconds)) + 1)
    series: dict[int, list[int]] = {index: [] for index in range(total_buckets)}
    cursor = phase_start
    while cursor <= phase_end:
        bucket_index = min(total_buckets - 1, int((cursor - phase_start).total_seconds() // bucket_seconds))
        active = 0
        for item_start, item_end in items:
            if item_start <= cursor < item_end:
                active += 1
        series[bucket_index].append(active)
        cursor += timedelta(seconds=1)
    return series


def bucket_session_series(
    *,
    requests: list[SessionRequestResult],
    sessions: list[SessionResult],
    phase_start: datetime,
    phase_end: datetime,
    bucket_seconds: int,
) -> tuple[list[dict[str, Any]], dict[str, float | None]]:
    successful_requests = [item for item in requests if item.success]
    bucket_completion: dict[int, int] = {}
    bucket_output_tokens: dict[int, int] = {}
    for request in successful_requests:
        ended_at = parse_timestamp(request.ended_at)
        if ended_at is None:
            continue
        bucket_index = max(0, int((ended_at - phase_start).total_seconds() // bucket_seconds))
        bucket_completion[bucket_index] = bucket_completion.get(bucket_index, 0) + 1
        bucket_output_tokens[bucket_index] = bucket_output_tokens.get(bucket_index, 0) + (request.completion_tokens or 0)

    request_windows = []
    for request in requests:
        req_start = parse_timestamp(request.started_at)
        req_end = parse_timestamp(request.ended_at)
        if req_start is None or req_end is None:
            continue
        request_windows.append((req_start, req_end))

    session_windows = []
    for session in sessions:
        sess_start = parse_timestamp(session.started_at)
        sess_end = parse_timestamp(session.ended_at)
        if sess_start is None or sess_end is None:
            continue
        session_windows.append((sess_start, sess_end))

    request_concurrency = build_concurrency_series(
        items=request_windows,
        phase_start=phase_start,
        phase_end=phase_end,
        bucket_seconds=bucket_seconds,
    )
    session_concurrency = build_concurrency_series(
        items=session_windows,
        phase_start=phase_start,
        phase_end=phase_end,
        bucket_seconds=bucket_seconds,
    )

    max_bucket = max(
        list(bucket_completion.keys()) + list(request_concurrency.keys()) + list(session_concurrency.keys()) + [0]
    )
    rows: list[dict[str, Any]] = []
    completion_rps_values: list[float] = []
    inflight_request_avg_values: list[float] = []
    active_session_avg_values: list[float] = []
    for bucket_index in range(max_bucket + 1):
        completions = bucket_completion.get(bucket_index, 0)
        output_tokens = bucket_output_tokens.get(bucket_index, 0)
        request_samples = request_concurrency.get(bucket_index, [0])
        session_samples = session_concurrency.get(bucket_index, [0])
        request_avg = statistics.mean(request_samples) if request_samples else 0.0
        session_avg = statistics.mean(session_samples) if session_samples else 0.0
        row = {
            "bucket_index": bucket_index,
            "start_offset_s": bucket_index * bucket_seconds,
            "completion_count": completions,
            "completion_rps": completions / bucket_seconds,
            "output_tps": output_tokens / bucket_seconds,
            "inflight_requests_avg": request_avg,
            "inflight_requests_max": max(request_samples) if request_samples else 0,
            "active_sessions_avg": session_avg,
            "active_sessions_max": max(session_samples) if session_samples else 0,
        }
        rows.append(row)
        completion_rps_values.append(row["completion_rps"])
        inflight_request_avg_values.append(request_avg)
        active_session_avg_values.append(session_avg)

    completion_stats = stats_for(completion_rps_values)
    inflight_stats = stats_for(inflight_request_avg_values)
    active_session_stats = stats_for(active_session_avg_values)
    summary = {
        "bucket_seconds": bucket_seconds,
        "completion_rps_avg": completion_stats.get("avg"),
        "completion_rps_p95": completion_stats.get("p95"),
        "completion_rps_max": completion_stats.get("max"),
        "inflight_requests_avg": inflight_stats.get("avg"),
        "inflight_requests_p95": inflight_stats.get("p95"),
        "inflight_requests_max": inflight_stats.get("max"),
        "active_sessions_avg": active_session_stats.get("avg"),
        "active_sessions_p95": active_session_stats.get("p95"),
        "active_sessions_max": active_session_stats.get("max"),
    }
    return rows, summary


def summarize_session_phase(
    *,
    phase_index: int,
    concurrency: int,
    requests: list[SessionRequestResult],
    sessions: list[SessionResult],
    phase_start: datetime,
    phase_end: datetime,
    bucket_seconds: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    elapsed_s = (phase_end - phase_start).total_seconds()
    successful_requests = [item for item in requests if item.success]
    request_latencies = [item.latency_s for item in successful_requests]
    session_durations = [item.elapsed_s for item in sessions if item.success]
    prompt_tokens = sum(item.prompt_tokens or 0 for item in successful_requests)
    completion_tokens = sum(item.completion_tokens or 0 for item in successful_requests)
    total_tokens = sum(item.total_tokens or 0 for item in successful_requests)
    tool_calls = sum(item.tool_call_count for item in successful_requests)
    request_latency_stats = stats_for(request_latencies)
    session_duration_stats = stats_for(session_durations)
    bucket_rows, bucket_summary = bucket_session_series(
        requests=requests,
        sessions=sessions,
        phase_start=phase_start,
        phase_end=phase_end,
        bucket_seconds=bucket_seconds,
    )
    stage_counter = {}
    for item in successful_requests:
        stage_counter[item.stage_name] = stage_counter.get(item.stage_name, 0) + 1
    profile_counter = {}
    for session in sessions:
        profile_counter[session.profile] = profile_counter.get(session.profile, 0) + 1

    summary = {
        "phase": phase_index,
        "concurrency": concurrency,
        "phase_started_at": phase_start.isoformat(),
        "phase_ended_at": phase_end.isoformat(),
        "session_count": len(sessions),
        "session_success_count": sum(1 for item in sessions if item.success),
        "session_success_rate": (sum(1 for item in sessions if item.success) / len(sessions)) if sessions else 0.0,
        "request_count": len(requests),
        "request_success_count": len(successful_requests),
        "request_success_rate": (len(successful_requests) / len(requests)) if requests else 0.0,
        "elapsed_s": elapsed_s,
        "session_throughput_sps": (len(sessions) / elapsed_s) if elapsed_s else 0.0,
        "request_throughput_rps": (len(successful_requests) / elapsed_s) if elapsed_s else 0.0,
        "avg_request_latency_s": request_latency_stats.get("avg"),
        "p95_request_latency_s": request_latency_stats.get("p95"),
        "p99_request_latency_s": request_latency_stats.get("p99"),
        "max_request_latency_s": request_latency_stats.get("max"),
        "avg_session_duration_s": session_duration_stats.get("avg"),
        "p95_session_duration_s": session_duration_stats.get("p95"),
        "p99_session_duration_s": session_duration_stats.get("p99"),
        "max_session_duration_s": session_duration_stats.get("max"),
        "prompt_tokens_total": prompt_tokens,
        "completion_tokens_total": completion_tokens,
        "total_tokens_total": total_tokens,
        "output_tps": (completion_tokens / elapsed_s) if elapsed_s else 0.0,
        "avg_prompt_tokens_per_request": (prompt_tokens / len(successful_requests)) if successful_requests else None,
        "avg_completion_tokens_per_request": (completion_tokens / len(successful_requests)) if successful_requests else None,
        "avg_total_tokens_per_session": (total_tokens / len(sessions)) if sessions else None,
        "avg_tool_calls_per_session": (tool_calls / len(sessions)) if sessions else None,
        "avg_requests_per_session": (len(requests) / len(sessions)) if sessions else None,
        "stage_mix": stage_counter,
        "profile_mix": profile_counter,
    }
    summary.update(bucket_summary)
    return summary, bucket_rows


def detect_session_ceiling(phase_summaries: list[dict[str, Any]]) -> dict[str, Any]:
    if len(phase_summaries) < 2:
        return {"status": "insufficient-data"}
    previous = phase_summaries[0]
    slowdown_hits = 0
    first_slowdown_candidate: dict[str, Any] | None = None
    for current in phase_summaries[1:]:
        prev_rps = previous.get("request_throughput_rps") or 0.0
        curr_rps = current.get("request_throughput_rps") or 0.0
        prev_p95 = previous.get("p95_request_latency_s") or 0.0
        curr_p95 = current.get("p95_request_latency_s") or 0.0
        prev_session_p95 = previous.get("p95_session_duration_s") or 0.0
        curr_session_p95 = current.get("p95_session_duration_s") or 0.0
        throughput_gain = ((curr_rps - prev_rps) / prev_rps) if prev_rps else None
        request_latency_growth = ((curr_p95 - prev_p95) / prev_p95) if prev_p95 else None
        session_latency_growth = ((curr_session_p95 - prev_session_p95) / prev_session_p95) if prev_session_p95 else None

        if current.get("request_success_rate", 0.0) < 0.99 or current.get("session_success_rate", 0.0) < 0.98:
            return {
                "status": "error-onset",
                "ceiling_concurrency": previous["concurrency"],
                "failure_concurrency": current["concurrency"],
                "reason": "request or session failures increased",
                "throughput_gain_ratio": throughput_gain,
                "request_latency_growth_ratio": request_latency_growth,
                "session_latency_growth_ratio": session_latency_growth,
            }

        if throughput_gain is not None and request_latency_growth is not None and session_latency_growth is not None:
            if throughput_gain < 0.07 and (request_latency_growth > 0.18 or session_latency_growth > 0.18):
                if slowdown_hits == 0:
                    first_slowdown_candidate = previous
                slowdown_hits += 1
            else:
                slowdown_hits = 0
                first_slowdown_candidate = None
            if slowdown_hits >= 2:
                candidate = first_slowdown_candidate or previous
                return {
                    "status": "observed-saturation",
                    "ceiling_concurrency": candidate["concurrency"],
                    "failure_concurrency": current["concurrency"],
                    "reason": "session throughput flattened while request and session latency kept rising",
                    "throughput_gain_ratio": throughput_gain,
                    "request_latency_growth_ratio": request_latency_growth,
                    "session_latency_growth_ratio": session_latency_growth,
                }
        previous = current
    return {
        "status": "not-reached",
        "ceiling_concurrency": phase_summaries[-1]["concurrency"],
        "reason": "highest tested session concurrency still held without a clear saturation break",
    }


def choose_session_tiers(
    phase_summaries: list[dict[str, Any]],
    interactive_request_p95_s: float,
    interactive_session_p95_s: float,
    batch_request_p95_s: float,
    batch_session_p95_s: float,
) -> dict[str, dict[str, Any] | None]:
    interactive = None
    batch = None
    for summary in phase_summaries:
        if (
            summary["request_success_rate"] >= 0.99
            and summary["session_success_rate"] >= 0.98
            and (summary["p95_request_latency_s"] or float("inf")) <= batch_request_p95_s
            and (summary["p95_session_duration_s"] or float("inf")) <= batch_session_p95_s
        ):
            batch = summary
        if (
            summary["request_success_rate"] >= 0.99
            and summary["session_success_rate"] >= 0.98
            and (summary["p95_request_latency_s"] or float("inf")) <= interactive_request_p95_s
            and (summary["p95_session_duration_s"] or float("inf")) <= interactive_session_p95_s
        ):
            interactive = summary
    return {"interactive": interactive, "batch": batch}


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def run_phase(
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    phase_index: int,
    concurrency: int,
    plans: list[SessionPlan],
    tool_specs: list[dict[str, Any]],
    locale: str,
    timeout_s: int,
    temperature: float,
    bucket_seconds: int,
) -> tuple[list[SessionRequestResult], list[SessionResult], dict[str, Any], list[dict[str, Any]]]:
    phase_start = datetime.now(UTC)
    request_results: list[SessionRequestResult] = []
    session_results: list[SessionResult] = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(
                run_session,
                base_url=base_url,
                model=model,
                api_key=api_key,
                phase_index=phase_index,
                concurrency=concurrency,
                plan=plan,
                tool_specs=tool_specs,
                locale=locale,
                timeout_s=timeout_s,
                temperature=temperature,
            )
            for plan in plans
        ]
        for future in as_completed(futures):
            session_result, session_request_results = future.result()
            session_results.append(session_result)
            request_results.extend(session_request_results)
    phase_end = datetime.now(UTC)
    summary, bucket_rows = summarize_session_phase(
        phase_index=phase_index,
        concurrency=concurrency,
        requests=request_results,
        sessions=session_results,
        phase_start=phase_start,
        phase_end=phase_end,
        bucket_seconds=bucket_seconds,
    )
    return request_results, session_results, summary, bucket_rows


def main() -> int:
    load_env_file(ASSET_DIR / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--api-key", default=os.environ.get("OPENAI_API_KEY", ""))
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--workload-file", default=str(ASSET_DIR / "workload" / "securecode_workload.json"))
    parser.add_argument(
        "--sec-code-bench-dir",
        default=os.environ.get(
            "SECURECODE_SEC_CODE_BENCH_DIR",
            str(Path.home() / ".cache" / "securecode" / "sec-code-bench"),
        ),
    )
    parser.add_argument("--sec-code-bench-repo", default=DEFAULT_SEC_CODE_BENCH_REPO)
    parser.add_argument("--sec-code-bench-ref", default=DEFAULT_SEC_CODE_BENCH_REF)
    parser.add_argument("--locale", default=os.environ.get("SECURECODE_LOCALE", "zh-CN"))
    parser.add_argument("--concurrency", default="8,16,24")
    parser.add_argument("--seed", type=int, default=DEFAULT_SESSION_SEED)
    parser.add_argument("--bucket-seconds", type=int, default=5)
    parser.add_argument("--timeout-s", type=int, default=900)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--backing-model", default=DEFAULT_BACKING_MODEL)
    parser.add_argument("--remote-host", default=os.environ.get("SECURECODE_REMOTE_HOST") or os.environ.get("NCC_SSH_HOST"))
    parser.add_argument(
        "--remote-ncc-dir",
        default=os.environ.get("SECURECODE_REMOTE_MONITOR_DIR", ""),
    )
    parser.add_argument("--remote-run-root", default=os.environ.get("SECURECODE_REMOTE_RUN_ROOT", DEFAULT_REMOTE_RUN_ROOT))
    parser.add_argument("--interactive-request-p95-s", type=float, default=20.0)
    parser.add_argument("--interactive-session-p95-s", type=float, default=180.0)
    parser.add_argument("--batch-request-p95-s", type=float, default=45.0)
    parser.add_argument("--batch-session-p95-s", type=float, default=360.0)
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    monitoring_dir = output_dir / "monitoring"

    if args.remote_host and not args.remote_ncc_dir:
        raise SystemExit("--remote-ncc-dir is required when --remote-host is set")

    sec_code_bench_dir = Path(args.sec_code_bench_dir).resolve()
    ensure_sec_code_bench(sec_code_bench_dir, args.sec_code_bench_repo, args.sec_code_bench_ref)
    cases = load_securecode_cases(
        workload_file=Path(args.workload_file),
        sec_code_bench_dir=sec_code_bench_dir,
    )
    tool_specs = build_tool_specs()

    remote_monitor_dir = None
    if args.remote_host:
        remote_monitor_dir = f"{args.remote_run_root.rstrip('/')}/{output_dir.name}"
        run_remote(
            args.remote_host,
            f"cd {args.remote_ncc_dir} && ./securecode_monitor_remote.sh start {remote_monitor_dir}",
        )

    all_request_results: list[dict[str, Any]] = []
    all_session_results: list[dict[str, Any]] = []
    phase_summaries: list[dict[str, Any]] = []
    bucket_rows: list[dict[str, Any]] = []
    try:
        for phase_index, concurrency in enumerate(
            [int(item.strip()) for item in args.concurrency.split(",") if item.strip()],
            start=1,
        ):
            print(f"[phase {phase_index}] sessions={concurrency}", flush=True)
            plans = build_session_plans(cases, concurrency, args.seed + phase_index)
            request_results, session_results, phase_summary, phase_bucket_rows = run_phase(
                base_url=args.base_url,
                model=args.model,
                api_key=args.api_key or None,
                phase_index=phase_index,
                concurrency=concurrency,
                plans=plans,
                tool_specs=tool_specs,
                locale=args.locale,
                timeout_s=args.timeout_s,
                temperature=args.temperature,
                bucket_seconds=args.bucket_seconds,
            )
            phase_summaries.append(phase_summary)
            all_request_results.extend(asdict(item) for item in request_results)
            all_session_results.extend(asdict(item) for item in session_results)
            bucket_rows.extend(
                {"phase": phase_index, "concurrency": concurrency, **row}
                for row in phase_bucket_rows
            )
            print(json.dumps(phase_summary, ensure_ascii=False), flush=True)
    finally:
        if args.remote_host:
            run_remote(
                args.remote_host,
                f"cd {args.remote_ncc_dir} && ./securecode_monitor_remote.sh stop",
            )
            fetch_monitoring(args.remote_host, remote_monitor_dir, monitoring_dir)

    gpu_monitor, system_monitor = apply_monitoring_to_phases(phase_summaries, monitoring_dir)
    tiers = choose_session_tiers(
        phase_summaries,
        args.interactive_request_p95_s,
        args.interactive_session_p95_s,
        args.batch_request_p95_s,
        args.batch_session_p95_s,
    )
    ceiling = detect_session_ceiling(phase_summaries)

    (output_dir / "request_results.jsonl").write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in all_request_results) + "\n"
    )
    (output_dir / "session_results.jsonl").write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in all_session_results) + "\n"
    )
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "model": args.model,
        "backing_model": args.backing_model,
        "base_url": args.base_url,
        "concurrency": args.concurrency,
        "phase_summaries": phase_summaries,
        "ceiling": ceiling,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    write_csv(output_dir / "phase_metrics.csv", phase_summaries)
    write_csv(output_dir / "phase_buckets.csv", bucket_rows)
    print(f"results written to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
