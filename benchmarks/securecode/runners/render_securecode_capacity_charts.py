#!/usr/bin/env python3
"""Render charts for a SecureCode capacity benchmark run."""

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


def metric_int(row: dict[str, float | int | str], key: str) -> int | None:
    value = row.get(key, "")
    if value == "" or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(float(value))
    except ValueError:
        return None


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
                if key in {"error_status_counts", "phase_started_at", "phase_ended_at"}:
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
                    "request_count": int(row["request_count"]),
                    "throughput_rps": float(row["throughput_rps"]),
                    "output_tps": float(row["output_tps"]),
                }
            )
    return rows


def read_raw_results(path: Path) -> dict[int, list[float]]:
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
    throughput = [metric_float(row, "throughput_rps") for row in metrics]
    p95 = [metric_float(row, "p95_latency_s") for row in metrics]
    p99 = [metric_float(row, "p99_latency_s") for row in metrics]
    gpu_util = [metric_float(row, "gpu_util_avg") for row in metrics]
    gpu_util_p95 = [metric_float(row, "gpu_util_p95") for row in metrics]
    power_avg = [metric_float(row, "power_draw_avg_w") for row in metrics]
    temp_max = [metric_float(row, "gpu_temp_max_c") for row in metrics]
    spike_rate = [metric_float(row, "latency_spike_over_2x_median_rate") * 100.0 for row in metrics]
    over_15_rate = [metric_float(row, "latency_over_15s_rate") * 100.0 for row in metrics]
    throughput_gain = [None]
    for index in range(1, len(throughput)):
        prev = throughput[index - 1]
        curr = throughput[index]
        throughput_gain.append(((curr - prev) / prev) * 100.0 if prev else 0.0)

    plt.style.use("ggplot")
    fig, axes = plt.subplots(2, 2, figsize=(16, 10), constrained_layout=True)

    ax = axes[0][0]
    ax.plot(concurrency, throughput, color="#005f73", marker="o", linewidth=2.5, label="Throughput req/s")
    ax2 = ax.twinx()
    ax2.plot(concurrency, p95, color="#bb3e03", marker="s", linewidth=2.0, label="P95 latency")
    ax2.plot(concurrency, p99, color="#ae2012", marker="^", linewidth=1.8, linestyle="--", label="P99 latency")
    ax.set_title("Throughput vs Latency")
    ax.set_xlabel("Concurrency")
    ax.set_ylabel("Throughput (req/s)")
    ax2.set_ylabel("Latency (s)")
    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, loc="upper left")

    ax = axes[0][1]
    monitoring_available = any(not math.isnan(value) for value in gpu_util + gpu_util_p95 + power_avg + temp_max)
    if monitoring_available:
        ax.plot(concurrency, gpu_util, color="#0a9396", marker="o", linewidth=2.2, label="GPU avg %")
        ax.plot(concurrency, gpu_util_p95, color="#94d2bd", marker="s", linewidth=2.0, label="GPU p95 %")
        ax.plot(concurrency, temp_max, color="#ca6702", marker="^", linewidth=1.8, label="Temp max C")
        ax2 = ax.twinx()
        ax2.plot(concurrency, power_avg, color="#9b2226", marker="D", linewidth=2.0, label="Power avg W")
        ax.set_title("Resource Saturation")
        ax.set_xlabel("Concurrency")
        ax.set_ylabel("GPU / Temp")
        ax2.set_ylabel("Power (W)")
        lines1, labels1 = ax.get_legend_handles_labels()
        lines2, labels2 = ax2.get_legend_handles_labels()
        ax.legend(lines1 + lines2, labels1 + labels2, loc="upper left")
    else:
        ax.set_title("Resource Saturation")
        ax.set_axis_off()
        ax.text(
            0.5,
            0.5,
            "No remote monitoring data.\nRe-run with --remote-host to add GPU/system telemetry.",
            ha="center",
            va="center",
            fontsize=11,
        )

    ax = axes[1][0]
    pos = list(range(len(concurrency)))
    width = 0.36
    ax.bar(
        [item - (width / 2) for item in pos],
        over_15_rate,
        width=width,
        color="#ee9b00",
        label=">15s request rate",
    )
    ax.plot(
        [item + (width / 2) for item in pos],
        spike_rate,
        color="#005f73",
        marker="o",
        linewidth=2.0,
        label=">2x median spike rate",
    )
    ax.set_title("Latency Spike Rate")
    ax.set_xlabel("Concurrency")
    ax.set_ylabel("Request rate (%)")
    ax.set_xticks(pos)
    ax.set_xticklabels([str(item) for item in concurrency])
    visible = [value for value in spike_rate + over_15_rate if not math.isnan(value)]
    ymax = max(visible) if visible else 0.0
    if ymax <= 0:
        ax.set_ylim(0, 1.0)
        ax.axhline(0, color="#666666", linewidth=1.0, linestyle="--")
        ax.text(
            0.5,
            0.92,
            "All spike indicators were 0% in this run.",
            ha="center",
            va="top",
            transform=ax.transAxes,
            fontsize=10,
        )
    else:
        ax.set_ylim(0, max(5.0, ymax * 1.25))
    for index, value in enumerate(over_15_rate):
        if math.isnan(value):
            continue
        ax.text(index - (width / 2), value + max(0.12, ax.get_ylim()[1] * 0.02), f"{value:.0f}", ha="center", va="bottom", fontsize=8)
    for index, value in enumerate(spike_rate):
        if math.isnan(value):
            continue
        ax.text(index + (width / 2), value + max(0.12, ax.get_ylim()[1] * 0.02), f"{value:.0f}", ha="center", va="bottom", fontsize=8)
    ax.legend(loc="upper left")

    ax = axes[1][1]
    gain_x = concurrency[1:]
    gain_y = [float(item) for item in throughput_gain[1:]]
    colors = ["#0a9396" if value > 5 else "#bb3e03" for value in gain_y]
    ax.bar([str(item) for item in gain_x], gain_y, color=colors)
    ax.axhline(0, color="#333333", linewidth=1)
    ax.set_title("Incremental Throughput Gain")
    ax.set_xlabel("Concurrency step")
    ax.set_ylabel("Gain vs previous step (%)")

    fig.suptitle("SecureCode Capacity Overview", fontsize=16, fontweight="bold")
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
        whiskerprops={"color": "#444444"},
        capprops={"color": "#444444"},
    )
    palette = ["#0a9396", "#94d2bd", "#e9d8a6", "#ee9b00", "#ca6702", "#bb3e03", "#ae2012", "#9b2226"]
    for patch, color in zip(box["boxes"], palette):
        patch.set_facecolor(color)
        patch.set_alpha(0.85)

    ax.set_title("Latency Distribution by Concurrency")
    ax.set_xlabel("Concurrency")
    ax.set_ylabel("Latency (s)")
    fig.savefig(output_path, dpi=180, facecolor="white")
    plt.close(fig)


