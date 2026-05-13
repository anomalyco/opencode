# Fix Streaming-Time Turn Unmount Flicker And Slow Markdown Morph In Math-Heavy Sessions

## Problem Statement

Long math-heavy sessions show two related regressions during streaming generation, observed first in session `ses_222c3a1f3ffeKdZxmCyui1E189` ("04-18-flavored-Schur-index续推至下一阶"):

### Bug 1: 整段消失再恢复（per-frame flicker）

流式生成期间，从助手回复开头到当前段落的**全部内容**会在某一帧整体消失，只剩下当前正在生成的段落开头；下一帧又恢复正常显示。重复发生。

This is structurally identical to task `04-16-04-16-message-jump-blank-page` (windowing instability), but with a different trigger. That task is triggered by **session switching**; this one is triggered by **tool-call boundaries within the same active session**.

The earlier commit `1f7ca20f4 fix(ui): guard markdown async cleanup on unmount` only guards against post-unmount race conditions in `markdown.tsx`; it does **not** address what triggers the unmount in the first place.

### Bug 2: 流式期间界面卡顿（multi-second freezes）

流式生成期间界面卡顿严重（几秒到十几秒主线程无响应）。流式生成结束后立即恢复流畅。

## Reproducer Profile

| Metric | Value |
|---|---|
| messages | 149 |
| parts (total) | 2855 |
| tool parts | 2407 (~ 2 MB JSON, max single 60 KB) |
| reasoning parts | 141 (~ 165 KB) |
| text parts | 25 (~ 7 KB) |
| step-start/finish | 282 |

会话特征：高数学公式密度（Schur index 物理研究，KaTeX 公式众多）+ 子代理 (`wls-computational-verifier`) 频繁工具往返。

## Diagnosis

### Bug 1 — `canWindow` flips at tool-call boundaries

`packages/app/src/pages/session/message-timeline.tsx:301`:

```typescript
const canWindow = createMemo(() => !isWorking() && !sessionSwitching())
```

`isWorking()` is defined in `session-working.ts:18`:

```typescript
export function working(status, list) {
  if ((status ?? idle).type === "idle") return active(list) !== undefined
  const last = list?.at(-1)
  if (!last || last.role !== "assistant") return true
  if (typeof last.time.completed !== "number") return true
  return active(list) !== undefined
}
```

**`isWorking` returns false the moment** the trailing assistant message has `time.completed` set, before the next assistant message is created. With sub-agent tool round-trips (Schur session has 2407 tool parts), this gap occurs between every assistant message. Sequence per gap:

1. assistant message A finishes a step → `time.completed` set → `isWorking = false`
2. `canWindow` becomes `true` → `buildWindow()` recomputes a smaller window
3. `<For each={visibleRendered()}>` array changes, e.g. from 9 items to 5 → trailing 4 turns unmount, **including the active turn the user is reading**
4. ~16-50 ms later, backend pushes `message.updated` for new assistant message B → `isWorking = true`
5. `canWindow` becomes `false` → window expands back → 4 turns remount

User-perceived effect: the entire visible assistant reply blanks for one frame, then reappears.

#### Console evidence (provided by user)

```
[markdown] mount    – {key: "...:stream", text: 1}
[timeline] active item unmounted – {msg: "msg_de1ea...", working: false}
[markdown] cleanup  – {key: "prt_de1eabe37...", text: 1788}
[markdown] cleanup  – {key: "...:stream", text: 906}
[timeline] window state – {can: true,  end: 5, prevCan: false}   ← can: false → true
[timeline] active message – {prev: "msg_de1ea...", next: undefined}
[timeline] slow measure – took: 55
[timeline] window state – {can: false, end: 9, prevCan: true}    ← can: true → false (flip back)
```

The `prevCan` field is the smoking gun: `canWindow` flips false → true → false within the same streaming session.

### Bug 2A — KaTeX causes `non-prefix morph` storm

`packages/ui/src/components/markdown.tsx:906` defines a fast-append path:

```typescript
if (isStreaming && prevHtml && content.startsWith(prevHtml.slice(0, prevHtml.lastIndexOf("<")))) {
  // append-only path; cheap
}
```

This requires the new HTML to be a prefix of the old HTML up to the last open tag. With `marked-katex-extension`, an unclosed `$` later in the stream causes already-closed `$...$` to be re-tokenized as literal text:

```
"已渲染 $E=mc^2$ ..."          → <p>...<span class="katex">…</span>...</p>
"已渲染 $E=mc^2$ ... $\frac{1"    → <p>...$E=mc^2$ ... $\frac{1</p>   ← already-closed $$ falls back
"已渲染 $E=mc^2$ ... $\frac{1}{2}$" → <p>...<span class="katex">…</span>...<span class="katex">…</span></p>
```

Result: fast-append fails, full `morphdom` runs every token delta. User console shows **200+** entries:

```
[markdown] non-prefix morph – {prev: 318, next: 330, old: 2,  fresh: 2}
... (200+ entries on a single streaming part) ...
[markdown] non-prefix morph – {prev: 2029, next: 2044, old: 12, fresh: 12}
```

