#!/usr/bin/env python3
"""Run SecCodeBench-derived API load tests and render a report."""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
ASSET_DIR = SCRIPT_DIR.parent
DEFAULT_SEC_CODE_BENCH_REF = "v2.0.0"
DEFAULT_SEC_CODE_BENCH_REPO = "https://github.com/alibaba/sec-code-bench.git"
DEFAULT_BACKING_MODEL = "unspecified"
DEFAULT_MODEL = "model-under-test"
DEFAULT_BASE_URL = "http://localhost:8080/v1"
DEFAULT_REMOTE_RUN_ROOT = "~/.cache/securecode/securecode-monitor/runs"


@dataclass
class WorkloadPrompt:
    case_id: str
    scenario: str
    severity: str
    notes: str
    prompt: str


@dataclass
class RequestResult:
    phase: int
    concurrency: int
    prompt_id: str
    scenario: str
    severity: str
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


def ensure_sec_code_bench(local_dir: Path, repo_url: str, ref: str) -> None:
    if (local_dir / ".git").exists():
        return
    local_dir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", ref, repo_url, str(local_dir)],
        check=True,
    )


def load_workload_prompts(workload_file: Path, sec_code_bench_dir: Path) -> list[WorkloadPrompt]:
    workload_spec = json.loads(workload_file.read_text())
    testcase_dir = sec_code_bench_dir / "docs" / "json" / "testcase-info"
    prompts: list[WorkloadPrompt] = []

    for item in workload_spec:
        case_id = item["id"]
        scenario = item["scenario"]
        testcase_info = json.loads((testcase_dir / f"{case_id}.json").read_text())
        scenario_data = testcase_info[scenario]
        prompts.append(
            WorkloadPrompt(
                case_id=case_id,
                scenario=scenario,
                severity=item["severity"],
                notes=item["notes"],
                prompt=scenario_data["prompt"],
            )
        )

    return prompts


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    floor = math.floor(k)
    ceil = math.ceil(k)
    if floor == ceil:
        return ordered[int(k)]
    return ordered[floor] + (ordered[ceil] - ordered[floor]) * (k - floor)


def parse_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.strip()
    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except ValueError:
        pass
    if normalized.endswith("Z"):
        try:
            return datetime.fromisoformat(normalized.replace("Z", "+00:00")).astimezone(UTC)
        except ValueError:
            pass
    for fmt in ("%Y/%m/%d %H:%M:%S.%f", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(normalized, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def stats_for(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {}
    avg = statistics.mean(values)
    median = statistics.median(values)
    return {
        "min": min(values),
        "avg": avg,
        "p50": percentile(values, 0.50),
        "p90": percentile(values, 0.90),
        "p95": percentile(values, 0.95),
        "p99": percentile(values, 0.99),
        "max": max(values),
        "stdev": statistics.stdev(values) if len(values) > 1 else 0.0,
        "cv": ((statistics.stdev(values) / avg) if len(values) > 1 and avg else 0.0),
        "median": median,
    }


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def call_chat_completion(
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    prompt: WorkloadPrompt,
    max_tokens: int,
    temperature: float,
    phase_index: int,
    concurrency: int,
) -> RequestResult:
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt.prompt}],
    }
    req = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "chat/completions"),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")

    started = datetime.now(UTC)
    start_ts = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=900) as response:
            body = json.loads(response.read())
            ended = datetime.now(UTC)
            latency = time.perf_counter() - start_ts
            usage = body.get("usage", {})
            content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
            return RequestResult(
                phase=phase_index,
                concurrency=concurrency,
                prompt_id=prompt.case_id,
                scenario=prompt.scenario,
                severity=prompt.severity,
                started_at=started.isoformat(),
                ended_at=ended.isoformat(),
                latency_s=latency,
                success=True,
                status_code=response.status,
                error=None,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
                output_chars=len(content),
            )
    except urllib.error.HTTPError as exc:
        ended = datetime.now(UTC)
        latency = time.perf_counter() - start_ts
        body = exc.read().decode("utf-8", errors="ignore")
        return RequestResult(
            phase=phase_index,
            concurrency=concurrency,
            prompt_id=prompt.case_id,
            scenario=prompt.scenario,
            severity=prompt.severity,
            started_at=started.isoformat(),
            ended_at=ended.isoformat(),
            latency_s=latency,
            success=False,
            status_code=exc.code,
            error=body[:500],
            prompt_tokens=None,
            completion_tokens=None,
            total_tokens=None,
            output_chars=None,
        )
    except Exception as exc:  # noqa: BLE001
        ended = datetime.now(UTC)
        latency = time.perf_counter() - start_ts
        return RequestResult(
            phase=phase_index,
            concurrency=concurrency,
            prompt_id=prompt.case_id,
            scenario=prompt.scenario,
            severity=prompt.severity,
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
        )


