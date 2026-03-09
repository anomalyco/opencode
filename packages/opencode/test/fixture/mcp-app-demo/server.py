#!/usr/bin/env python3
"""
MCP App Demo Server

A minimal MCP server that demonstrates the MCP Apps integration in opencode.
It registers a `demo_dashboard` tool with `_meta.ui.resourceUri` pointing to
the bundled app.html, and returns `structuredContent` with dashboard data.

Run via opencode config:
  mcp:
    demo:
      type: local
      command: [python3, packages/opencode/test/fixture/mcp-app-demo/server.py]
"""

import asyncio
import json
import re
import sys
from pathlib import Path

from mcp import types  # type: ignore[import]
from mcp.server import Server
from mcp.server.stdio import stdio_server

RESOURCE_URI = "ui://mcp-app-demo/dashboard-v3"
# Aliases accepted for backward compat with cached tool parts from older sessions
RESOURCE_URI_ALIASES = {
    "ui://mcp-app-demo/dashboard",
    "ui://mcp-app-demo/dashboard-v2",
    "ui://mcp-app-demo/dashboard-v3",
}
HTML_PATH = Path(__file__).parent / "app.html"
# server.py -> mcp-app-demo -> fixture -> test -> opencode -> packages -> repo root
BUNDLE_PATH = (
    Path(__file__).parent.parent.parent.parent.parent.parent
    / "packages/ui/node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js"
)

server = Server("mcp-app-demo")


@server.list_resources()
async def list_resources() -> list[types.Resource]:
    return [
        types.Resource(
            uri=RESOURCE_URI,
            name="Demo Dashboard",
            mimeType="text/html;profile=mcp-app",
        )
    ]


