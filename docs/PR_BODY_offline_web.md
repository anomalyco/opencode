Draft PR description for maintainers: paste into GitHub (not an official repo file). Replace `ISSUE_NUMBER` with your [anomalyco/opencode](https://github.com/anomalyco/opencode) issue. Delete this paragraph before pasting.

---

### Issue for this PR

Closes #ISSUE_NUMBER

### Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor / code improvement
- [x] Documentation

### What does this PR do?

**Problem:** `opencode web` serves the browser UI by proxying to `https://app.opencode.ai` when no API route matches. On machines without outbound access to that host, the UI never loads.

**Changes:**

1. **`packages/opencode/src/server/server.ts`** — If `packages/app/dist/index.html` exists (or `OPENCODE_APP_DIST` points at a directory that contains it), serve files from that directory with the same SPA fallback as before (unknown paths → `index.html`). Otherwise keep the existing proxy behavior.
2. **`Flag.OPENCODE_APP_DIST`** in `packages/opencode/src/flag/flag.ts` — Documents and centralizes the env var used for the absolute path override.
3. **One log line** when local dist is used (`serving web UI from local dist` with `root`) so operators can confirm the proxy is not in use.
4. **`packages/app`** — Changelog fetch uses `/changelog.json` (from `public/` after build); notification and project avatar use same-origin favicon paths instead of `https://opencode.ai/...`, so those requests stay on the server.
5. **`docs/OFFLINE_WEB.md`** (English) — How to build `packages/app`, which env vars matter, and troubleshooting. **`CONTRIBUTING.md`** — Short subsection linking to that doc.

**Why it works:** The Vite production bundle is static files. Serving them from the same process that hosts the API avoids any dependency on `app.opencode.ai` for HTML/JS/CSS. The API routes are unchanged and still registered before the catch-all.

### How did you verify your code works?

- `bun run build` in `packages/app` so `dist/index.html` exists.
- `OPENCODE_APP_DIST` set to that `dist` path (or rely on default path from `packages/opencode`), then `bun run --conditions=browser ./src/index.ts web` from `packages/opencode`.
- Confirmed the browser loads the app from `http://127.0.0.1:4096` and the server logs `serving web UI from local dist` once.
- With `dist` removed or renamed, confirmed fallback still proxies (when network allows) so default behavior is preserved.

### Screenshots / recordings

Optional: browser showing the app loaded from localhost while offline (no change to core UI layout intended).

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
