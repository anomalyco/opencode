## Parallel agent plan

Execution map for session-page improvement concerns

---

### New specs added

- `specs/09-session-page-hot-paths.md`
- `specs/10-file-content-eviction-accounting.md`
- `specs/11-layout-view-tabs-reactivity.md`
- `specs/12-session-context-metrics-shared.md`
- `specs/13-file-tree-fetch-discipline.md`
- `specs/14-comments-aggregation-index.md`
- `specs/15-prompt-input-modularization.md`
- `specs/16-terminal-cache-key-clarity.md`

---

### Existing related specs

- `specs/04-scroll-spy-optimization.md` (session scroll-spy concern)
- `specs/05-modularize-and-dedupe.md` (broad modularization roadmap)

---

### Parallel-safe batching

Batch A (run one at a time, shared `session.tsx` surface):

- `specs/09-session-page-hot-paths.md`
- `specs/04-scroll-spy-optimization.md`

Batch B (parallel with each other and with Batch A):

- `specs/10-file-content-eviction-accounting.md`
- `specs/11-layout-view-tabs-reactivity.md`
- `specs/12-session-context-metrics-shared.md`
- `specs/13-file-tree-fetch-discipline.md`
- `specs/14-comments-aggregation-index.md`
- `specs/15-prompt-input-modularization.md`
- `specs/16-terminal-cache-key-clarity.md`

Batch C (broad follow-up after focused specs land):

- `specs/05-modularize-and-dedupe.md`

---

### Suggested assignment

1. Agent A: `specs/09-session-page-hot-paths.md`
2. Agent B: `specs/10-file-content-eviction-accounting.md`
3. Agent C: `specs/11-layout-view-tabs-reactivity.md`
4. Agent D: `specs/12-session-context-metrics-shared.md`
5. Agent E: `specs/13-file-tree-fetch-discipline.md`
6. Agent F: `specs/14-comments-aggregation-index.md`
7. Agent G: `specs/15-prompt-input-modularization.md`
8. Agent H: `specs/16-terminal-cache-key-clarity.md`
