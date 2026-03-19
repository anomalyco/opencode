#!/usr/bin/env python3
"""Publish securecode capacity results into a Notion page."""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


NOTION_VERSION = "2026-03-11"


def notion_request(
    *,
    token: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"https://api.notion.com{path}"
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
    }
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, method=method, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def rich_text(text: str, *, link: str | None = None, bold: bool = False, code: bool = False) -> list[dict[str, Any]]:
    annotations = {
        "bold": bold,
        "italic": False,
        "strikethrough": False,
        "underline": False,
        "code": code,
        "color": "default",
    }
    return [
        {
            "type": "text",
            "text": {"content": text, "link": {"url": link} if link else None},
            "annotations": annotations,
        }
    ]


def paragraph(text: str) -> dict[str, Any]:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": rich_text(text), "color": "default"}}


def heading_2(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "heading_2",
        "heading_2": {"rich_text": rich_text(text), "is_toggleable": False, "color": "default"},
    }


def callout(text: str, emoji: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "callout",
        "callout": {"rich_text": rich_text(text), "icon": {"type": "emoji", "emoji": emoji}, "color": "default"},
    }


def bulleted(text: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {"rich_text": rich_text(text), "color": "default"},
    }


def image_block(file_upload_id: str, caption: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "image",
        "image": {
            "type": "file_upload",
            "file_upload": {"id": file_upload_id},
            "caption": rich_text(caption),
        },
    }


def file_block(file_upload_id: str, caption: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "file",
        "file": {
            "type": "file_upload",
            "file_upload": {"id": file_upload_id},
            "caption": rich_text(caption),
        },
    }


