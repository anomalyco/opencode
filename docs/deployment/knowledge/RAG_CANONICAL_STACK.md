# RAG Canonical Stack (DECISION_127)

## Canonical Choice

Use the MCP-hosted RAG runtime in `src/RAG` + `src/RAG.McpHost` as the single canonical implementation for agent workflows.

## Why This Stack

- Exposes the complete agent-facing toolset (`rag_query`, `rag_ingest`, `rag_ingest_file`, `rag_status`, `rag_rebuild_index`, `rag_search_similar`).
- Already wired to ToolHive gateway registration and startup flows.
- Includes ingestion pipeline, health monitoring, rebuild scheduling, and metadata-filtered query controls.
- Aligns with existing strategist and deployment decision history.

## Canonical Integration Path

1. Host binary: `C:/ProgramData/P4NTHE0N/bin/RAG.McpHost.exe`
2. ToolHive registration: `tools/mcp-development/servers/toolhive-gateway/config/rag-server.json`
3. Endpoint: `http://127.0.0.1:5001/mcp`
4. Python embedding bridge: `http://127.0.0.1:5000`

## Non-Canonical but Retained

- `C0MMON/RAG/*` remains a reference/library path and historical implementation surface.
- Agent prompts and workflow docs should treat `rag-server` via ToolHive as authoritative for operational usage.

## Operator Checks

- Health: call `rag_status`.
- Query path: call `rag_query` with optional filter whitelist keys (`agent`, `type`, `source`, `platform`, `category`, `status`).
- Ingestion path: prefer `rag_ingest_file` for file-backed corpus ingestion.
