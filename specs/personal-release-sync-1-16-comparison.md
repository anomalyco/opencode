# Personal Release Sync — Upstream 1.16 Comparison

## Purpose

Compare upstream `anomalyco/opencode` release `v1.16.0` against the current `c0dn/opencode-personal` fork state before implementation.

This is a sync assessment, not the merge result.

## Release target

- Upstream latest release: `v1.16.0`
- Upstream release URL: `https://github.com/anomalyco/opencode/releases/tag/v1.16.0`
- Upstream tag commit in local git: `6cb74317a` (`release: v1.16.0`)
- Previous upstream release base: `v1.15.13`
- Current fork branch: `sync/release-1-16`
- Current fork HEAD: `85a5fc9cc` (`v1.15.13-c0dn.7`, `origin/dev`)
- Latest personal release found remotely: `v1.15.13-c0dn.7`
- No remote personal `v1.16.0-c0dn.1` release was found in the latest release list.

## Upstream 1.16 changelog themes

Upstream release notes group the 1.16 changes into:

- Core improvements: managed workspace cloning, moving sessions, Bedrock OpenAI model support, skill discovery/file-based agents, Copilot token billing, `run --replay`, startup-time improvements.
- Core bugfixes: Vue highlighting, ACP replay, shell cancellation, SAP AI Core reasoning, delegated-task reasoning variants, OpenAI websocket idle state, Windows path normalization, wide-character paste handling, ACP cancel behavior.
- TUI improvements/fixes: experimental session switcher, long sidebar path truncation, variant toast, question response routing, background task spinner.
- Desktop/app improvements/fixes: color themes, local server startup failure surfacing, thinking-level selector, Servers tab, update button, session review/VCS diff refresh, tab title/close polish, project sessions before path sync.
- SDK: session location data in v2 responses.
- Extension: GitHub action refuses commits without an existing git author identity.

## Scale of upstream delta

The upstream delta from `v1.15.13` to `v1.16.0` is large and interdependent:

- `1230` files changed in the upstream release diff.
- Broad areas touched include core session/event/storage/runtime, app/desktop UI, SDK/OpenAPI generation, server package extraction, LLM/provider plumbing, TUI, workflows, stats, and package dependencies.
- The release includes many generated commits (`chore: generate`) tied to schema/API/package changes.

Because of that scale, manually reimplementing release-note items is not a good route. The implementation should use upstream commit content as the source of truth: preferably merge the release tag, or cherry-pick the upstream commits in release order if a merge is not acceptable. Reimplementation should be limited to conflict resolutions where the personal fork intentionally diverges.

## Hotspot file comparison

### `packages/opencode/src/installation/index.ts`

Upstream 1.16 changes:

- Migrates installation events from `BusEvent` to `EventV2`.
- Adds package-manager-specific latest-version lookup for npm/bun/pnpm/brew/choco/scoop.
- Adds package-manager upgrade commands.
- Adds curl upgrade fallback from `bash` to `sh` when bash is unavailable.

Fork current state:

- Already has the `EventV2` migration.
- Intentionally hard-codes latest-version checks to `c0dn/opencode-personal` GitHub Releases.
- Intentionally blocks package-manager upgrades for personal builds.
- Still runs curl installer with `bash` only.

Assessment:

- **Already present:** `EventV2` migration.
- **Cherry-pick/reapply:** curl upgrade `bash` → `sh` fallback.
- **Do not take as-is:** package-manager latest/upgrade behavior; it conflicts with the personal-release policy.
- **Resolution shape:** keep `repo = "c0dn/opencode-personal"`, keep fork installer URL, keep blocked package-manager upgrade policy, add only the upstream shell fallback and matching tests.

### `packages/opencode/test/installation/installation.test.ts`

Upstream 1.16 changes:

- Adds tests for package-manager latest lookups and upgrade commands.
- Adds test for `sh` fallback when bash is unavailable during curl upgrade.

Fork current state:

- Tests personal GitHub Release latest lookup.
- Tests package-manager upgrades are blocked.
- Tests curl upgrades fetch the fork installer.
- Tests upgrade failure output is sanitized.

Assessment:

- **Cherry-pick/reapply:** `sh` fallback test.
- **Preserve fork tests:** personal repo lookup, blocked package-manager upgrades, fork installer URL.
- **Do not take as-is:** package-manager upgrade/latest test expectations.

### `install`

Upstream 1.16 did not materially change `install` from `v1.15.13`; differences against the fork are the standing personal patch:

- fork raw install URL instead of `https://opencode.ai/install`
- fork GitHub Releases repo instead of `anomalyco/opencode`
- Linux-only support instead of upstream multi-platform support
- explicit musl and non-AVX2 x64 rejection because personal artifacts are Linux glibc x64/arm64 only