Note `old: 2 → 6 → 8 → 12` shows the top-level node count itself fluctuating: structural reorganisation, not just text growth. Each iteration runs DOMPurify + morphdom diff on the full HTML — accumulated cost reaches seconds.

This also explains an additional observable subset of Bug 1: existing rendered KaTeX nodes are sometimes replaced by literal `$...$` text mid-stream.

### Bug 2B — Forced layout on `offsetHeight`

`message-timeline.tsx:1632`:

```typescript
const next = rootRef?.offsetHeight   // synchronous layout
```

Console:

```
[timeline] slow measure – {height: 4243, took: 101}
[timeline] slow measure – {height: 160,  took: 55}
```

Single `offsetHeight` read costs **101 ms** on a 4243 px tall turn (which contains many tool parts). Cause: with windowing disabled during streaming, the entire turn DOM is mounted, so the layout tree is deep and synchronous height measurement triggers a full layout pass.

### Bug 2C — Whole-tree `MutationObserver` + forced reflow

`message-timeline.tsx:708-713`:

```typescript
observer.observe(body, {
  childList: true,
  subtree: true,
  characterData: true,
})
```

Callback (line 691):

```typescript
root.scrollTop = root.scrollHeight   // forces full layout / reflow
```

Every textNode mutation in the entire viewport subtree fires the callback. With 2855 parts mounted, each scroll write triggers layout that takes tens-to-hundreds of ms. rAF batching reduces frequency to once per frame but does not reduce per-frame cost.

### Secondary contributors (not on the critical path)

- `message-timeline.tsx:1622-1624` – `JSON.stringify`-based `equals` on `comments` createMemo runs across all rendered turns on every part change.
- 149+ `ResizeObserver`s, hundreds of `IntersectionObserver`s mounted in parallel (one per markdown part).
- Backend `Session.updatePart` (`packages/opencode/src/session/index.ts:684`) calls `structuredClone(part)` on every update — full deep-clone of 60 KB tool parts. `Bus.publish` is synchronous, `SyncEvent.run` wraps in immediate SQLite transaction. **Indirect**: backend slowness reduces SSE rate, which actually *reduces* frontend pressure rather than adding to it.

## Repair Plan

### A. canWindow with hysteresis on `isWorking` (Bug 1, minimal patch)

`packages/app/src/pages/session/message-timeline.tsx`, near line 283:

```typescript
const [workingSettled, setWorkingSettled] = createSignal(true)

createEffect(
  on(
    isWorking,
    (working) => {
      if (working) {
        setWorkingSettled(false)
        return
      }
      // working: true → false
      // wait 800ms before considering it actually idle
      // sub-agent tool boundaries (typically <200ms) won't flip canWindow
      const timer = setTimeout(() => setWorkingSettled(true), 800)
      onCleanup(() => clearTimeout(timer))
    },
    { defer: true },
  ),
)

// line 301 changes:
const canWindow = createMemo(() => workingSettled() && !sessionSwitching())
```

**Validation signal**: console no longer shows `prevCan: false → can: true → can: false` flips within a single streaming session. Mount/cleanup churn for stable historical parts disappears.

**Threshold tuning**: 800 ms is an estimate. Before committing, add an explicit instrument that logs the actual interval distribution between `working: true → false → true` transitions. Adjust to 95th-percentile-of-tool-gap + a small margin. (See implementation order step 0.)

### B. buildWindow always retains the active turn (Bug 1, structural fix)

In `buildWindow()`, after computing `clampedStart` / `clampedEnd` (around line 425-430), force the active turn into the window:

```typescript
const activeID = activeMessageID()
if (activeID) {
  const activeIndex = renderedIndex().get(activeID)
  if (activeIndex !== undefined) {
    if (activeIndex < clampedStart) clampedStart = activeIndex
    if (activeIndex >= clampedEnd) clampedEnd = activeIndex + 1
  }
}
```

**Validation signal**: even if A's hysteresis is bypassed (e.g. tool gap > 800 ms), the active turn never unmounts, so the user-visible flicker disappears.

A and B are **complementary**, not alternatives. A removes the trigger; B removes the consequence even if the trigger occurs.

### C. Paragraph-level stable / tail split in markdown.tsx (Bug 2A + per-segment flicker)

User-stated requirements (verbatim):

1. 已经完成输出的、当前视窗内的段落正常渲染数学和markdown
2. 流式生成过程中，正在生成的段落可以等候生成完再渲染
3. 流式生成过程中，避免抖动

Implementation plan:

```typescript
// markdown.tsx top-level wrapper
function splitStableTail(text: string, streaming: boolean) {
  if (!streaming) return { stable: text, tail: "" }
  const idx = text.lastIndexOf("\n\n")
  if (idx <= 0) return { stable: "", tail: text }
  if (!balanced(text.slice(0, idx))) return { stable: "", tail: text }
  return { stable: text.slice(0, idx), tail: text.slice(idx) }
}

// state machine over: ``` fenced code, $$ display math, $ inline math, < open HTML tag
function balanced(s: string): boolean { ... }

