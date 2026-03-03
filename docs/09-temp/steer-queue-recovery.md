# Steer/Queue UI Recovery Plan

## Status
The steer/queue backend is fully intact:
- `packages/opencode/src/session/steer.ts` ✅
- `packages/opencode/src/server/routes/session.ts` (steer routes) ✅
- `packages/opencode/test/session/steer.test.ts` (18 tests) ✅
- `packages/opencode/src/session/prompt.ts` (steer drain in loop) ✅
- `packages/app/src/context/global-sync/child-store.ts` (steer_queue state) ✅ RESTORED
- `packages/app/src/context/global-sync/event-reducer.ts` ✅
- `packages/app/src/context/global-sync/types.ts` ✅

## What's Missing
The **prompt-input.tsx** steer/queue UI was lost during merge (upstream's solidjs refactoring #13399 conflicted).

## Recovery Approach
Extract steer/queue UI additions from pre-merge and add to current prompt-input.tsx:

```bash
# Get the diff showing prax-dev's steer additions:
git diff 881ca8643 358027ace -- packages/app/src/components/prompt-input.tsx > /tmp/prax-prompt-input-steer.diff

# Key steer/queue additions to re-add:
```

### 1. steerQueue memo (near other createMemo calls)
```tsx
const steerQueue = createMemo(() => sync.data.steer_queue[params.id ?? ""] ?? [])
```

### 2. Shift+Enter handler (steer mode — inject mid-turn)
When session is busy and user presses Shift+Enter, send as "steer":
```tsx
fetch(`${sdk.url}/session/${sessionID}/steer`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, mode: "steer" }),
})
```

### 3. Enter handler when busy (queue mode)
When session is busy and user presses Enter, queue the message:
```tsx
fetch(`${sdk.url}/session/${sessionID}/steer`, {
  method: "POST", 
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, mode: "queue" }),
})
```

### 4. Queue widget UI (show queued messages)
```tsx
<Show when={steerQueue().length > 0}>
  <div>Queued ({steerQueue().length})</div>
  <For each={steerQueue()}>
    {(item) => (
      <div class="flex items-center gap-1.5 group/steer">
        <span>{item.text}</span>
        <button onClick={() => fetch(`${sdk.url}/session/${sessionID}/steer/${item.id}`, { method: "DELETE" })}>×</button>
      </div>
    )}
  </For>
</Show>
```

### 5. Split button icons
- Queue: `arrow-down-to-line` icon
- Steer: `chevron-double-right` icon (already at line 1358)

## Pre-merge reference commit
`358027ace` — full prax-dev state before merge
