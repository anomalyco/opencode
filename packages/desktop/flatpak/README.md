# OpenCode Desktop Flatpak

Flatpak packaging for the OpenCode desktop app (Electron), using the standard
`flatpak-builder` + Electron BaseApp approach described in
[Building an Electron app as a Flatpak](https://docs.flatpak.org/en/latest/electron.html).

- App ID: `ai.opencode.desktop`
- Runtime: `org.freedesktop.Platform` `24.08`
- Base: `org.electronjs.Electron2.BaseApp` `24.08` (Chromium/Electron shared libs)
- Building is done offline; Bun, Electron, and `node_modules` are vendored up
  front (see `vendor.sh`) because Bun has no flatpak-node generator.

## Why host access

OpenCode is a coding agent that runs the user's own shell and toolchain (git,
node, compilers, package managers, container runtimes) inside an arbitrary
project directory. A Flatpak sandbox has none of that, so the desktop manifest
grants:

- `--share=network` — the agent talks to model providers.
- `--filesystem=host` — project files live on the host.
- `--talk-name=org.freedesktop.Flatpak` — lets the app run host commands via
  `flatpak-spawn --host`.
- `--env=OPENCODE_FLATPAK_HOST=1` — opts into routing agent-spawned processes to
  the host (see `packages/core/src/flatpak.ts`). Non-Flatpak builds/tests are
  unaffected.

The in-app updater is disabled inside the sandbox (`UPDATER_ENABLED` checks
`FLATPAK_ID`), since Flatpak owns updates.

## Build

Prerequisites: `flatpak`, `flatpak-builder`, the Freedesktop runtime/SDK, and the
Electron BaseApp. Install them with:

```bash
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 \
  org.freedesktop.Sdk.Extension.node22//24.08 org.electronjs.Electron2.BaseApp//24.08
```

Vendor the sources (networked machine, Bun >= 1.3 installed):

```bash
cd packages/desktop/flatpak
./vendor.sh
```

Build and install:

```bash
cd packages/desktop/flatpak
flatpak-builder --user --install-deps-from=flathub --force-clean \
  --repo=repo builddir ai.opencode.desktop.yml
flatpak run ai.opencode.desktop
```

For experimental native Wayland, run with `flatpak run --socket=wayland
ai.opencode.desktop`.

## Known limitations (verify on-device)

- **Process-tree teardown:** host commands run through `flatpak-spawn` are a
  separate PID namespace from the sandbox, so `killGroup`/proc-group signals
  may not reach the host descendant tree.
- **`cwd` mapping** relies on `--filesystem=host` making sandbox and host paths
  identical; a project path opened in the sandbox is addressed by the same
  absolute path on the host.
- **`$HOME`** inside the sandbox is `~/.var/app/ai.opencode.desktop`; the app
  `chdir`s to the host home via `flatpak-spawn` where needed.

## Notes for a future Flathub submission

Flathub requires every source to be a pinned `url` + `sha256` (no local
`file`/`archive` `path` sources) and a stricter sandbox-permission review. To get
there, the `vendor.sh` artifacts (Bun binary, Electron dist, and the node_modules
source tarball) must be published to a release endpoint and referenced by URL
with hashes in the manifest.