Assessment:

- **Keep fork version.** No 1.16-specific installer improvement needs reimplementation here unless later conflict resolution exposes a new upstream installer change.

### `packages/opencode/script/build.ts`

Upstream 1.16 changes:

- Removes embedded migration define, consistent with storage/runtime refactors.
- Adds `process.env.OPENTUI_LIBC` define for Linux builds.
- Adds `libc` metadata to package JSON for ABI-specific packages.
- Keeps broad target matrix and release upload glob.

Fork current state:

- Already no longer embeds migrations.
- Adds `OPENCODE_BUILD_TARGETS` filtering to limit personal release builds to `linux-x64,linux-arm64`.
- Adds an asset-list guard so release upload only uploads generated artifacts.

Assessment:

- **Already present:** migration removal.
- **Cherry-pick/reapply:** `process.env.OPENTUI_LIBC` define and `libc` package metadata.
- **Preserve fork behavior:** `OPENCODE_BUILD_TARGETS` filtering and guarded asset upload.

### `packages/core/src/installation/version.ts`

Upstream 1.16 removes `normalizeInstallationDependencyVersion()` and `InstallationDependencyVersion`.

Fork current state uses this normalizer so personal versions like `1.15.13-c0dn.7` still resolve plugin dependencies against upstream semver core versions like `1.15.13`.

Assessment:

- **Preserve fork behavior.** Do not accept upstream deletion unless all plugin dependency call sites have moved away from `InstallationDependencyVersion` or another equivalent normalizer exists after the merge.

### GitHub workflows

Upstream 1.16 adds or modifies many upstream-owned workflows, including official publish/deploy/docs/review/triage workflows and a larger test workflow.

Fork current state intentionally has a curated workflow set:

- `.github/workflows/personal-release.yml`
- `.github/workflows/sync-upstream.yml`
- `.github/workflows/test.yml`
- `.github/workflows/typecheck.yml`

Assessment:

- **Preserve personal release workflows.** They are fork-specific and should not be replaced by upstream official release automation.
- **Do not blindly import upstream workflow zoo.** Added upstream workflows can run unexpectedly on the personal fork or require unavailable secrets/runners.
- **Review only test/typecheck updates.** Upstream `test.yml` adds Windows/e2e matrix on Blacksmith runners; that may not be appropriate for this fork unless the runner/secrets setup exists.
- **Conflict expectation:** `publish.yml` is a modify/delete conflict; choose deletion unless William wants upstream official publishing workflows restored.

## Merge/conflict preview

`git merge-tree --write-tree --name-only HEAD v1.16.0` predicts a non-trivial merge with conflicts across about fifty files.

Conflict clusters:

- Workflow/admin: `.github/workflows/publish.yml`, `AGENTS.md`.
- App/desktop UI: session header, settings v2, titlebar, layout, home/session pages, composer region, UI theme files.
- Core/session/event/storage: database migration generation, event/session/project/message projector files, session SQL and message updater.
- OpenCode runtime/server: ACP service, background jobs, MCP command, TUI sync, permission, HTTP API project/session/server handlers, compaction, processor, prompt, task/tool.
- Tests/generated SDK: config tests, session/processor/tool tests, HTTP API exerciser tests, SDK generated files, OpenAPI-derived outputs.

This confirms the sync is not a small release-channel-only change. Most conflicts are caused by earlier personal feature patches overlapping upstream 1.16 work, especially app/v2 UI and session/runtime changes.

## Already present or partially present upstream work

The personal fork has already ported or independently implemented some upstream-adjacent work:

- Installation `EventV2` migration is already present.
- Several v2 app/desktop UX changes are present or partially present through personal commits around mobile/session tabs, titlebar tabs, todo dock behavior, prompt queue, Servers tab, and home project list polish.
- Some safe upstream TUI/session fixes were already ported in `v1.15.13-c0dn.6` according to `CHANGELOG.personal.md`.
- Plugin dependency version normalization is intentionally personal and should survive 1.16.

These areas need conflict-aware reconciliation rather than blindly taking one side.

## Recommended sync strategy

1. Use upstream `v1.16.0` as the source of truth for upstream features and fixes.
2. Prefer a release-tag merge over manual reimplementation because the release is large, generated, and internally coupled. If commit-level control is required, cherry-pick upstream commits in release order and compare the final tree against `v1.16.0` for unexpected omissions.
3. Treat generated SDK/OpenAPI outputs as derived artifacts: resolve source/API/server conflicts first, then regenerate rather than hand-merge generated files.
4. Preserve the personal release-channel patch stack:
   - fork installer URL and GitHub Release repo
   - package-manager upgrade blocking
   - Linux-only release artifact policy
   - `OPENCODE_BUILD_TARGETS`
   - personal release/sync workflows
   - personal prerelease dependency-version normalization