def render_bucket_heatmap(buckets: list[dict[str, float | int]], output_path: Path) -> None:
    ordered_concurrency = sorted({int(row["concurrency"]) for row in buckets})
    max_bucket = max(int(row["bucket_index"]) for row in buckets)
    matrix = [[0.0 for _ in range(max_bucket + 1)] for _ in ordered_concurrency]

    for row in buckets:
        concurrency = int(row["concurrency"])
        row_index = ordered_concurrency.index(concurrency)
        matrix[row_index][int(row["bucket_index"])] = float(row["throughput_rps"])

    plt.style.use("default")
    fig, ax = plt.subplots(figsize=(16, 6), constrained_layout=True)
    image = ax.imshow(matrix, aspect="auto", cmap="YlOrRd")
    ax.set_title("Completion Throughput Heatmap")
    ax.set_xlabel("Time bucket (5s)")
    ax.set_ylabel("Concurrency")
    ax.set_yticks(range(len(ordered_concurrency)))
    ax.set_yticklabels([str(item) for item in ordered_concurrency])
    cbar = fig.colorbar(image, ax=ax)
    cbar.set_label("Completed req/s")
    fig.savefig(output_path, dpi=180, facecolor="white")
    plt.close(fig)


def render_resource_spikes(metrics: list[dict[str, float | int | str]], output_path: Path) -> None:
    concurrency = [int(row["concurrency"]) for row in metrics]
    gpu_spikes = [metric_int(row, "gpu_util_spike_seconds_gte_90") for row in metrics]
    power_spikes = [metric_int(row, "power_spike_seconds_gte_350") for row in metrics]
    temp_spikes = [metric_int(row, "gpu_temp_seconds_gte_70") for row in metrics]

    plt.style.use("ggplot")
    fig, ax = plt.subplots(figsize=(14, 7), constrained_layout=True)
    if any(value is not None for value in gpu_spikes + power_spikes + temp_spikes):
        width = 0.24
        positions = list(range(len(concurrency)))
        ax.bar(
            [item - width for item in positions],
            [value or 0 for value in gpu_spikes],
            width=width,
            color="#0a9396",
            label="GPU >=90% sec",
        )
        ax.bar(
            positions,
            [value or 0 for value in power_spikes],
            width=width,
            color="#bb3e03",
            label="Power >=350W sec",
        )
        ax.bar(
            [item + width for item in positions],
            [value or 0 for value in temp_spikes],
            width=width,
            color="#ca6702",
            label="Temp >=70C sec",
        )
        ax.set_xticks(positions)
        ax.set_xticklabels([str(item) for item in concurrency])
        ax.set_title("Resource Spike Seconds by Concurrency")
        ax.set_xlabel("Concurrency")
        ax.set_ylabel("Seconds in spike band")
        ax.legend()
    else:
        ax.set_title("Resource Spike Seconds by Concurrency")
        ax.set_axis_off()
        ax.text(
            0.5,
            0.5,
            "No remote monitoring data.\nRe-run with --remote-host to add resource spike charts.",
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
    raw_latencies = read_raw_results(run_dir / "raw_results.jsonl")

    render_overview(phase_metrics, charts_dir / "capacity_overview.png")
    render_latency_boxplot(raw_latencies, charts_dir / "latency_boxplot.png")
    render_bucket_heatmap(phase_buckets, charts_dir / "throughput_heatmap.png")
    render_resource_spikes(phase_metrics, charts_dir / "resource_spikes.png")

    manifest = {
        "generated_files": [
            "charts/capacity_overview.png",
            "charts/latency_boxplot.png",
            "charts/throughput_heatmap.png",
            "charts/resource_spikes.png",
        ]
    }
    (charts_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
