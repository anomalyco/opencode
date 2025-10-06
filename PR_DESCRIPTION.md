# Fix GitHub Action Dependency Installation Issue

## Problem

The opencode GitHub Action was failing with the error:

```
bun install v1.2.23 (cf136713)
error: @types/bun@catalog: failed to resolve
```

This occurred because the `@types/bun` dependency in `github/package.json` was using the `catalog:` reference, which is a bun workspace feature that doesn't work properly in the GitHub Actions environment where there's no workspace context.

## Root Cause

The `github/package.json` file had:

```json
"devDependencies": {
  "@types/bun": "catalog:"
}
```

The `catalog:` reference works in the context of the monorepo workspace but fails when the GitHub Action is run in isolation.

## Solution

1. **Replace catalog reference with specific version**: Changed `"@types/bun": "catalog:"` to `"@types/bun": "1.2.21"` to match the version defined in the root workspace catalog.

2. **Add version input parameter**: Added an optional `version` input to the GitHub Action for users who want to pin a specific opencode version.

3. **Pass VERSION environment variable**: Modified the install step to pass the `VERSION` environment variable to the install script.

## Changes Made

- `github/package.json`: Replace `catalog:` with specific version `1.2.21`
- `github/action.yml`: Add `version` input and pass it to install script
- `github/bun.lock`: Updated to reflect the dependency change

## Testing

- ✅ Verified the fix resolves the dependency installation error
- ✅ Tested the GitHub Action with the `/oc` command in a real repository
- ✅ Confirmed the action now runs successfully and the opencode agent responds properly

## Impact

This fix ensures the opencode GitHub Action works reliably in all environments without dependency resolution failures. It's a backward-compatible change that doesn't affect existing functionality.

## Files Changed

- `github/package.json` - Fix dependency reference
- `github/action.yml` - Add version input parameter
- `github/bun.lock` - Update lockfile