5. Reapply only the upstream changes that conflict with those fork policies:
   - curl updater `bash` → `sh` fallback
   - build script `OPENTUI_LIBC` and `libc` package metadata
   - compatible test updates for the two items above
6. For app/session/runtime/storage conflicts, resolve against upstream 1.16 as baseline, then reapply personal UX/regression fixes only where upstream does not already cover them. Stateful surfaces need explicit migration/replay validation, not only typecheck.
7. Apply a workflow allowlist. Keep fork-specific workflows and review only useful validation workflow changes; do not import upstream official release/deploy/docs/review/triage workflow files without explicit approval.
8. Fix release automation atomicity if implementation touches workflows: build personal releases from the validated merge SHA, and make release skip/creation asset-aware so failed draft releases do not block later sync attempts.

## Critic findings folded into the handoff

Architecture critique verdict: **revise, not blocked**. The strategy is usable after these guardrails are included:

- **State/session/runtime validation is mandatory.** The predicted conflicts include database migrations, event/session/project/message projectors, SQL, server handlers, background jobs, and API surfaces. A clean merge/typecheck can still break existing session databases, replay, queued follow-ups, undo/revert, project routing, or session movement.
- **Release mirroring should be pinned.** Current `sync-upstream.yml` pushes `HEAD:dev`, then calls `personal-release.yml` with `ref: dev`; `dev` can move between validation and release checkout. The implementation should pass the validated merge SHA to the release workflow if workflow changes are in scope.
- **Release creation should be asset-aware.** Current gate skips when `gh release view "$personal_tag"` succeeds. A failed draft or tag without expected assets can cause future syncs to skip. The gate should check for a published release with expected Linux assets, or cleanup failed drafts/tags.
- **Workflow imports need explicit allowlisting.** Upstream 1.16 brings many workflows that are not part of this fork's release model and may require unavailable runners/secrets.
- **Build smoke must validate artifacts, not just binaries.** A no-upload build without `OPENCODE_RELEASE` does not prove tarballs, archive names, `OPENCODE_BUILD_TARGETS`, or installer contracts. Prefer adding a release dry-run/skip-upload path if release packaging must be validated locally.
- **Generated outputs should not be hand-merged.** Resolve source/API conflicts first, then run the repository's SDK generation flow.
- **Personal version normalization should be narrowed.** The current normalizer strips all semver prerelease/build metadata; the intended policy is likely only `-c0dn.N` stripping for plugin dependency compatibility.

## Validation focus after implementation

Minimum targeted checks:

```bash
bun --cwd packages/opencode typecheck
bun --cwd packages/opencode test test/installation/installation.test.ts
```

Because upstream 1.16 changes generated SDK/OpenAPI/session/runtime surfaces, broader checks will likely be needed before release:

```bash
bun typecheck
bun turbo test:ci
bun --cwd packages/opencode run test:httpapi
```

Also run a no-upload build smoke for personal artifacts:

```bash
OPENCODE_VERSION=1.16.0-c0dn.0 \
OPENCODE_BUILD_TARGETS=linux-x64,linux-arm64 \
bun ./packages/opencode/script/build.ts --skip-embed-web-ui
```

If release packaging behavior is modified, add or use a release dry-run mode that validates exactly:

- `opencode-linux-x64.tar.gz`
- `opencode-linux-arm64.tar.gz`
- binary `--version` output inside each archive
- package metadata, including Linux `libc` metadata where applicable
- installer asset-name compatibility

Stateful/runtime smoke checks should include:

- loading/listing an existing 1.15.13-era session database if a fixture is available
- opening and replaying a saved session
- queued follow-up prompt behavior
- undo/revert/compact paths affected by the previous personal revert
- moving sessions/workspaces from the 1.16 release notes
- HTTP API session/project endpoints after SDK/OpenAPI regeneration

## Open decisions

- Should the implementation use a tag merge (`git merge v1.16.0`) or sequential cherry-picks? Architecture recommendation is tag merge, with cherry-picks only as fallback.
- Should upstream `test.yml` Windows/e2e/Blacksmith expansion be adopted, adapted to Ubuntu-only, or skipped for this personal fork?
- Should any upstream-added workflows beyond test/typecheck be allowed in the fork? Default recommendation is no.
- For OpenAI websocket/session-runtime conflicts, should upstream 1.16 be treated as superseding the personal revert, or should the personal revert constraints be reapplied after merge and tested against queued follow-up/undo flows?
- Should release workflow atomicity fixes be included in this sync, or deferred to a follow-up release-channel hardening change?
