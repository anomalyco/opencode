# Releasing Opviera CLI

How a release gets from this repo to `curl -fsSL https://opviera.ai/install | bash`.

The install script (`./install`, served at `opviera.ai/install`) downloads a per-platform binary from
this repo's **GitHub Releases**. So the chain is: build binaries → attach them to a release → serve
the install script. Nothing else is involved — there is no npm package and no CDN.

## Prerequisites

- `bun` (version pinned by `packageManager` in the root `package.json`)
- `gh` CLI, authenticated with write access to `virstack/opviera-cli`
- The repo must stay **public** — the installer calls `api.github.com/.../releases/latest`
  unauthenticated. Making it private breaks the one-liner for everyone.

## One-time setup

### 1. Release workflow — already pointed at this repo ✅

`.github/workflows/publish.yml` has been updated: the repo guards target `virstack/opviera-cli`,
`GH_REPO` uses this repository, release inputs are `OPVIERA_BUMP` / `OPVIERA_VERSION` /
`OPVIERA_RELEASE` / `OPVIERA_CHANNEL`, and the step that installed upstream's CLI into CI (with
their API key, to AI-generate release notes) is gone — changelog generation is now best-effort and
falls back to "No notable changes".

Two jobs are **off by default**, gated on repository variables so no YAML edit is needed to enable
them later:

| Job | Enable with | Needs |
|---|---|---|
| `sign-cli-windows` | `ENABLE_CODE_SIGNING=true` | Azure Trusted Signing credentials |
| `build-electron` | `ENABLE_DESKTOP_BUILD=true` | Apple notarization + Sentry; no desktop app yet |

`publish` runs with `always() && !failure()`, so it proceeds while those are skipped, and the
signed-Windows artifact download is gated on the same variable.

**No secrets are required to cut a release.** `setup-git-committer` uses the built-in `GITHUB_TOKEN`
by default (every workflow that calls it already grants `contents: write`), committing as
`github-actions[bot]`.

A GitHub App is optional. Set repository variable `OPVIERA_APP_ID` and secret `OPVIERA_APP_SECRET`
and the action switches to it automatically — worth doing if you want commits under a Virstack
identity, or if branch protection excludes `GITHUB_TOKEN` (its pushes cannot bypass required
reviews).

### 2. Serve the install script

Serve `./install` from this repo at `https://opviera.ai/install`. The one hard requirement is that
it returns the **raw script body as `text/plain`** — if the host answers with an HTML shell or a 404
page, `curl … | bash` executes that HTML.

nginx:

```nginx
location = /install {
    alias /var/www/opviera/install;
    default_type text/plain;
    add_header Cache-Control "no-store";
}
```

Alternatively serve it from the gateway backend beside the existing `/config/:client` scripts in
`ScriptService`, which gives you the same per-IP rate limiting.

## Cutting a release

### 3. Build the binaries

Release inputs are `OPVIERA_VERSION`, `OPVIERA_CHANNEL`, `OPVIERA_BUMP`, `OPVIERA_RELEASE`. (The old
`OPENCODE_*` names still work as a fallback, so a half-updated pipeline doesn't silently build the
wrong thing.)

Host platform only, to sanity-check the pipeline:

```bash
cd packages/opencode
OPVIERA_VERSION=0.1.0 bun run script/build.ts --single
# → dist/opviera-darwin-arm64/bin/opviera
```

All 12 targets (what a real release ships — linux/darwin/win32 × x64/arm64, plus baseline and musl
variants):

```bash
OPVIERA_VERSION=0.1.0 bun run script/build.ts
```

> `OPVIERA_VERSION` is **required** for a release build. Upstream derived the next version from
> `opencode-ai` on npm; that is disabled, because it would inherit opencode's version lineage and
> publish our first release as something like `v1.18.17`. Preview builds off a non-`latest` branch
> still auto-version as `0.0.0-<branch>-<timestamp>`.

### 4. Publish

The tag must exist before `build.ts` uploads to it. `OPVIERA_RELEASE=1` is what makes the build
package the binaries (tar.gz for linux, zip elsewhere) and run `gh release upload`.

```bash
gh release create v0.1.0 --repo virstack/opviera-cli --title "v0.1.0" --notes "First release"

cd packages/opencode
GH_REPO=virstack/opviera-cli OPVIERA_RELEASE=1 OPVIERA_VERSION=0.1.0 bun run script/build.ts
```

Assets land as `opviera-<os>-<arch>[-baseline][-musl].{zip,tar.gz}` — exactly the names the install
script derives from `$APP-$target$archive_ext`. If these ever stop matching, the installer 404s.

### 5. Code signing (before you announce the URL)

Unsigned binaries are quarantined: macOS reports *"cannot be opened because the developer cannot be
verified"*, and Windows SmartScreen warns. Upstream's pipeline does Apple notarization and Azure
Trusted Signing; both need Virstack certificates. Until then, expect users to hit Gatekeeper.

## Verifying

```bash
curl -fsSL https://opviera.ai/install | head -5    # must be shell, not HTML
curl -fsSL https://opviera.ai/install | bash
opviera --version
```

The installer puts the binary in `~/.opviera/bin` and appends that to `PATH` in the user's shell rc
(`--no-modify-path` opts out). Other flags: `--version <v>` to pin a version, `--binary <path>` to
install from a local build — useful for testing the installer without publishing:

```bash
./install --binary packages/opencode/dist/opviera-darwin-arm64/bin/opviera --no-modify-path
```

## First run

Installing does not sign the user in. In their project directory:

```bash
cd ~/my-project
opviera
```

They are prompted for a project name and an Opviera API key (`vsk_…`). On success the key is stored
in `~/.local/share/opviera/auth.json` (mode `0600`) and an `opviera.json` is written into that
project folder with the gateway URL, project id and permitted models — no credential, so it is safe
to commit.

For CI, supply the credential instead of prompting; it is validated identically:

```bash
export OPVIERA_API_KEY=vsk_…
export OPVIERA_PROJECT_ID=your-project   # required if the key's policy restricts projects
```
