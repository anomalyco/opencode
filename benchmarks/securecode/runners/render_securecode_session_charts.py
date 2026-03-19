#!/usr/bin/env python3
"""Render charts for a session-oriented SecureCode capacity benchmark run."""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def metric_float(row: dict[str, float | int | str], key: str) -> float:
    value = row.get(key, "")
    if value == "" or value is None:
        return math.nan
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except ValueError:
        return math.nan


def read_phase_metrics(path: Path) -> list[dict[str, float | int | str]]:
    rows: list[dict[str, float | int | str]] = []
    with path.open() as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            parsed: dict[str, float | int | str] = {}
            for key, value in row.items():
                if value is None:
                    parsed[key] = ""
                    continue
                if key in {"phase_started_at", "phase_ended_at", "stage_mix", "profile_mix"}:
                    parsed[key] = value
                    continue
                try:
                    if value.isdigit():
                        parsed[key] = int(value)
                    else:
                        parsed[key] = float(value)
                except ValueError:
                    parsed[key] = value
            rows.append(parsed)
    rows.sort(key=lambda item: int(item["concurrency"]))
    return rows


def read_phase_buckets(path: Path) -> list[dict[str, float | int]]:
    rows: list[dict[str, float | int]] = []
    with path.open() as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows.append(
                {
                    "phase": int(row["phase"]),
                    "concurrency": int(row["concurrency"]),
                    "bucket_index": int(row["bucket_index"]),
                    "start_offset_s": int(row["start_offset_s"]),
                    "completion_rps": float(row["completion_rps"]),
                    "output_tps": float(row["output_tps"]),
                    "inflight_requests_avg": float(row["inflight_requests_avg"]),
                    "active_sessions_avg": float(row["active_sessions_avg"]),
                }
            )
    return rows


def read_request_latencies(path: Path) -> dict[int, list[float]]:
    grouped: dict[int, list[float]] = {}
    with path.open() as handle:
        for line in handle:
            row = json.loads(line)
            if not row.get("success"):
                continue
            grouped.setdefault(int(row["concurrency"]), []).append(float(row["latency_s"]))
    return grouped


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def render_overview(metrics: list[dict[str, float | int | str]], output_path: Path) -> None:
    concurrency = [int(row["concurrency"]) for row in metrics]
    request_throughput = [metric_float(row, "request_throughput_rps") for row in metrics]
    p95_request = [metric_float(row, "p95_request_latency_s") for row in metrics]
    p95_session = [metric_float(row, "p95_session_duration_s") for row in metrics]
    output_tps = [metric_float(row, "output_tps") for row in metrics]

    plt.style.use("ggplot")
    fig, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)

    ax = axes[0][0]
    ax.plot(concurrency, request_throughput, color="#0f4c5c", marker="o", linewidth=2.5, label="Request throughput")
    ax2 = ax.twinx()
    ax2.plot(concurrency, p95_request, color="#ba181b", marker="s", linewidth=2.0, label="P95 request latency")
    ax.set_title("Throughput vs Request Latency")
    ax.set_xlabel("Session concurrency")
    ax.set_ylabel("Request throughput (req/s)")
    ax2.set_ylabel("P95 request latency (s)")
    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, loc="upper left")

    ax = axes[0][1]
    ax.plot(concurrency, p95_session, color="#4c956c", marker="o", linewidth=2.2, label="P95 session duration")
    ax2 = ax.twinx()
    ax2.plot(concurrency, output_tps, color="#f77f00", marker="D", linewidth=2.0, label="Output TPS")
    ax.set_title("Session Duration vs Output TPS")
    ax.set_xlabel("Session concurrency")
    ax.set_ylabel("P95 session duration (s)")
    ax2.set_ylabel("Output tokens/s")
    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, loc="upper left")

    ax = axes[1][0]
    gain = [0.0]
    for index in range(1, len(request_throughput)):
        prev = request_throughput[index - 1]
        curr = request_throughput[index]
        gain.append(((curr - prev) / prev) * 100.0 if prev else 0.0)
    colors = ["#2a9d8f" if value > 5.0 else "#e76f51" for value in gain[1:]]
    ax.bar([str(item) for item in concurrency[1:]], gain[1:], color=colors)
    ax.axhline(0, color="#222222", linewidth=1)
    ax.set_title("Incremental Throughput Gain")
    ax.set_xlabel("Session concurrency")
    ax.set_ylabel("Gain vs previous step (%)")

    ax = axes[1][1]
    interactive_limit = 20.0
    batch_limit = 45.0
    ax.plot(concurrency, p95_request, color="#ba181b", marker="o", linewidth=2.2, label="P95 request latency")
    ax.axhline(interactive_limit, color="#2a9d8f", linestyle="--", linewidth=1.4, label="Interactive SLO")
    ax.axhline(batch_limit, color="#f77f00", linestyle="--", linewidth=1.4, label="Batch SLO")
    ax.set_title("SLO Boundary Check")
    ax.set_xlabel("Session concurrency")
    ax.set_ylabel("Latency (s)")
    ax.legend(loc="upper left")

    fig.suptitle("SecureCode Session Capacity Overview", fontsize=16, fontweight="bold")
    fig.savefig(output_path, dpi=180, facecolor="white")
    plt.close(fig)


