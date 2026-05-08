<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Resolving Installer Wildcard Failures

**Purpose**: Capture the root cause, fix, and lessons from wildcard context install failures.

**Last Updated**: 2026-01-12

---

## Prerequisites
- Installer changes scoped to `install.sh`
- Registry entries validated (`./scripts/registry/validate-registry.sh`)

**Estimated time**: 10 min

## Steps

### 1. Identify the failure mode
**Symptom**:
```
curl: (3) URL rejected: Malformed input to a URL function
```
**Cause**: Wildcard expansion returned context IDs that weren’t path-aligned (e.g., `standards-code` mapped to `/Users/apple/.config/opencode/context/core/standards/code-quality.md`). Installer treated IDs as paths.

### 2. Expand wildcards to path-based IDs
**Goal**: Make wildcard expansion output `core/...` IDs that map directly to a path.

**Update**:
- Expand `context:core/*` to `core/standards/code-quality` style IDs

### 3. Resolve context paths deterministically
**Goal**: Avoid ambiguous matches and ensure one registry entry is used.

**Update**:
- Add `resolve_component_path` to map context IDs to the registry path
- Use `first(...)` in jq queries for deterministic selection

### 4. Verify installation
```bash
bash scripts/tests/test-e2e-install.sh
```
**Expected**: All E2E tests pass on macOS and Ubuntu.

## Verification
```bash
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
```

## Troubleshooting
| Issue | Solution |
|-------|----------|
| `Malformed input to a URL function` | Ensure wildcard expansion returns `core/...` IDs and uses `resolve_component_path` |
| Multiple context entries for one path | Use `first(...)` in jq lookups |

## Related
- guides/debugging.md
- guides/updating-registry.md
- core-concepts/registry.md