@server.read_resource()
async def read_resource(uri) -> types.TextResourceContents:  # type: ignore[override]
    if str(uri) not in RESOURCE_URI_ALIASES:
        raise ValueError(f"Unknown resource: {uri}")
    html = HTML_PATH.read_text()
    bundle = BUNDLE_PATH.read_text() if BUNDLE_PATH.exists() else ""
    if bundle:
        # Strip the trailing ESM export{...} block so the bundle can run as a
        # classic (non-module) script inside a sandboxed iframe.
        clean = re.sub(r"export\{[^}]+\};?\s*$", "", bundle)
        # Wrap in an IIFE and expose the two classes as globals.
        # _c = App class, O$ = PostMessageTransport class (minified names in bundle).
        wrapped = f"(function(){{\n{clean}\nwindow.App=_c;\nwindow.PostMessageTransport=O$;\n}})();"
        inline = f"<script>\n{wrapped}\n</script>"
        # Inject bundle before the first <script> tag (app.html uses window.App global).
        html = html.replace("<script>", f"{inline}\n<script>", 1)

    class _RC:
        def __init__(self, text: str, mime: str):
            self.content = text
            self.mime_type = mime

    return [_RC(html, "text/html;profile=mcp-app")]  # type: ignore[return-value]


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool.model_validate(
            {
                "name": "demo_dashboard",
                "description": (
                    "Show an interactive dashboard. "
                    "Returns metrics and charts as structured content rendered in the opencode UI."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Dashboard title",
                            "default": "Demo Dashboard",
                        },
                        "theme": {
                            "type": "string",
                            "enum": ["dark", "light"],
                            "default": "dark",
                        },
                    },
                },
                "_meta": {
                    "ui": {
                        "resourceUri": RESOURCE_URI,
                        "maxHeight": 640,
                    }
                },
            }
        ),
        types.Tool.model_validate(
            {
                "name": "_demo_action",
                "description": "Handle button clicks from the demo dashboard app.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "action_id": {"type": "string"},
                    },
                    "required": ["action_id"],
                },
                "_meta": {
                    "ui": {
                        "resourceUri": RESOURCE_URI,
                        "visibility": ["app"],
                    }
                },
            }
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):  # type: ignore[override]
    if name == "demo_dashboard":
        import datetime, math, random

        random.seed(42)
        title = arguments.get("title", "Production Overview")
        now = datetime.datetime.utcnow()
        ts = now.strftime("%H:%M:%S UTC")

        # Sparklines: 20 data points
        def _wave(base, amp, n=20):
            return [
                round(
                    base
                    + amp * math.sin(i * 0.6)
                    + random.uniform(-amp * 0.2, amp * 0.2),
                    1,
                )
                for i in range(n)
            ]

        req_spark = _wave(14200, 800)
        lat_spark = _wave(42, 6)
        err_spark = _wave(0.4, 0.08)
        uptime_spark = [100.0] * 18 + [99.97, 100.0]

        # Chart: 24 time buckets over the last 24 h
        hours = [f"{(now.hour - 23 + i) % 24:02d}:00" for i in range(24)]
        rps = [
            round(8000 + 6000 * abs(math.sin(i * 0.4)) + random.uniform(-400, 400))
            for i in range(24)
        ]
        errors = [
            round(max(0, 30 * abs(math.sin(i * 0.7)) + random.uniform(-5, 10)))
            for i in range(24)
        ]

        structured = {
            "title": title,
            "timestamp": ts,
            "metrics": [
                {
                    "label": "Requests",
                    "value": "14.2k",
                    "unit": "/s",
                    "change": 8.3,
                    "sparkline": req_spark,
                },
                {
                    "label": "P99 Latency",
                    "value": "42",
                    "unit": "ms",
                    "change": -2.1,
                    "sparkline": lat_spark,
                },
                {
                    "label": "Error Rate",
                    "value": "0.4",
                    "unit": "%",
                    "change": -0.2,
                    "sparkline": err_spark,
                },
                {
                    "label": "Uptime",
                    "value": "99.97",
                    "unit": "%",
                    "change": 0,
                    "sparkline": uptime_spark,
                },
            ],
            "chart": {
                "label": "Throughput (last 24 h)",
                "period": "1-hour buckets",
                "series": [
                    {"name": "RPS", "values": rps, "color": "#7c3aed"},
                    {"name": "Errors", "values": errors, "color": "#ef4444"},
                ],
            },
            "barsLabel": "Traffic by region",
            "bars": [
                {"name": "us-east-1", "value": 5840, "unit": "k"},
                {"name": "eu-west-1", "value": 3210, "unit": "k"},
                {"name": "ap-south-1", "value": 2190, "unit": "k"},
                {"name": "us-west-2", "value": 1750, "unit": "k"},
                {"name": "sa-east-1", "value": 620, "unit": "k"},
            ],
            "events": [
                {
                    "time": "14:23:01",
                    "level": "info",
                    "msg": "Deploy v2.4.1 completed successfully",
                },
                {
                    "time": "14:19:44",
                    "level": "warn",
                    "msg": "Memory usage at 82% on pod app-7d9f4",
                },
                {
                    "time": "14:15:30",
                    "level": "info",
                    "msg": "Autoscale: 3 → 5 replicas (us-east-1)",
                },
                {
                    "time": "14:08:12",
                    "level": "error",
                    "msg": "DB connection timeout — retried ok",
                },
                {
                    "time": "14:01:55",
                    "level": "info",
                    "msg": "Certificate renewed for api.example.com",
                },
                {
                    "time": "13:58:03",
                    "level": "info",
                    "msg": "Cache warm-up complete (hit rate 94%)",
                },
            ],
            "actions": [
                {"id": "refresh", "label": "↻ Refresh"},
                {"id": "export", "label": "Export CSV"},
                {"id": "rollback", "label": "Rollback"},
                {"id": "alert", "label": "Set Alert", "primary": True},
            ],
        }

        return (
            [types.TextContent(type="text", text=f"Dashboard '{title}' rendered.")],
            structured,
        )

    if name == "_demo_action":
        action_id = arguments.get("action_id", "unknown")
        return [types.TextContent(type="text", text=f"Action '{action_id}' received.")]

    raise ValueError(f"Unknown tool: {name}")


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, write_stream, server.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
