# Build Issue - IMPORTANT

## Problem
The built `dist/index.js` file cannot be imported due to a `jsxDEV` import error from `@opentui/solid/jsx-dev-runtime`.

```
Error: Export named 'jsxDEV' not found in module '@opentui/solid/jsx-runtime.d.ts'
```

## Root Cause
When building with Bun, the JSX transform creates imports for `jsxDEV` which don't exist in the `@opentui/solid` package. Even with proper externals configuration in `build.ts` and `bunfig.toml`, the built file still contains problematic JSX runtime imports.

## Solution
**Load the source `.tsx` file directly instead of the built `.js` file.**

In `opencode.json`:
```json
{
  "plugin": [
    "file:///path/to/plugin-steering-questions/index.tsx"  // ✅ WORKS
    // NOT: "file:///path/to/plugin-steering-questions/dist/index.js"  ❌ FAILS
  ]
}
```

## Why This Works
- Bun can import and execute `.tsx` files directly at runtime
- The JSX transform happens at runtime with correct resolution
- This is how all other plugins (sidebar, etc.) are loaded

## Build Configuration
The `build.ts` and `bunfig.toml` are configured correctly for production builds, but until the jsxDEV import issue is resolved, use the source file.

### Files:
- `bunfig.toml` - Sets JSX runtime to solid-js
- `build.ts` - Externals match sidebar plugin pattern
- Both are needed for future production builds

## Verification
Test plugin loading:
```bash
bun -e "import('./index.tsx').then(m => console.log('✅ Works:', Object.keys(m)))"
bun -e "import('./dist/index.js').then(m => console.log('✅ Works')).catch(e => console.log('❌ Fails:', e.message))"
```

## For Production
If you need a built version for production:
1. Investigate why jsxDEV import isn't being resolved
2. Consider bundling solid-js entirely (removes externals)
3. Or switch to a different build tool that handles JSX better
4. Current workaround: ship source .tsx files with the package