export function Markdown(props) {
  const split = createMemo(() => splitStableTail(props.text, !!props.streaming))
  return (
    <div class={props.class}>
      <Show when={split().stable}>
        <MarkdownBlock
          text={split().stable}
          streaming={false}                 // stable is never streaming
          cacheKey={`${props.cacheKey}:stable`}
          math="full"
          highlight={props.highlight}
        />
      </Show>
      <Show when={split().tail || !split().stable}>
        <MarkdownBlock
          text={split().tail || split().stable}
          streaming={!!props.streaming}
          cacheKey={`${props.cacheKey}:tail`}
          math="defer"                      // tail does not parse KaTeX during streaming
          highlight="defer"
        />
      </Show>
    </div>
  )
}
```

`MarkdownBlock` is the existing `Markdown` body extracted unchanged.

**Validation signals**:

- `[markdown] non-prefix morph` count drops to ~0 (or only at split-point transitions)
- KaTeX nodes never blank-out and reappear during streaming
- `morphdom` calls per second drop by 10×+

**Edge cases**:

| Case | Behaviour |
|---|---|
| Single long paragraph (no `\n\n`) | `balanced()` may return false → fall back to all-tail (graceful degradation: literal `$` until stream ends) |
| Code fence spans `\n\n` | `balanced()` detects open fence → split point retreats |
| Display math `$$ ... \n\n ... $$` | Same as above |
| Stable boundary advances mid-stream | One extra full re-parse of stable segment (one-shot, cache-hits next time) |

### D. Replace whole-tree `MutationObserver` with `part.delta` subscription (Bug 2C)

Remove `observer.observe(body, { subtree: true, characterData: true })`. Subscribe to `message.part.delta` events directly (via `useGlobalSDK().listenAll` or domain emitter). When `props.live && props.scroll.bottom` and a delta lands on the active part, schedule one rAF to write `scrollTop = scrollHeight`.

This avoids per-textNode mutation callbacks entirely; only one logical event per delta batch.

### E. Resize observer attrition (Bug 2 residual)

After a turn's `measure()` converges (height stable for N frames), `disconnect()` its `ResizeObserver`. Reattach when the turn becomes active again. With C in place, only the tail turn's height changes during streaming, so most observers can disconnect.

## Implementation Order

| Step | Patch | Files | Lines | Validation |
|---|---|---|---|---|
| 0 | Instrument `isWorking` flip intervals | message-timeline.tsx | ~10 (temp) | console histogram, drives A's threshold |
| 1 | A + B together | message-timeline.tsx | ~30 | no `prevCan` flips, no flicker |
| 2 | C paragraph split | markdown.tsx | ~200 (refactor) | non-prefix morph → 0, no KaTeX blink |
| 3 | D mutation observer replacement | message-timeline.tsx | ~40 | drop reflow per frame |
| 4 | E observer attrition | message-timeline.tsx | ~30 | drop background CPU |

Each step is independently revertible. Step 1 is a 30-line change with no impact on rendering correctness; recommended as the first commit.

## Validation Metrics (post-fix)

The following console patterns in the same reproducer session should be observed after applying the corresponding step:

| Step | Console signal pre-fix | Console signal post-fix |
|---|---|---|
| 1 (A+B) | `prevCan: false → can: true` followed by `prevCan: true → can: false` | No `prevCan` flip during a single streaming session; `mount/cleanup` for stable historical parts disappears |
| 2 (C) | 200+ `[markdown] non-prefix morph` per streaming part | 0–5 per part (only at split transitions) |
| 3 (D) | per-frame `[timeline] slow mutation scroll` | infrequent, < 16 ms |
| 4 (E) | many `[timeline] slow measure` entries | < 5 entries per session, all under 30 ms |

Subjective: 整段消失现象消失（step 1）；流式期间界面流畅可滚动（step 1+2）；公式不再回退（step 2）。

## Out of Scope

- Backend `SyncEvent.run` synchronous SQLite transaction optimization (indirect contributor)
- Backend `structuredClone(part)` deep-clone optimization (indirect contributor)
- Existing `04-16-04-16-message-jump-blank-page` task fix (different trigger; structural overlap noted)

## References

- Reproducer session: `ses_222c3a1f3ffeKdZxmCyui1E189`
- Sibling task: `.trellis/tasks/04-16-04-16-message-jump-blank-page/`
- Earlier related fix: `1f7ca20f4 fix(ui): guard markdown async cleanup on unmount`
- User-staged uncommitted instrumentation: `packages/opencode/src/server/routes/event.ts` (`QUEUE_WARN_MS`, `EVENT_SIZE_WARN`) and `packages/opencode/src/session/index.ts` (`PART_WARN_MS`, `DELTA_WARN_MS`, `PART_SIZE_WARN`) — keep these instruments through implementation; useful as backend-side validators.

## Status

User explicitly requested **no immediate code changes**. This task captures the diagnosis and plan for later execution.
