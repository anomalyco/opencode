# Console Log 1 — Initial diagnosis (2026-05-01)

Captured by user from a Tauri webview / web build of OpenCode 1.3.15-dev while reproducing flicker + freeze in session `ses_222c3a1f3ffeKdZxmCyui1E189`.

## Key observations distilled from the raw log

### A. canWindow flip pattern (Bug 1)

```
[markdown] mount    – {key: "prt_de1eae6be001x2niV2jrhhHXap:stream", text: 1}
[timeline] active item unmounted – {msg: "msg_de1ea992d001vXSdCRjadpQnW2", index: 0, working: false, visibleSize: 9, first: "msg_da12ded430015MoEz9jkVZE7mu"}
[markdown] cleanup – {key: "prt_de1eabe37001TKdgL2MuO4S801", text: 1788}
[markdown] cleanup – {key: "prt_de1eae6be001x2niV2jrhhHXap:stream", text: 906}
[timeline] rendered slice – {first: "msg_da12ded430015MoEz9jkVZE7mu", last: "msg_ddd34ed3c001Eo4xYq9r2w17DC", size: 9}
[timeline] window state – {can: true,  start: 0, end: 5, size: 9, prevCan: false}    ← can: false → true
[timeline] active message – {prev: "msg_de1ea992d001vXSdCRjadpQnW2", next: undefined, rendered: 9, live: true, bottom: false}
[timeline] slow measure – {msg: "msg_da12ded430015MoEz9jkVZE7mu", height: 160, took: 55}
[timeline] window state – {can: false, start: 0, end: 9, size: 9, prevCan: true}     ← can: true → false (flip back)
[timeline] rendered slice – {first: "msg_da12f6898001n5iXZuuXYMKiY6", last: "msg_ddd34ed3c001Eo4xYq9r2w17DC", size: 8}
[timeline] window state – {can: false, start: 0, end: 8, size: 8, prevCan: false}
[timeline] window state – {can: true,  start: 0, end: 8, size: 8, prevCan: false}
[timeline] rendered slice – {first: "msg_dddc0d4ae0016issM4RMTE170Q", last: "msg_de1ea992d001vXSdCRjadpQnW2", size: 5}
[timeline] window state – {can: false, start: 0, end: 5, size: 5, prevCan: true}
[timeline] active message – {prev: undefined, next: "msg_de1ea992d001vXSdCRjadpQnW2", rendered: 5, live: true, bottom: true}
[timeline] slow measure – {msg: "msg_dddc0d4ae0016issM4RMTE170Q", height: 4243, took: 101}    ← 101 ms single offsetHeight read on 4243px turn
[timeline] active item mounted – {msg: "msg_de1ea992d001vXSdCRjadpQnW2", index: 4, visible: true}
[markdown] mount – {key: "prt_de1eabe37001TKdgL2MuO4S801", text: 1788}
[markdown] mount – {key: "prt_de1eae6be001x2niV2jrhhHXap:stream", text: 1158}
[markdown] cleanup – {key: "prt_de1eabe37001TKdgL2MuO4S801", text: 1788}
[markdown] cleanup – {key: "prt_de1eae6be001x2niV2jrhhHXap:stream", text: 1159}
[timeline] window state – {can: false, start: 0, end: 5, size: 4, prevCan: false}
[timeline] active item mounted – {msg: "msg_de1ea992d001vXSdCRjadpQnW2", index: 3, visible: true}
[timeline] rendered slice – {first: "msg_dde18d174001g2whDD37qoYocy", last: "msg_de1ea992d001vXSdCRjadpQnW2", size: 4}
[timeline] window state – {can: false, start: 0, end: 4, size: 4, prevCan: false}
[captureWindowAnchor] ABNORMAL anchor position: id=msg_dde5ad7910019skEReGb3Matnq top=-36774.14 threshold=8340.00 - DOM may not be ready, skipping anchor
```

Key signals:
- `prevCan: false → can: true → can: false` round-trip within ~milliseconds
- `working: false` reported on `active item unmounted` event
- `prt_de1eabe37001TKdgL2MuO4S801` (text=1788, stable historical part) is unmounted and remounted by the windowing-driven `<For>` rebuild — not by content change
- `slow measure took: 101` on 4243 px turn after remount: synchronous `offsetHeight` read forces full layout
- `[captureWindowAnchor] ABNORMAL anchor position top=-36774.14`: DOM is in a transient mid-state, anchor capture skipped

### B. KaTeX-driven non-prefix morph storm (Bug 2A)

Same streaming part `prt_de1eabe37001TKdgL2MuO4S801` produced 200+ entries during one streaming pass:

```
[markdown] non-prefix morph – {prev: 318,  next: 330,  old: 2,  fresh: 2}
[markdown] non-prefix morph – {prev: 592,  next: 611,  old: 6,  fresh: 8}
[markdown] non-prefix morph – {prev: 611,  next: 617,  old: 8,  fresh: 8}
[markdown] non-prefix morph – {prev: 617,  next: 618,  old: 8,  fresh: 8}
[markdown] non-prefix morph – {prev: 618,  next: 622,  old: 8,  fresh: 8}
... (200+ similar lines as text grew from 318 to 2044) ...
[markdown] non-prefix morph – {prev: 2029, next: 2044, old: 12, fresh: 12}
```

Key signals:
- 200+ entries on a single ~2 KB streaming part
- top-level node count (`old`/`fresh`) fluctuates: 2 → 6 → 8 → 12, indicating structural reorganisation per token, not just text growth
- `next - prev` is small (1–37 chars) per entry: each entry corresponds roughly to one batched token delta

### C. Source location

Code references in this log:

| Log prefix | Source location |
|---|---|
| `[markdown] non-prefix morph` | `packages/ui/src/components/markdown.tsx:957-967` |
| `[markdown] mount` / `cleanup` | `packages/ui/src/components/markdown.tsx:586`, `:596` |
| `[timeline] active item unmounted` / `mounted` | `packages/app/src/pages/session/message-timeline.tsx:1619`, `:1684` |
| `[timeline] window state` | `packages/app/src/pages/session/message-timeline.tsx:803` |
| `[timeline] rendered slice` | `packages/app/src/pages/session/message-timeline.tsx:470` |
| `[timeline] slow measure` | `packages/app/src/pages/session/message-timeline.tsx:1640` |
| `[timeline] active message` | `packages/app/src/pages/session/message-timeline.tsx:612` |
| `[captureWindowAnchor] ABNORMAL` | `packages/app/src/pages/session/message-timeline.tsx:334` |

These are pre-existing instruments in the codebase (not added for this investigation), which is helpful: validation of fixes can re-use the same channels.

## Acquisition method note

Performance panel was unavailable to the user (likely Tauri webview without devTools enabled, or Safari WebKit which lacks Chrome's Performance panel). Diagnosis relied entirely on existing console instruments. For future verification on Tauri 1.3.15+, either:

1. Run `bun --filter @opencode-ai/app dev` and use Chrome DevTools on the Vite dev server
2. Set `app.devTools = true` in `packages/desktop/src-tauri/tauri.conf.json` and rebuild

The existing console instruments are sufficient for validating Bug 1's fix (look for `prevCan` flip absence). Validating Bug 2A's fix benefits from a Performance recording but can also be done by counting `non-prefix morph` log entries.
