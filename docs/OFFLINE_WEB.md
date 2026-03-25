# Air-gapped or offline `opencode web`

Serve the web UI from a local **`vite build`** output so the server does not proxy to `https://app.opencode.ai`. If no build is present (no `index.html` under the resolved path), behavior is unchanged: the server falls back to that proxy (requires outbound access).

**Before opening a PR for related code changes:** the project expects an [issue first](https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md#issue-first-policy) (`Fixes #…` / `Closes #…` in the PR description).

---

## 1. Build the web app (while online)

From the repository root:

```bash
bun install
cd packages/app
bun run build
```

Confirm **`packages/app/dist/index.html`** exists.

---

## 2. Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENCODE_APP_DIST` | Absolute path to the `dist` directory (must contain `index.html`). If unset, the server looks for `packages/app/dist` relative to the running server package. |
| `OPENCODE_DISABLE_MODELS_FETCH` | Set to `1` to disable periodic fetches to `https://models.dev`. |
| `OPENCODE_MODELS_PATH` | Optional path to a local `api.json`–compatible file (e.g. downloaded from `https://models.dev/api.json`) when the network cannot reach models.dev. |
| `OPENCODE_DISABLE_AUTOUPDATE` | Set to `1` to disable autoupdate checks. |
| `OPENCODE_SERVER_PASSWORD` | Recommended: protect the web server with HTTP Basic auth. |

Download a models list for `OPENCODE_MODELS_PATH` (optional):

```bash
mkdir -p offline
curl -fsSL "https://models.dev/api.json" -o offline/models-api.json
```

The `offline/` directory is gitignored for local mirrors; use any path for `OPENCODE_MODELS_PATH`.

---

## 3. Start

```bash
export PATH="$HOME/.bun/bin:$PATH"
REPO="/path/to/opencode"
export OPENCODE_APP_DIST="$REPO/packages/app/dist"
export OPENCODE_DISABLE_MODELS_FETCH=1
export OPENCODE_MODELS_PATH="$REPO/offline/models-api.json"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_SERVER_PASSWORD="your-strong-password"

cd "$REPO/packages/opencode"
bun run --conditions=browser ./src/index.ts web
```

Open the URL printed in the terminal (often `http://127.0.0.1:4096/`).

On success, logs include **`serving web UI from local dist`** once, with the resolved `root` path.

---

## 4. Bundled static assets in this repo

- **`packages/app/public/changelog.json`** — copied into `dist/` on build; the app requests **`/changelog.json`** on the same origin instead of `https://opencode.ai/changelog.json`.

---

## 5. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Blank page or failed UI load | `OPENCODE_APP_DIST` (if set), and that `dist/index.html` exists at that path. |
| Traffic still goes to `app.opencode.ai` | Invalid or missing local `index.html` causes fallback to the remote proxy. |

---

## 6. Regenerating SDK after server changes

If you change `packages/opencode/src/server/server.ts`, follow [CONTRIBUTING.md](https://github.com/anomalyco/opencode/blob/dev/CONTRIBUTING.md) and run `./script/generate.ts` when API or SDK artifacts need updating.
