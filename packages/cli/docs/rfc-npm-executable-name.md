# RFC: The `.exe` name of the npm-installed CLI on Unix

Status: Proposed decision record (2026-09-28)

## Problem

A Linux user can run `opencode` and see `opencode.exe` in a process list. That looks like a Windows program, even though the running file is a native Linux ELF executable. The suffix is a pathname chosen by our npm packaging, not the executable format or a compatibility layer.

This RFC records a deliberate *non-change*: why that pathname exists and the cost of changing it. It does not propose changing the binary in this PR.

## How it works today

- The published `@opencode/cli` package has a single `bin` target, `./bin/opencode.exe`, for Linux, macOS, and Windows. The same target also serves the `opencode2` command. See [`script/publish.ts`](../script/publish.ts).
- Each platform-specific package contains a native binary: `opencode` on Linux/macOS and `opencode.exe` on Windows. The generic package's [`postinstall.mjs`](../script/postinstall.mjs) selects the appropriate optional dependency and hard-links or copies its binary to that *same* `bin` target. Therefore, on Unix, a native executable ends up at a pathname ending in `.exe`.
- The direct [install script](../../../install) and release archives keep the Unix executable named `opencode`. This is specific to the generic npm package; the public command users type remains `opencode`.

The constraint is the combination of **one cross-platform npm package, one static `bin` target, and direct execution of the native binary without a launcher**. Windows needs an executable target there, while the generic package cannot select a different `bin` path per OS at install time. Choosing `opencode.exe` lets the Windows target be a real executable and lets npm expose the same command everywhere. Unix permits an ELF or Mach-O file to have that suffix, but process tools can then display it.

The package also ships a text placeholder at the target path until postinstall replaces it. A skipped postinstall is a *separate functional install problem*; removing the misleading Unix suffix alone would not resolve that failure mode.

## Other npm CLIs

These are different choices, checked against their published npm packages on 2026-09-28:

- [Pi (`@earendil-works/pi-coding-agent@0.87.1`)](https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/0.87.1) maps `pi` to a JavaScript entrypoint, `dist/bundle/cli.js`, run with Node. It is not trying to expose one direct native binary through npm.
- [Codex (`@openai/codex@0.158.0`)](https://registry.npmjs.org/%40openai%2Fcodex/0.158.0) maps `codex` to `bin/codex.js`. That Node launcher selects `codex` on Unix or `codex.exe` on Windows from a platform package, spawns it, and handles signals and exit status. This avoids a `.exe`-named Unix process at the cost of a launcher process.
- [Claude Code (`@anthropic-ai/claude-code@2.1.283`)](https://registry.npmjs.org/%40anthropic-ai%2Fclaude-code/2.1.283) makes the same direct-execution choice as OpenCode: its npm `bin` is `bin/claude.exe` on all platforms, with postinstall replacing the placeholder with the native binary. Unix users can see `.exe` in the pathname there too.
- [esbuild (`esbuild@0.28.2`)](https://registry.npmjs.org/esbuild/0.28.2) uses an extensionless JavaScript `bin/esbuild` that locates the native binary. Its postinstall *sometimes* replaces that entrypoint with a Unix native binary for direct execution; Windows keeps the launcher. This avoids the Unix suffix and often the extra Unix process, but adds platform- and package-manager-dependent behavior and still needs a Windows launcher.

## Options

1. **Keep the direct native target (recommended for now).** No new process, signal forwarding, runtime dependency at launch, or install-path migration. Cost: Unix process lists can say `opencode.exe`, which is confusing. Explain the packaging trade-off when asked.
2. **Use a platform-aware launcher as the npm `bin` target.** It could select `opencode` on Unix and `opencode.exe` on Windows from the platform-specific package, so the child process has its native filename. Cost: an additional process or platform-specific `exec` behavior, startup work, signal and exit-code forwarding, and a larger test surface across package managers. A launcher already exists for development in [`bin/opencode.cjs`](../bin/opencode.cjs); using one in release packaging would be a deliberate change to today's direct-execution behavior, not a rename.
3. **Use an esbuild-style hybrid launcher.** Publish a suffix-free JavaScript entrypoint; replace it with the native executable on Unix where safe, but keep the launcher on Windows and as a fallback. This improves the Unix process name and often avoids a second Unix process, but complicates postinstall, upgrades, cross-platform startup, and script-disabled behavior. It still crosses the no-launcher boundary on Windows.
4. **Publish different top-level packages or mutate package-manager links per OS.** This can give Unix a suffix-free target without a launcher, but loses the simple single-package install or makes startup depend on nonportable install/link behavior. Do not assume rewriting `package.json` in postinstall will reliably relink a previously created command.
5. **Change the displayed process title.** This might cosmetically affect some monitors, but leaves the actual filename and packaging contract unchanged. It is not a fix for the underlying discrepancy.

## Proposal and decision boundary

**Proposed decision: do not add a launcher or rename the npm target just to change the process-list label.** Keep the existing packaging until the name causes enough user confusion to justify a packaging change, or a broader install/reliability redesign makes the launcher cost worthwhile. Treat a skipped-postinstall/broken-upgrade fix on its own merits rather than claiming the filename change fixes it. This RFC is a record for review, not approval or implementation of a launcher.

If we choose an alternative, prove it against the current behavior before release: native binary format and process name on Linux and macOS; `.exe` startup on Windows; npm, Bun, pnpm, and Yarn installs; blocked or skipped install scripts; upgrades; exit codes and signals; and both `opencode` and the legacy `opencode2` command. Keep direct-install and archive filenames unchanged unless there is a separate reason to alter them.
