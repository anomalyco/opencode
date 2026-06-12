<p align="center">
  <img src="assets/readme/opencode-trade-banner.svg" alt="OPENCODE-TRADE banner">
</p>
<p align="center">Trading-focused OpenCode fork for MT5 execution, memory handoff, and safety-gated strategy iteration.</p>
<p align="center">
  <img alt="Community" src="https://img.shields.io/badge/community-manual%20review-5865F2?style=flat-square&logo=discord&logoColor=white" />
  <img alt="Distribution" src="https://img.shields.io/badge/distribution-source%20fork-CB3837?style=flat-square&logo=npm&logoColor=white" />
  <a href="https://github.com/TakeshiSawaguchi/opencode-trade/actions/workflows/test.yml?query=branch%3Adev"><img alt="Test" src="https://img.shields.io/github/actions/workflow/status/TakeshiSawaguchi/opencode-trade/test.yml?branch=dev&style=flat-square&label=test" /></a>
  <a href="https://github.com/TakeshiSawaguchi/opencode-trade/actions/workflows/typecheck.yml?query=branch%3Adev"><img alt="Typecheck" src="https://img.shields.io/github/actions/workflow/status/TakeshiSawaguchi/opencode-trade/typecheck.yml?branch=dev&style=flat-square&label=typecheck" /></a>
  <a href="https://github.com/TakeshiSawaguchi/opencode-trade/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/TakeshiSawaguchi/opencode-trade?style=flat-square" /></a>
  <img alt="MT5" src="https://img.shields.io/badge/MT5-XAUUSD%20%2F%20SP500-0f0f0f?style=flat-square" />
</p>

# opencode-trade

`opencode-trade` is a trading-focused derivative project built on top of the OpenCode codebase. It combines the OpenCode runtime and workspace with MQL5 execution code, research documents, backtest planning, and operating rules for iterative strategy development.

This repository is not the upstream product README for OpenCode. It documents the purpose and workflow of this project-specific fork.

## What this repository is

This repository combines two layers:

- the upstream OpenCode monorepo under `packages/`, `sdks/`, `github/`, and related application infrastructure
- project-specific trading assets under `src/`, `backtest/`, and the root strategy and operations documents

The project goal is to run a modular EA stack with strict risk controls, repeatable backtests, and a research-to-implementation workflow that keeps human approval in the loop.

## Project goals

- run a stable MQL5 trading system with explicit drawdown limits
- keep strategy logic modular so individual signals can be added, tested, disabled, or replaced
- separate research, implementation, review, and backtest responsibilities
- prepare ONNX-based model candidates without letting unverified models bypass validation gates

## System overview

The current trading design centers on:

- `src/Expert_Main.mq5`
  - main EA entrypoint
- `src/Include/TradeLogic.mqh`
  - breakout, pullback, and ML signal classes
- `src/Include/RiskManagement.mqh`
  - position sizing, drawdown checks, and order execution wrapper
- `src/Include/DataFeed.mqh`
  - market data export and local data bridge utilities
- `src/Scripts/data_collector.py`
  - Dukascopy collector stub; `.bi5` decode and OHLC export are not implemented yet
- `backtest/test_scenarios.json`
  - scenario definitions used by the backtest flow

The design documents currently describe:

- XAUUSD breakout as the most concrete validation path
- SP500 pullback as a separate strategy track
- ONNX as a candidate filter or future model input path, not something to enable without validation

## Repository structure

- `src/`
  - MQL5 EA source and Python data tooling
- `backtest/`
  - backtest scenario inputs and future result artifacts
- `AGENTS.md`
  - agent roles, task handoff model, and project-wide operating rules
- `SOUL.md`
  - project philosophy, hard constraints, and architectural decisions
- `ARCHITECTURE.md`
  - MQL5 architecture and three-node data flow
- `DEVELOPMENT.md`
  - environment setup and example execution workflow