def render_latency_boxplot(latencies: dict[int, list[float]], output_path: Path) -> None:
    ordered_keys = sorted(latencies)
    ordered_values = [latencies[key] for key in ordered_keys]
    plt.style.use("ggplot")
    fig, ax = plt.subplots(figsize=(14, 7), constrained_layout=True)
    box = ax.boxplot(
        ordered_values,
        tick_labels=[str(key) for key in ordered_keys],
        patch_artist=True,
        showfliers=False,
        medianprops={"color": "#111111", "linewidth": 1.8},
    )
    palette = ["#2a9d8f", "#52b69a", "#76c893", "#d9ed92", "#fcbf49", "#f77f00", "#e76f51", "#d62828"]
    for patch, color in zip(box["boxes"], palette):
        patch.set_facecolor(color)
        patch.set_alpha(0.85)
    ax.set_title("Request Latency Distribution by Session Concurrency")
    ax.set_xlabel("Session concurrency")
    ax.set_ylabel("Request latency (s)")
    fig.savefig(output_path, dpi=180, facecolor="white")
    plt.close(fig)


def render_heatmap(buckets: list[dict[str, float | int]], output_path: Path) -> None:
    ordered_concurrency = sorted({int(row["concurrency"]) for row in buckets})
    max_bucket = max(int(row["bucket_index"]) for row in buckets)
    matrix = [[0.0 for _ in range(max_bucket + 1)] for _ in ordered_concurrency]
    for row in buckets:
        row_index = ordered_concurrency.index(int(row["concurrency"]))
        matrix[row_index][int(row["bucket_index"])] = float(row["completion_rps"])

    fig, ax = plt.subplots(figsize=(16, 6), constrained_layout=True)
    image = ax.imshow(matrix, aspect="auto", cmap="YlOrRd")
    ax.set_title("Completion Throughput Heatmap")
    ax.set_xlabel("Time bucket (5s)")
    ax.set_ylabel("Session concurrency")
    ax.set_yticks(range(len(ordered_concurrency)))
    ax.set_yticklabels([str(item) for item in ordered_concurrency])
    cbar = fig.colorbar(image, ax=ax)
    cbar.set_label("Completed req/s")
    fig.savefig(output_path, dpi=180, facecolor="white")
    plt.close(fig)


def render_resource_pressure(metrics: list[dict[str, float | int | str]], output_path: Path) -> None:
    concurrency = [int(row["concurrency"]) for row in metrics]
    active_sessions = [metric_float(row, "active_sessions_avg") for row in metrics]
    inflight = [metric_float(row, "inflight_requests_avg") for row in metrics]
    gpu_util = [metric_float(row, "gpu_util_avg") for row in metrics]
    power_avg = [metric_float(row, "power_draw_avg_w") for row in metrics]
    temp_max = [metric_float(row, "gpu_temp_max_c") for row in metrics]

    plt.style.use("ggplot")
    fig, axes = plt.subplots(1, 2, figsize=(16, 6), constrained_layout=True)

    ax = axes[0]
    ax.plot(concurrency, active_sessions, color="#4d908e", marker="o", linewidth=2.2, label="Active sessions avg")
    ax.plot(concurrency, inflight, color="#577590", marker="s", linewidth=2.0, label="Inflight requests avg")
    ax.set_title("Session Pressure")
    ax.set_xlabel("Session concurrency")
    ax.set_ylabel("Average concurrent count")
    ax.legend(loc="upper left")

    ax = axes[1]
    monitoring_available = any(not math.isnan(value) for value in gpu_util + power_avg + temp_max)
    if monitoring_available:
        ax.plot(concurrency, gpu_util, color="#2a9d8f", marker="o", linewidth=2.2, label="GPU util avg")
        ax.plot(concurrency, power_avg, color="#e76f51", marker="D", linewidth=2.0, label="Power avg W")
        ax.plot(concurrency, temp_max, color="#fcbf49", marker="^", linewidth=1.8, label="Temp max C")
        ax.set_title("GPU / Power / Temperature")
        ax.set_xlabel("Session concurrency")
        ax.set_ylabel("Resource level")
        ax.legend(loc="upper left")
    else:
        ax.set_title("GPU / Power / Temperature")
        ax.set_axis_off()
        ax.text(
            0.5,
            0.5,
            "No remote monitoring data.\nRe-run with --remote-host to add GPU/system telemetry.",
            ha="center",
            va="center",
            fontsize=11,
        )

    fig.savefig(output_path, dpi=180, facecolor="white")
    plt.close(fig)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).resolve()
    charts_dir = run_dir / "charts"
    ensure_dir(charts_dir)

    phase_metrics = read_phase_metrics(run_dir / "phase_metrics.csv")
    phase_buckets = read_phase_buckets(run_dir / "phase_buckets.csv")
    latencies = read_request_latencies(run_dir / "request_results.jsonl")

    render_overview(phase_metrics, charts_dir / "session_capacity_overview.png")
    render_latency_boxplot(latencies, charts_dir / "session_latency_boxplot.png")
    render_heatmap(phase_buckets, charts_dir / "session_throughput_heatmap.png")
    render_resource_pressure(phase_metrics, charts_dir / "session_resource_pressure.png")

    manifest = {
        "generated_files": [
            "charts/session_capacity_overview.png",
            "charts/session_latency_boxplot.png",
            "charts/session_throughput_heatmap.png",
            "charts/session_resource_pressure.png",
        ]
    }
    (charts_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
