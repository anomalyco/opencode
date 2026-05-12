# Changelog

## v0.1.0 (2026-05-12)

### Breaking Changes — OpenCode → Octopus Brand Migration

Complete brand migration from OpenCode to Octopus. **This is the first Octopus-branded release.**

#### Summary

| Area | Old | New |
|------|-----|-----|
| npm scope | `@opencode-ai/*` | `@octopus-ai/*` |
| Core package | `packages/opencode/` | `packages/octopus/` |
| CLI command | `opencode` | `octopus` |
| Config directory | `.opencode/` | `.octopus/` |
| Environment variables | `OPENCODE_*` | `OCTOPUS_*` |
| API identifiers | `createOpencode()` etc. | `createOctopus()` etc. |

#### Changes (9 Issues, ~735 files)

1. **npm scope batch rename** — `@opencode-ai/*` → `@octopus-ai/*` across all 20 packages and import statements
2. **Directory rename** — `packages/opencode` → `packages/octopus` with all path references updated
3. **API identifiers** — JS/TS API function and type names updated (SDK, plugin, extensions)
4. **Environment variables & flags** — `OPENCODE_*` → `OCTOPUS_*`, flag constants renamed
5. **Config system** — `.opencode/` paths → `.octopus/`, config modules renamed
6. **Brand assets** — UI themes, CSS classes, icons updated
7. **Extensions** — VS Code and Zed extension metadata and IDs updated
8. **CI/CD & scripts** — GitHub Actions workflows, build scripts, deployment URLs updated
9. **Docs & i18n** — All documentation (~100 MDX) and 66 locale files updated

#### Migration

If upgrading from an OpenCode installation:
- Your `.opencode/` config directory needs to be migrated to `.octopus/`
- Environment variables: `OPENCODE_*` → `OCTOPUS_*` (old names still accepted as fallback)
- CLI command: `opencode` → `octopus` (alias provided)

See MIGRATION.md for detailed instructions.

#### Quality

| Gate | Result |
|------|:---:|
| oxlint | 0 errors |
| prettier | Passed |
| typecheck (14 packages) | 14/14 |
| build (9 packages) | 9/9 |
| test:ci (core) | 2588/2597 pass |
| rebrand verification | 5/5 checks |

---

[Unreleased]: https://github.com/anomalyco/opencode/compare/v0.1.0...HEAD
