---
title: Optional Code Mode call timeouts
description: Keep agent-selected invocation deadlines separate from tool arguments and producer policies.
status: accepted
date: 2026-11-15
decision-makers: agent
---

## Context

One unanswered tool can hold a parallel Code Mode program open and delay admitted steering input. The user selected explicit per-call control without new default deadlines or provider-specific rules.

## Options considered

- Change every MCP execution default: rejected because MCP servers expose work with different legitimate durations.
- Wrap every tool in a mandatory generic deadline: rejected because it changes long-running tools and approval waits.
- Add an optional program-side argument interpreted by Code Mode: selected because timeout policy remains separate from provider input, existing calls are unchanged, and the runtime already owns call fibers and lifecycle hooks.

## Decision

Hosts opt into a `toolTimeouts` capability. Ordinary and idempotent Code Mode calls may then pass `{ timeoutMs }` as their second argument. The positive safe-integer value is elapsed milliseconds for that invocation. Expiry interrupts the invocation's effect and rejects its promise as a normal tool failure. It does not interrupt the parent program or replay work. Existing earlier producer or interpreter limits still apply. Omission adds no deadline. OpenCode exposes this behind `codemode_tool_timeouts` and explains it in execute guidance.

## Consequences

Tools and MCP servers receive their original input. Promise.allSettled can retain successful siblings. Explicitly selected budgets include waits performed inside the tool, including approvals. Cancellation requests do not prove a remote action stopped or rolled back. Native model tool schemas and durable library tool suspension remain outside this contract.

## Revisit when

Native model tools need equivalent controls, or durable tool calls need budgets across suspension. Those require explicit interfaces rather than injecting reserved fields into arbitrary tool input.

## Links

- [Tool semantics](./tools.md)
- [Implementation plan](../../docs/plans/2026-11-15-per-call-timeouts.md)
- [Reported hang](https://github.com/anomalyco/opencode/issues/64165)
- [Timeout issue](https://github.com/anomalyco/opencode/issues/54220)
