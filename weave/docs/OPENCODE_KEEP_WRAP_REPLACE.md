# OpenCode Keep / Wrap / Replace Matrix

> Companion inventory for `/Users/anthonykim/projects/weave/docs/OPENCODE_FORK_PLAN.md`.
> This file is for source ownership and migration tracking, not for broad
> architecture narrative.

## Status Meanings

- `keep`: retain mostly as-is in the first fork
- `wrap`: preserve upstream implementation but intercept behavior with Weave
  adapters
- `replace`: Weave should become the semantic owner

## 1. Chassis

| Upstream Path | Status | Why | Weave Seam |
|---|---|---|---|
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/index.ts` | keep | CLI bootstrap is already mature | branding and command registration only |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/cli/` | keep | command shell and startup flow are upstream strengths | add Weave-facing commands incrementally |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/provider/` | keep | provider integrations are not the differentiator | consume as platform layer |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/config/` | keep | config layering is reusable | add Weave config keys |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/permission/` | keep | permission model is already product-grade | extend for Weave tool roles |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/mcp/` | keep | not core to Weave’s architecture change | leave intact early |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/plugin/` | keep | ecosystem compatibility matters | no early changes |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/pty/` | keep | PTY is shell infrastructure, not memory-engine work | keep separate from Weave engine |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/server/` | keep | server/client shell is valuable | add Weave routes later |

## 2. Session Layer

| Upstream Path | Status | Why | Weave Seam |
|---|---|---|---|
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/index.ts` | wrap | session lifecycle still useful, but semantics change | route session creation and child-session metadata through Weave runtime |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/prompt.ts` | wrap | prompt execution is a natural interception point | call Weave context assembly before prompt submission |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/llm.ts` | wrap | model execution should remain reusable | inject Weave-built context and retrieval hints |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/status.ts` | wrap | session state events remain useful | extend with thread, episode, and compaction events |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/message.ts` | wrap | existing message structures may still be useful for UI compatibility | adapt into Weave message lineage model |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/message-v2.ts` | wrap | same reason as above | likely bridge layer rather than destination model |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/summary.ts` | replace | Weave needs its own summary semantics | move to Weave DAG model |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/session/compaction.ts` | replace | Weave compaction is architecturally different | replace with Weave threshold/DAG engine |

## 3. Tool Layer

| Upstream Path | Status | Why | Weave Seam |
|---|---|---|---|
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/tool.ts` | wrap | tool framework is reusable | add Weave tool categories and role-based access |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/registry.ts` | wrap | registration stays useful | register Weave memory and dispatch tools |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/task.ts` | wrap | task spawning is the likely substrate for threads | child sessions become typed Weave threads |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/read.ts` | keep | coding tool stays generic | no early semantic changes |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/edit.ts` | keep | coding tool stays generic | no early semantic changes |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/bash.ts` | keep | coding tool stays generic | no early semantic changes |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/todo.ts` | keep | task-tracking utility may remain useful | revisit only if Weave thread UX demands it |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/tool/plan.ts` | keep | user-facing planning mode can coexist | low priority for Weave engine work |

## 4. TUI Layer

| Upstream Path | Status | Why | Weave Seam |
|---|---|---|---|
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/cli/cmd/tui/` | keep | OpenCode TUI is a major reason to fork | extend rather than replace |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/cli/cmd/tui/context/sync.tsx` | wrap | sync layer is the natural place to introduce Weave state | subscribe to thread, episode, and DAG routes/events |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/cli/cmd/tui/context/task-tree.tsx` | wrap | closest upstream analogue to Weave thread tree | adapt to typed threads and episodes |
| `/Users/anthonykim/projects/weave/references/opencode/packages/opencode/src/cli/cmd/tui/context/route.tsx` | wrap | route model should stay, but new Weave views are needed | add DAG and episode routes |

## 5. New Weave-Owned Areas

These have no real upstream owner and should be Weave-native from the start:

| New Path | Role |
|---|---|
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/` | Weave engine namespace |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/context.ts` | active context assembly |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/db.ts` | memory persistence |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/summary.ts` | summary DAG model |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/episode.ts` | episode creation and storage |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/session/weave/orchestrator.ts` | orchestration semantics |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-grep.ts` | memory retrieval |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-describe.ts` | DAG inspection |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/weave-expand.ts` | lossless expansion |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/dispatch-thread.ts` | thread creation |
| `/Users/anthonykim/projects/weave_mono/weave_opencode/packages/opencode/src/tool/dispatch-threads.ts` | batch dispatch |

## 6. Decision Gates

These rows cannot be finalized until the architecture decision doc exists:

| Question | Affected Areas |
|---|---|
| shared store vs dedicated Weave store | session, retrieval, server routes, migrations |
| mirror OpenCode messages vs replace prompt history ownership | session prompt path, UI sync, retrieval |
| child session metadata format for threads | task tool, session index, TUI task tree |
| canonical tool IDs and naming | tool registry, prompts, docs, UI |

## 7. Next Matrix Expansion

This matrix should next be expanded with:

1. exact target fork paths once `weave_opencode` exists
2. one row per `src/session/*` file
3. one row per `src/tool/*` file touched by Weave
4. owner column naming the future module or namespace responsible

## 8. First interception seam (agreed)

**Seam:** `session/prompt.ts` (and the code path that assembles messages immediately before the LLM call).

**Mechanism:** Introduce a single hook, e.g. `buildWeaveContext(session): Message[]` or delegate to `session/weave/context.ts`, called from the prompt assembly path before `session/llm.ts` sends the request. **Do not** scatter Weave logic across unrelated files before that namespace exists.

**Ownership:** `wrap` on `prompt.ts` and `llm.ts`; first **replace** surface is Weave-owned context + store (see [OPENCODE_ARCHITECTURE_DECISIONS.md](OPENCODE_ARCHITECTURE_DECISIONS.md)).

**Monorepo note:** Target fork root for this repo is [`weave_opencode`](../../weave_opencode/) at the `weave_mono` root once OpenCode is vendored.