- `AUDIT_AND_STRATEGY.md`
  - audit notes and strategic decisions
- `FINAL_IMPLEMENTATION_PLAN.md`
  - phased implementation and validation plan
- `packages/`
  - upstream OpenCode application and library packages retained in this fork

## Operating model

The current docs assume a three-node workflow:

- `wag-air`
  - orchestration, review coordination, and document updates
- `wag-x870e`
  - historical data collection and Python-side processing
- `wag-dell`
  - MT5 execution environment and backtest runs

This separation matters because the repo does not assume that research, implementation, and MT5 execution all happen on the same machine.

## Workflow overview

The normal loop is:

1. define or refine a trading hypothesis
2. research comparable implementations and failure modes
3. implement or adjust MQL5 logic in `src/`
4. review risk logic and execution behavior
5. run backtests and compare results against documented gates
6. either promote, revise, or reject the change

The project intentionally avoids a fully autonomous loop where AI research or generated code can self-promote into live deployment without human review.

## Setup and execution entry points

For the OpenCode workspace itself:

```bash
bun install
bun run dev
```

For project-specific setup, start with:

- [DEVELOPMENT.md](./DEVELOPMENT.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

Important practical details already documented there include:

- local clone and workspace layout
- trading data directory creation on the Ubuntu node
- MT5 expert install location on the Windows node
- Python bridge and data collection setup

## Key documents

- [AGENTS.md](./AGENTS.md): agent responsibilities and sprint flow
- [SOUL.md](./SOUL.md): philosophy, drawdown rules, and hard-task boundaries
- [ARCHITECTURE.md](./ARCHITECTURE.md): MQL5 structure and node topology
- [DEVELOPMENT.md](./DEVELOPMENT.md): setup and operational workflow
- [EA_TRADING_PLAN.md](./EA_TRADING_PLAN.md): canonical trading plan, gates, and implementation order
- [SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md](./SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md): Sentinel-specific design and phase plan
- [AUDIT_AND_STRATEGY.md](./AUDIT_AND_STRATEGY.md): audit findings and technology choices
- [FINAL_IMPLEMENTATION_PLAN.md](./FINAL_IMPLEMENTATION_PLAN.md): superseded planning history kept for reference

## Constraints and disclaimers

- This repository is a project-specific fork, not the canonical upstream OpenCode repository documentation.
- Trading strategy ideas in this repository should be treated as research and engineering artifacts, not as proof of production-grade profitability.
- ONNX integration is a controlled candidate path and must not bypass the validation process described in the project documents.
- Risk management rules take precedence over signal generation.

## Project-specific extensions in this fork

This repository also contains fork-specific extensions beyond the base trading README shape. The two main themes are durable project memory handoff and MT5/EA safety validation.

### Trade Memory Service

The memory system lives outside core OpenCode and keeps the upstream session engine untouched.

- canonical external SQLite memory database: `memory.sqlite3`
- read-only sync from `opencode.db` into a searchable conversation index
- exact FTS search over prior user messages and assistant final text
- curated memory notes with `memory_type`, `status`, `importance`, `scope`, and source links
- pinning for notes that must always be included in handoff
- secret redaction before storing searchable memory content
- sync bookkeeping through `sync_run`, stale reconciliation, and source signature checks
- optional semantic-search surface, currently disabled unless separately configured

Implementation files:

- `.opencode/trade-memory-core/schema.ts`
- `.opencode/trade-memory-core/sync.ts`
- `.opencode/trade-memory-core/search.ts`
- `.opencode/trade-memory-core/notes.ts`
- `.opencode/mcp/service.ts`
- `.opencode/mcp/trade-memory-server.ts`

### EA Lab Memory System

This fork includes **EA Lab Memory System - Phase 1: Memory Foundations**, a repo-local memory foundation for evidence-gated MT5 EA research and development.

Phase 1 adds a separate structured memory layer without modifying OpenCode core. The current repo also includes follow-up safety hardening on top of that foundation:

- SQLite schema and schema health checks under `.opencode/ea-lab-core`
- redaction before storing searchable research notes, locators, and JSON payloads
- evidence records for backtests, logs, commits, URLs, messages, and manual notes
- experiment ledger for hypotheses, test conditions, metrics, stages, and outcomes
- experience memory for reusable successes, failures, near misses, and rejection rules
- deterministic similar-experience search through SQLite FTS
- conservative risk gate parsing and checks from `risk/gates.yaml`
- service-level enforcement that blocks unsafe promotion and live-stage experiment transitions
- repo-local MCP entrypoint and HTTP health endpoint under `.opencode/mcp/ea-lab-*`

`trade-memory` keeps conversation and handoff context. EA Lab Memory is the new structured layer for trading evidence, experiment decisions, and risk constraints. It is intentionally separate in Phase 1 so it can be tested before deeper handoff injection or model-switch integration.

EA Lab still does **not** enable live trading, automatic lot-size changes, risk-gate relaxation, MT5 execution, Context7 integration, wiki automation, or automatic injection into every OpenCode session. There is also no human-approved live override path yet.

See [EA Lab Memory Foundations](./docs/ea-lab-memory-foundations.md) for details.

### Memory Handoff Bridge

This fork adds a thin plugin bridge so model switches do not silently drop critical project state.

- watches `session.next.model.switched`
- records pending handoff state per session and model
- can autostart the local memory service when enabled
- injects a bounded handoff block into `experimental.chat.system.transform`
- reuses the same handoff path during `experimental.session.compacting`
- tracks freshness and warns when memory may be stale or unavailable
- clears pending handoff state only after a matching acknowledgement

Implementation files:

- `.opencode/plugins/trade-handoff-bridge.ts`
- `MEMORY_HANDOFF_ARCHITECTURE.md`

### Built-in Trade Memory Tools and MCP Surface

The repository exposes the memory system in two ways: plugin tools for local OpenCode workflows and MCP/HTTP endpoints for external clients.

Plugin tools include:

- `sync_trade_memory`
- `search_trade_conversations`
- `open_trade_conversation_source`
- `store_trade_memory_note`
- `update_trade_memory_note_status`
- `search_trade_memory_notes`
- `render_trade_oracle_note`

The MCP/HTTP service additionally exposes health, handoff, pin, and note-management operations such as:

- `trade_memory_health`
- `trade_memory_sync`
- `trade_memory_get_handoff_context`
- `trade_memory_model_switched`
- `trade_memory_pin_note`
- `trade_memory_list_pins`

### MT5 / EA Safety Validation Toolkit

This fork also contains a trading-oriented validation stack for MT5 Expert Advisor safety work. It is designed to keep strategy logic, execution checks, and audit evidence separate.

- `BrokerSymbolProfile.mqh` for broker and symbol metadata capture plus fail-close validation
- `TradeExecutor.mqh` for execution preflight:
  - price normalization
  - stop and freeze distance validation
  - spread guard
  - margin guard
  - filling mode resolution
  - skip-reason logging
- `RiskManagement.mqh` as the safety-first risk boundary
- `Expert_Main.mq5` as orchestration only
- MT5 parser gate in `src/Scripts/analyze_mt5_report.py`
- regression coverage in `src/Scripts/tests/test_analyze_mt5_report.py`
- backtest gate scenarios in `backtest/gate_config.json`
- operational runbooks and audit plans in:
  - `EA_TRADING_PLAN.md`
  - `SENTINEL_BREAKOUT_IMPLEMENTATION_PLAN.md`
  - `REMOTE_MT5_COMPILE_SMOKE_RUNBOOK.md`
  - `STRICT_REMEDIATION_PLAN.md`

Current design intent:

- validate execution hygiene before new strategy rollout
- treat parser-based pass/fail evidence as a first-class artifact
- keep strategy modules from sending orders directly
- separate remote compile and smoke procedures from strategy design
