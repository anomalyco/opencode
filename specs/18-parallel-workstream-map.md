## Parallel workstream map

Use this as the assignment sheet for running multiple agents at once.

---

### Workstreams

1. `specs/09-session-page-decomposition.md`
2. `specs/10-layout-page-decomposition.md`
3. `specs/11-prompt-input-and-optimistic-state.md`
4. `specs/12-global-sync-domain-split.md`
5. `specs/13-file-context-domain-split.md`
6. `specs/14-server-health-and-row-dedupe.md`
7. `specs/15-runtime-adapter-type-safety.md`
8. `specs/16-i18n-hardening-and-parity.md`
9. `specs/17-unit-test-foundation.md`

---

### File-ownership matrix

| Spec | Primary ownership                                                                                                             | Avoid editing                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 09   | `pages/session.tsx`, `pages/session/**`                                                                                       | `pages/layout.tsx`, `components/prompt-input.tsx`, `context/global-sync.tsx`, `context/file.tsx` |
| 10   | `pages/layout.tsx`, `pages/layout/**`                                                                                         | `pages/session.tsx`, `components/prompt-input.tsx`, `context/global-sync.tsx`                    |
| 11   | `components/prompt-input.tsx`, `components/prompt-input/**`, `context/sync.tsx` (optimistic API only)                         | `pages/session.tsx`, `pages/layout.tsx`, `context/global-sync.tsx`, `context/file.tsx`           |
| 12   | `context/global-sync.tsx`, `context/global-sync/**`                                                                           | `context/file.tsx`, `components/prompt-input.tsx`, page files                                    |
| 13   | `context/file.tsx`, `context/file/**`, `utils/scoped-cache.ts` (only when file-view cache extraction needs it)                | `context/global-sync.tsx`, `components/prompt-input.tsx`, page files                             |
| 14   | `components/dialog-select-server.tsx`, `components/status-popover.tsx`, `context/server.tsx`, shared server utility/component | terminal/speech/serialize files                                                                  |
| 15   | `components/terminal.tsx`, `utils/speech.ts`, `addons/serialize.ts`, `components/dialog-select-model.tsx`, adapter utilities  | server status/dialog/context files                                                               |
| 16   | `context/language.tsx`, `i18n/*.ts`, `components/dialog-custom-provider.tsx`, `pages/directory-layout.tsx`                    | major page/context refactors                                                                     |
| 17   | `package.json` (test scripts), `happydom.ts`, `src/**/*.test.*`                                                               | product code files in other specs unless strictly needed                                         |

---

### Recommended execution order (if all start together)

- Start all 9 in parallel.
- Merge low-conflict streams first: 12, 13, 14, 15, 16, 17.
- Then merge 09, 10, 11 (largest diff sizes and highest rebase probability).

---

### Integration checkpoint

After all streams merge, run a full verification pass in `packages/app`:

- `bun run typecheck`
- `bun run test:unit` (from spec 17)
- targeted e2e smoke for session/layout/prompt/server/terminal flows