def append_blocks(token: str, block_id: str, blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for index in range(0, len(blocks), 100):
        chunk = blocks[index : index + 100]
        response = notion_request(
            token=token,
            method="PATCH",
            path=f"/v1/blocks/{block_id}/children",
            payload={"children": chunk},
        )
        results.extend(response.get("results", []))
    return results


def trash_block(token: str, block_id: str) -> None:
    notion_request(
        token=token,
        method="PATCH",
        path=f"/v1/blocks/{block_id}",
        payload={"in_trash": True},
    )


def list_children(token: str, block_id: str, *, page_size: int = 100) -> list[dict[str, Any]]:
    response = notion_request(
        token=token,
        method="GET",
        path=f"/v1/blocks/{block_id}/children?page_size={page_size}",
    )
    return response.get("results", [])


def update_page_markdown(token: str, page_id: str, markdown: str) -> dict[str, Any]:
    return notion_request(
        token=token,
        method="PATCH",
        path=f"/v1/pages/{page_id}/markdown",
        payload={
            "type": "insert_content",
            "insert_content": {
                "content": markdown,
            },
        },
    )


def upload_file(token: str, path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    content_type = mime_type or "application/octet-stream"
    file_upload = notion_request(
        token=token,
        method="POST",
        path="/v1/file_uploads",
        payload={
            "mode": "single_part",
            "filename": path.name,
            "content_type": content_type,
        },
    )
    file_upload_id = file_upload["id"]

    subprocess.run(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            f"https://api.notion.com/v1/file_uploads/{file_upload_id}/send",
            "-H",
            f"Authorization: Bearer {token}",
            "-H",
            f"Notion-Version: {NOTION_VERSION}",
            "-F",
            f"file=@{path};type={content_type}",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    deadline = time.time() + 60
    while time.time() < deadline:
        current = notion_request(token=token, method="GET", path=f"/v1/file_uploads/{file_upload_id}")
        if current.get("status") == "uploaded":
            return file_upload_id
        time.sleep(1)
    raise RuntimeError(f"timed out waiting for file upload: {path}")


def parse_phase_metrics(path: Path) -> list[dict[str, str]]:
    with path.open() as handle:
        rows = list(csv.DictReader(handle))
    rows.sort(key=lambda item: int(item["concurrency"]))
    return rows


def parse_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def load_summary(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def pick_tier(rows: list[dict[str, str]], p95_limit: float) -> dict[str, str] | None:
    selected = None
    for row in rows:
        success_rate = parse_float(row.get("success_rate"))
        p95_latency = parse_float(row.get("p95_latency_s"))
        if success_rate is None or p95_latency is None:
            continue
        if success_rate >= 0.99 and p95_latency <= p95_limit:
            selected = row
    return selected


def pick_peak(rows: list[dict[str, str]]) -> dict[str, str] | None:
    if not rows:
        return None
    return max(rows, key=lambda row: parse_float(row.get("throughput_rps")) or 0.0)


def describe_ceiling(ceiling: dict[str, Any], interactive: dict[str, str] | None, batch: dict[str, str] | None) -> str:
    status = ceiling.get("status")
    if status == "observed-saturation":
        return (
            f"観測上の飽和開始は並列 {ceiling['ceiling_concurrency']} 前後。"
            f" 次の {ceiling['failure_concurrency']} で throughput が伸びにくくなり、待ち時間が悪化しました。"
        )
    if status == "error-onset":
        return (
            f"観測上の上限は並列 {ceiling['ceiling_concurrency']} 前後。"
            f" {ceiling['failure_concurrency']} でエラーが出始めています。"
        )
    if status == "not-reached":
        floor = interactive or batch
        if floor is None:
            return "今回の試験範囲では明確な飽和点を観測できませんでした。"
        return (
            f"今回の試験範囲では明確な飽和点を観測できず、"
            f" 少なくとも並列 {floor['concurrency']} までは条件内で動作しました。"
        )
    return "試験点が少ないため、明確な飽和点はまだ判定できていません。"


def build_upload_targets(run_dir: Path) -> list[tuple[str, Path]]:
    analysis = find_analysis_file(run_dir)
    targets = [
        ("日本語分析メモ", analysis),
        ("位相別CSV", run_dir / "phase_metrics.csv"),
        ("時系列バケットCSV", run_dir / "phase_buckets.csv"),
        ("capacity_overview.png", run_dir / "charts" / "capacity_overview.png"),
        ("latency_boxplot.png", run_dir / "charts" / "latency_boxplot.png"),
        ("throughput_heatmap.png", run_dir / "charts" / "throughput_heatmap.png"),
        ("resource_spikes.png", run_dir / "charts" / "resource_spikes.png"),
    ]
    return [(label, path) for label, path in targets if path.exists()]


def find_analysis_file(run_dir: Path) -> Path:
    matches = sorted(run_dir.glob("securecode-capacity-ceiling-analysis-*.ja.md"))
    if matches:
        return matches[-1]
    return run_dir / "securecode-capacity-ceiling-analysis.ja.md"


def fmt_num(value: str | None, digits: int = 2) -> str:
    num = parse_float(value)
    if num is None:
        return "n/a"
    return f"{num:.{digits}f}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page-id", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--notion-token", default=os.environ.get("NOTION_TOKEN", ""))
    args = parser.parse_args()

    token = args.notion_token
    if not token:
        raise SystemExit("NOTION_TOKEN is required")

    run_dir = Path(args.run_dir).resolve()
    page_id = args.page_id
    phase_rows = parse_phase_metrics(run_dir / "phase_metrics.csv")
    summary = load_summary(run_dir / "summary.json")
    ceiling = summary.get("ceiling", {})
    interactive = pick_tier(phase_rows, 45.0)
    batch = pick_tier(phase_rows, 120.0)
    peak = pick_peak(phase_rows)
    served_model = summary.get("model", "unspecified")
    backing_model = summary.get("backing_model", "unspecified")
    base_url = summary.get("base_url", "unspecified")
    analysis = find_analysis_file(run_dir)

    children = list_children(token, page_id)
    for block in children[2:]:
        trash_block(token, block["id"])

    performance_rows = [
        ["並列", "req/s", "P95(s)", "P99(s)", "最大(s)", ">15s率(%)"],
    ]
    resource_rows = [
        ["並列", "GPU avg(%)", "GPU p95(%)", "GPU max(%)", "Power avg(W)", "Power max(W)", "Temp max(C)"],
    ]
    for row in phase_rows:
        performance_rows.append(
            [
                row["concurrency"],
                fmt_num(row["throughput_rps"], 3),
                fmt_num(row["p95_latency_s"], 2),
                fmt_num(row["p99_latency_s"], 2),
                fmt_num(row["latency_max_s"], 2),
                fmt_num(str(float(row["latency_over_15s_rate"]) * 100.0), 1),
            ]
        )
        resource_rows.append(
            [
                row["concurrency"],
                fmt_num(row["gpu_util_avg"], 2),
                fmt_num(row["gpu_util_p95"], 2),
                fmt_num(row["gpu_util_max"], 2),
                fmt_num(row["power_draw_avg_w"], 2),
                fmt_num(row["power_draw_max_w"], 2),
                fmt_num(row["gpu_temp_max_c"], 0),
            ]
        )

    uploaded: dict[str, str] = {}
    for label, path in build_upload_targets(run_dir):
        uploaded[label] = upload_file(token, path)

    performance_table = ["<table>"]
    for row in performance_rows:
        performance_table.append("  <tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>")
    performance_table.append("</table>")

    resource_table = ["<table>"]
    for row in resource_rows:
        resource_table.append("  <tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>")
    resource_table.append("</table>")

    observation_lines = []
    if peak is not None:
        observation_lines.append(
            f"- 最大 throughput は並列 {peak['concurrency']} で {fmt_num(peak['throughput_rps'], 3)} req/s。"
        )
    if interactive is not None:
        observation_lines.append(
            f"- interactive の目安は並列 {interactive['concurrency']} まで。"
            f" P95 latency は {fmt_num(interactive['p95_latency_s'], 2)} 秒。"
        )
    else:
        observation_lines.append("- interactive の目安は今回の測定では確定できませんでした。")
    if batch is not None:
        observation_lines.append(
            f"- batch の目安は並列 {batch['concurrency']} まで。"
            f" P95 latency は {fmt_num(batch['p95_latency_s'], 2)} 秒。"
        )
    else:
        observation_lines.append("- batch の目安は今回の測定では確定できませんでした。")
    observation_lines.append(f"- {describe_ceiling(ceiling, interactive, batch)}")

    if analysis.exists():
        markdown = analysis.read_text()
    else:
        markdown = "\n".join(
            [
                "## 1. エグゼクティブサマリ",
                "",
                f"<callout>要点: {describe_ceiling(ceiling, interactive, batch)}</callout>",
                "",
                f"Served model alias は `{served_model}`、backing checkpoint は `{backing_model}`、endpoint は `{base_url}`。"
                " SecCodeBench の SecureCode workload を用いて、API 容量、レイテンシ、GPU 使用率、電力、温度の変化を計測しました。",
                "",
                *observation_lines,
                "",
                "## 2. 主要メトリクス表",
                "",
                *performance_table,
                "",
                "## 3. マシン資源表",
                "",
                *resource_table,
                "",
                "## 4. アーティファクト一覧",
                "",
                *[f"- {label}" for label in uploaded.keys()],
            ]
        )

    update_page_markdown(token, page_id, markdown)

    image_specs = {
        "capacity_overview.png": "容量の全体像: throughput, p95/p99 latency, 資源飽和, スパイク率。",
        "latency_boxplot.png": "並列数ごとのレイテンシ分布。",
        "throughput_heatmap.png": "5 秒バケットごとの完了 req/s。",
        "resource_spikes.png": "GPU 90% 超、350W 超、70C 超の秒数。",
    }
    file_labels = {
        "日本語分析メモ": "日本語分析メモ（Markdown 原文）",
        "位相別CSV": "位相別メトリクス CSV",
        "時系列バケットCSV": "時系列バケット CSV",
    }
    blocks: list[dict[str, Any]] = []
    image_blocks_to_add = [
        image_block(uploaded[name], caption)
        for name, caption in image_specs.items()
        if name in uploaded
    ]
    if image_blocks_to_add:
        blocks.append(heading_2("5. グラフ"))
        blocks.extend(image_blocks_to_add)
    file_blocks_to_add = [
        file_block(uploaded[name], caption)
        for name, caption in file_labels.items()
        if name in uploaded
    ]
    if file_blocks_to_add:
        blocks.append(heading_2("6. 添付ファイル"))
        blocks.extend(file_blocks_to_add)

    if blocks:
        append_blocks(token, page_id, blocks)

    print(
        json.dumps(
            {
                "page_id": page_id,
                "page_url": notion_request(token=token, method="GET", path=f"/v1/pages/{page_id}")["url"],
                "uploaded_files": uploaded,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