def bucket_series(
    results: list[RequestResult],
    phase_start: datetime,
    bucket_seconds: int,
) -> tuple[list[dict[str, float | int]], dict[str, float | None]]:
    successful = [item for item in results if item.success]
    if not successful:
        return [], {}

    bucket_counts: dict[int, int] = defaultdict(int)
    bucket_output_tokens: dict[int, int] = defaultdict(int)
    for item in successful:
        ended_at = parse_timestamp(item.ended_at)
        if ended_at is None:
            continue
        bucket_index = max(0, int((ended_at - phase_start).total_seconds() // bucket_seconds))
        bucket_counts[bucket_index] += 1
        bucket_output_tokens[bucket_index] += item.completion_tokens or 0

    last_index = max(bucket_counts) if bucket_counts else 0
    rows: list[dict[str, float | int]] = []
    rps_values: list[float] = []
    output_tps_values: list[float] = []
    for bucket_index in range(last_index + 1):
        request_count = bucket_counts.get(bucket_index, 0)
        output_tokens = bucket_output_tokens.get(bucket_index, 0)
        rps = request_count / bucket_seconds
        output_tps = output_tokens / bucket_seconds
        rows.append(
            {
                "bucket_index": bucket_index,
                "start_offset_s": bucket_index * bucket_seconds,
                "request_count": request_count,
                "throughput_rps": rps,
                "output_tps": output_tps,
            }
        )
        rps_values.append(rps)
        output_tps_values.append(output_tps)

    rps_stats = stats_for(rps_values)
    output_tps_stats = stats_for(output_tps_values)
    summary = {
        "bucket_seconds": bucket_seconds,
        "completion_rps_avg": rps_stats.get("avg"),
        "completion_rps_p95": rps_stats.get("p95"),
        "completion_rps_max": rps_stats.get("max"),
        "completion_rps_cv": rps_stats.get("cv"),
        "completion_output_tps_avg": output_tps_stats.get("avg"),
        "completion_output_tps_p95": output_tps_stats.get("p95"),
        "completion_output_tps_max": output_tps_stats.get("max"),
        "completion_output_tps_cv": output_tps_stats.get("cv"),
    }
    return rows, summary


def summarize_phase_results(
    *,
    phase_index: int,
    concurrency: int,
    results: list[RequestResult],
    phase_start: datetime,
    phase_end: datetime,
    bucket_seconds: int,
) -> tuple[dict[str, Any], list[dict[str, float | int]]]:
    phase_elapsed = (phase_end - phase_start).total_seconds()
    successes = [item for item in results if item.success]
    latencies = [item.latency_s for item in successes]
    latency_stats = stats_for(latencies)
    success_count = len(successes)
    request_count = len(results)
    prompt_tokens = sum(item.prompt_tokens or 0 for item in successes)
    completion_tokens = sum(item.completion_tokens or 0 for item in successes)
    total_tokens = sum(item.total_tokens or 0 for item in successes)
    status_counts = Counter(str(item.status_code) if item.status_code is not None else "exception" for item in results if not item.success)

    bucket_rows, bucket_summary = bucket_series(results, phase_start, bucket_seconds)
    median_latency = latency_stats.get("median") or 0.0
    p95_latency = latency_stats.get("p95") or 0.0
    latency_spike_count = sum(1 for latency in latencies if median_latency and latency >= median_latency * 2)
    latency_spike_15s_count = sum(1 for latency in latencies if latency >= 15.0)
    latency_spike_p95_count = sum(1 for latency in latencies if p95_latency and latency >= p95_latency)

    summary = {
        "phase": phase_index,
        "concurrency": concurrency,
        "phase_started_at": phase_start.isoformat(),
        "phase_ended_at": phase_end.isoformat(),
        "request_count": request_count,
        "success_count": success_count,
        "error_count": request_count - success_count,
        "success_rate": (success_count / request_count) if request_count else 0.0,
        "elapsed_s": phase_elapsed,
        "throughput_rps": (success_count / phase_elapsed) if phase_elapsed else 0.0,
        "avg_latency_s": latency_stats.get("avg"),
        "latency_min_s": latency_stats.get("min"),
        "p50_latency_s": latency_stats.get("p50"),
        "p90_latency_s": latency_stats.get("p90"),
        "p95_latency_s": latency_stats.get("p95"),
        "p99_latency_s": latency_stats.get("p99"),
        "latency_max_s": latency_stats.get("max"),
        "latency_stdev_s": latency_stats.get("stdev"),
        "latency_cv": latency_stats.get("cv"),
        "latency_spike_over_2x_median_count": latency_spike_count,
        "latency_spike_over_2x_median_rate": (latency_spike_count / success_count) if success_count else 0.0,
        "latency_over_15s_count": latency_spike_15s_count,
        "latency_over_15s_rate": (latency_spike_15s_count / success_count) if success_count else 0.0,
        "latency_at_or_above_p95_count": latency_spike_p95_count,
        "latency_at_or_above_p95_rate": (latency_spike_p95_count / success_count) if success_count else 0.0,
        "prompt_tokens_total": prompt_tokens,
        "completion_tokens_total": completion_tokens,
        "total_tokens_total": total_tokens,
        "output_tps": (completion_tokens / phase_elapsed) if phase_elapsed else 0.0,
        "total_tps": (total_tokens / phase_elapsed) if phase_elapsed else 0.0,
        "avg_prompt_tokens": (prompt_tokens / success_count) if success_count else None,
        "avg_completion_tokens": (completion_tokens / success_count) if success_count else None,
        "error_status_counts": dict(status_counts),
    }
    summary.update(bucket_summary)
    return summary, bucket_rows


def run_phase(
    *,
    base_url: str,
    model: str,
    api_key: str | None,
    workload: list[WorkloadPrompt],
    concurrency: int,
    max_tokens: int,
    temperature: float,
    phase_index: int,
    bucket_seconds: int,
) -> tuple[list[RequestResult], dict[str, Any], list[dict[str, float | int]]]:
    phase_start = datetime.now(UTC)
    results: list[RequestResult] = []

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(
                call_chat_completion,
                base_url=base_url,
                model=model,
                api_key=api_key,
                prompt=prompt,
                max_tokens=max_tokens,
                temperature=temperature,
                phase_index=phase_index,
                concurrency=concurrency,
            )
            for prompt in workload
        ]
        for future in as_completed(futures):
            results.append(future.result())

    phase_end = datetime.now(UTC)
    summary, bucket_rows = summarize_phase_results(
        phase_index=phase_index,
        concurrency=concurrency,
        results=results,
        phase_start=phase_start,
        phase_end=phase_end,
        bucket_seconds=bucket_seconds,
    )
    return results, summary, bucket_rows


def parse_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    text = path.read_text()
    if not text.strip():
        return []
    return list(csv.DictReader(text.splitlines()))


def rows_in_window(rows: list[dict[str, str]], start: datetime, end: datetime) -> list[dict[str, str]]:
    selected: list[dict[str, str]] = []
    for row in rows:
        row_ts = parse_timestamp(row.get("timestamp", ""))
        if row_ts is None:
            continue
        if start <= row_ts <= end:
            selected.append(row)
    return selected


def summarize_gpu_window(rows: list[dict[str, str]]) -> dict[str, float | None]:
    if not rows:
        return {}
    gpu_util = [value for value in (parse_float(row.get("utilization.gpu")) for row in rows) if value is not None]
    memory_used = [value for value in (parse_float(row.get("memory.used")) for row in rows) if value is not None]
    power_draw = [value for value in (parse_float(row.get("power.draw")) for row in rows) if value is not None]
    temp = [value for value in (parse_float(row.get("temperature.gpu")) for row in rows) if value is not None]
    gpu_stats = stats_for(gpu_util)
    mem_stats = stats_for(memory_used)
    power_stats = stats_for(power_draw)
    temp_stats = stats_for(temp)
    return {
        "gpu_samples": len(rows),
        "gpu_util_avg": gpu_stats.get("avg"),
        "gpu_util_p95": gpu_stats.get("p95"),
        "gpu_util_p99": gpu_stats.get("p99"),
        "gpu_util_max": gpu_stats.get("max"),
        "gpu_util_spike_seconds_gte_90": sum(1 for value in gpu_util if value >= 90.0),
        "gpu_util_spike_seconds_gte_95": sum(1 for value in gpu_util if value >= 95.0),
        "gpu_mem_used_avg_mb": mem_stats.get("avg"),
        "gpu_mem_used_p95_mb": mem_stats.get("p95"),
        "gpu_mem_used_max_mb": mem_stats.get("max"),
        "power_draw_avg_w": power_stats.get("avg"),
        "power_draw_p95_w": power_stats.get("p95"),
        "power_draw_max_w": power_stats.get("max"),
        "power_spike_seconds_gte_350": sum(1 for value in power_draw if value >= 350.0),
        "power_spike_seconds_gte_375": sum(1 for value in power_draw if value >= 375.0),
        "gpu_temp_avg_c": temp_stats.get("avg"),
        "gpu_temp_p95_c": temp_stats.get("p95"),
        "gpu_temp_max_c": temp_stats.get("max"),
        "gpu_temp_seconds_gte_70": sum(1 for value in temp if value >= 70.0),
    }


def summarize_system_window(rows: list[dict[str, str]]) -> dict[str, float | None]:
    if not rows:
        return {}
    load1 = [value for value in (parse_float(row.get("load1")) for row in rows) if value is not None]
    load5 = [value for value in (parse_float(row.get("load5")) for row in rows) if value is not None]
    mem_available = [value for value in (parse_float(row.get("mem_available_mb")) for row in rows) if value is not None]
    mem_used = [value for value in (parse_float(row.get("mem_used_mb")) for row in rows) if value is not None]
    root_used = [value for value in (parse_float(row.get("root_used_pct")) for row in rows) if value is not None]
    load1_stats = stats_for(load1)
    load5_stats = stats_for(load5)
    mem_available_stats = stats_for(mem_available)
    mem_used_stats = stats_for(mem_used)
    root_used_stats = stats_for(root_used)
    return {
        "system_samples": len(rows),
        "load1_avg": load1_stats.get("avg"),
        "load1_p95": load1_stats.get("p95"),
        "load1_max": load1_stats.get("max"),
        "load5_avg": load5_stats.get("avg"),
        "load5_p95": load5_stats.get("p95"),
        "mem_available_min_mb": mem_available_stats.get("min"),
        "mem_available_p05_mb": percentile(mem_available, 0.05) if mem_available else None,
        "mem_used_avg_mb": mem_used_stats.get("avg"),
        "mem_used_max_mb": mem_used_stats.get("max"),
        "root_used_max_pct": root_used_stats.get("max"),
    }


def apply_monitoring_to_phases(
    phase_summaries: list[dict[str, Any]],
    monitoring_dir: Path,
) -> tuple[dict[str, float | None], dict[str, float | None]]:
    gpu_rows = parse_csv_rows(monitoring_dir / "gpu_stats.csv")
    system_rows = parse_csv_rows(monitoring_dir / "system_stats.csv")

    for summary in phase_summaries:
        phase_start = parse_timestamp(summary["phase_started_at"])
        phase_end = parse_timestamp(summary["phase_ended_at"])
        if phase_start is None or phase_end is None:
            continue
        phase_gpu = summarize_gpu_window(rows_in_window(gpu_rows, phase_start, phase_end))
        phase_system = summarize_system_window(rows_in_window(system_rows, phase_start, phase_end))
        summary.update(phase_gpu)
        summary.update(phase_system)

    overall_gpu = summarize_gpu_window(gpu_rows)
    overall_system = summarize_system_window(system_rows)
    return overall_gpu, overall_system


def choose_capacity_tiers(
    phase_summaries: list[dict[str, Any]],
    interactive_p95_s: float,
    batch_p95_s: float,
) -> dict[str, dict[str, Any] | None]:
    interactive = None
    batch = None
    for summary in phase_summaries:
        if summary["success_rate"] >= 0.99 and (summary["p95_latency_s"] or float("inf")) <= batch_p95_s:
            batch = summary
        if summary["success_rate"] >= 0.99 and (summary["p95_latency_s"] or float("inf")) <= interactive_p95_s:
            interactive = summary
    return {"interactive": interactive, "batch": batch}


def detect_ceiling(phase_summaries: list[dict[str, Any]]) -> dict[str, Any]:
    if len(phase_summaries) < 2:
        return {"status": "insufficient-data"}

    min_success_rate = 0.99
    min_signal_errors = 5
    min_signal_error_rate = 0.02
    min_tail_rate = 0.02
    min_plateau_gain = 0.05
    min_latency_growth = 0.20
    strong_plateau_gain = 0.02
    strong_latency_growth = 0.30

    def error_rate(summary: dict[str, Any]) -> float:
        requests = summary.get("request_count") or 0
        if not requests:
            return 0.0
        return (summary.get("error_count") or 0) / requests

    def degraded(summary: dict[str, Any]) -> tuple[bool, str | None]:
        if (summary.get("success_rate") or 0.0) < min_success_rate:
            return True, "success rate dropped below target"
        if (summary.get("latency_over_15s_rate") or 0.0) >= min_tail_rate:
            return True, "tail latency exceeded threshold"
        if (summary.get("error_count") or 0) >= min_signal_errors and error_rate(summary) >= min_signal_error_rate:
            return True, "error rate exceeded threshold"
        return False, None

    previous = phase_summaries[0]
    last_healthy = previous
    slowdown_hits = 0
    for current in phase_summaries[1:]:
        prev_throughput = previous.get("throughput_rps") or 0.0
        curr_throughput = current.get("throughput_rps") or 0.0
        prev_p95 = previous.get("p95_latency_s") or 0.0
        curr_p95 = current.get("p95_latency_s") or 0.0
        throughput_gain = ((curr_throughput - prev_throughput) / prev_throughput) if prev_throughput else None
        latency_growth = ((curr_p95 - prev_p95) / prev_p95) if prev_p95 else None

        is_degraded, reason = degraded(current)
        strong_plateau = (
            throughput_gain is not None
            and latency_growth is not None
            and throughput_gain < strong_plateau_gain
            and latency_growth > strong_latency_growth
        )
        if strong_plateau:
            return {
                "status": "observed-saturation",
                "ceiling_concurrency": current["concurrency"],
                "previous_healthy_concurrency": previous["concurrency"],
                "failure_concurrency": current["concurrency"],
                "reason": "throughput stopped growing while latency jumped",
                "error_rate": error_rate(current),
                "success_rate": current.get("success_rate"),
                "latency_over_15s_rate": current.get("latency_over_15s_rate"),
                "throughput_gain_ratio": throughput_gain,
                "latency_growth_ratio": latency_growth,
            }
        if is_degraded and (error_rate(current) >= 0.10 or (throughput_gain is not None and throughput_gain < 0.10)):
            return {
                "status": "error-onset",
                "ceiling_concurrency": current["concurrency"],
                "previous_healthy_concurrency": last_healthy["concurrency"],
                "failure_concurrency": current["concurrency"],
                "reason": reason,
                "error_rate": error_rate(current),
                "success_rate": current.get("success_rate"),
                "latency_over_15s_rate": current.get("latency_over_15s_rate"),
                "throughput_gain_ratio": throughput_gain,
                "latency_growth_ratio": latency_growth,
            }

        if throughput_gain is not None and latency_growth is not None:
            if throughput_gain < min_plateau_gain and latency_growth > min_latency_growth:
                slowdown_hits += 1
            else:
                slowdown_hits = 0

            if slowdown_hits >= 2:
                return {
                    "status": "observed-saturation",
                    "ceiling_concurrency": current["concurrency"],
                    "previous_healthy_concurrency": previous["concurrency"],
                    "failure_concurrency": current["concurrency"],
                    "reason": "throughput gains flattened while latency kept rising",
                    "error_rate": error_rate(current),
                    "success_rate": current.get("success_rate"),
                    "latency_over_15s_rate": current.get("latency_over_15s_rate"),
                    "throughput_gain_ratio": throughput_gain,
                    "latency_growth_ratio": latency_growth,
                }
        last_healthy = current
        previous = current

    return {
        "status": "not-reached",
        "ceiling_concurrency": phase_summaries[-1]["concurrency"],
        "reason": "highest tested phase still increased throughput without errors",
    }


def write_phase_metrics_csv(output_dir: Path, phase_summaries: list[dict[str, Any]]) -> None:
    if not phase_summaries:
        return
    fieldnames = sorted({key for summary in phase_summaries for key in summary.keys()})
    with (output_dir / "phase_metrics.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for summary in phase_summaries:
            writer.writerow(summary)


def write_bucket_metrics_csv(output_dir: Path, bucket_rows: list[dict[str, Any]]) -> None:
    if not bucket_rows:
        return
    fieldnames = sorted({key for row in bucket_rows for key in row.keys()})
    with (output_dir / "phase_buckets.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in bucket_rows:
            writer.writerow(row)


def fetch_monitoring(remote_host: str, remote_dir: str, local_dir: Path) -> None:
    local_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["scp", "-r", f"{remote_host}:{remote_dir}/.", str(local_dir)],
        check=True,
    )


def run_remote(remote_host: str, command: str) -> None:
    subprocess.run(["ssh", remote_host, command], check=True)


def main() -> int:
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
    parser.add_argument("--concurrency", default="1,2,4")
    parser.add_argument("--max-tokens", type=int, default=512)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--cycles", type=int, default=1)
    parser.add_argument("--bucket-seconds", type=int, default=5)
    parser.add_argument("--backing-model", default=DEFAULT_BACKING_MODEL)
    parser.add_argument("--remote-host", default=os.environ.get("SECURECODE_REMOTE_HOST") or os.environ.get("NCC_SSH_HOST"))
    parser.add_argument(
        "--remote-ncc-dir",
        default=os.environ.get("SECURECODE_REMOTE_MONITOR_DIR", ""),
    )
    parser.add_argument("--remote-run-root", default=os.environ.get("SECURECODE_REMOTE_RUN_ROOT", DEFAULT_REMOTE_RUN_ROOT))
    parser.add_argument("--interactive-p95-s", type=float, default=45.0)
    parser.add_argument("--batch-p95-s", type=float, default=120.0)
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    monitoring_dir = output_dir / "monitoring"

    if args.remote_host and not args.remote_ncc_dir:
        raise SystemExit("--remote-ncc-dir is required when --remote-host is set")

    sec_code_bench_dir = Path(args.sec_code_bench_dir).resolve()
    ensure_sec_code_bench(sec_code_bench_dir, args.sec_code_bench_repo, args.sec_code_bench_ref)
    workload = load_workload_prompts(Path(args.workload_file), sec_code_bench_dir)
    expanded_workload = workload * max(args.cycles, 1)

    remote_monitor_dir = None
    if args.remote_host:
        remote_monitor_dir = f"{args.remote_run_root.rstrip('/')}/{output_dir.name}"
        run_remote(
            args.remote_host,
            f"cd {args.remote_ncc_dir} && ./securecode_monitor_remote.sh start {remote_monitor_dir}",
        )

    raw_results: list[dict[str, Any]] = []
    phase_summaries: list[dict[str, Any]] = []
    bucket_rows: list[dict[str, Any]] = []
    try:
        for phase_index, concurrency in enumerate(
            [int(item.strip()) for item in args.concurrency.split(",") if item.strip()],
            start=1,
        ):
            print(f"[phase {phase_index}] concurrency={concurrency}", flush=True)
            phase_results, phase_summary, phase_bucket_rows = run_phase(
                base_url=args.base_url,
                model=args.model,
                api_key=args.api_key or None,
                workload=expanded_workload,
                concurrency=concurrency,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
                phase_index=phase_index,
                bucket_seconds=args.bucket_seconds,
            )
            phase_summaries.append(phase_summary)
            raw_results.extend(asdict(item) for item in phase_results)
            for row in phase_bucket_rows:
                bucket_rows.append({"phase": phase_index, "concurrency": concurrency, **row})
            print(json.dumps(phase_summary, ensure_ascii=False), flush=True)
    finally:
        if args.remote_host:
            run_remote(
                args.remote_host,
                f"cd {args.remote_ncc_dir} && ./securecode_monitor_remote.sh stop",
            )
            fetch_monitoring(args.remote_host, remote_monitor_dir, monitoring_dir)

    (output_dir / "raw_results.jsonl").write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in raw_results) + "\n"
    )
    gpu_monitor, system_monitor = apply_monitoring_to_phases(phase_summaries, monitoring_dir)
    tiers = choose_capacity_tiers(phase_summaries, args.interactive_p95_s, args.batch_p95_s)
    ceiling = detect_ceiling(phase_summaries)

    summary_json = {
        "generated_at": datetime.now(UTC).isoformat(),
        "model": args.model,
        "backing_model": args.backing_model,
        "base_url": args.base_url,
        "workload_size": len(expanded_workload),
        "concurrency": args.concurrency,
        "phase_summaries": phase_summaries,
        "ceiling": ceiling,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary_json, indent=2, ensure_ascii=False))
    (output_dir / "phase_analysis.json").write_text(json.dumps(phase_summaries, indent=2, ensure_ascii=False))
    write_phase_metrics_csv(output_dir, phase_summaries)
    write_bucket_metrics_csv(output_dir, bucket_rows)
    print(f"results written to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
