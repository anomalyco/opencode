# Native Modules with Complex JavaScript Dependencies

> **Severity**: P0 - App fails to start after packaging

## Problem

When packaging a native module that has many JavaScript dependencies, the app crashes:

```
Error: Cannot find package '.../app.asar/node_modules/some-dependency/index.js'
imported from .../app.asar/node_modules/your-native-module/dist/index.js
```

The native module itself was copied, but its JavaScript dependencies were not.

## Why This Is Different from Simple Native Modules

Native modules fall into categories:

| Category              | Example                   | Dependencies  | Packaging Difficulty |
| --------------------- | ------------------------- | ------------- | -------------------- |
| Pure native           | `better-sqlite3`          | 2-3 packages  | Easy                 |
| Native + few deps     | `node-addon-api`          | 5-10 packages | Medium               |
| Native + complex deps | `node-llama-cpp`, `sharp` | 20+ packages  | Hard                 |

The solution in [native-module-packaging.md](./native-module-packaging.md) works for simple cases. Complex modules require more work.

## Root Cause

The `ignore` regex in `packagerConfig` excludes all `node_modules` except explicitly whitelisted packages:

```typescript
ignore: [/node_modules\/(?!(native-module|bindings)\/).*/];
```

This works when the native module has minimal JS dependencies. But if it depends on 20+ npm packages, you'd need to whitelist them all.

## Solutions

### Option A: Full Dependency Tree Copying

Use `npm pack` or trace dependencies programmatically:

```typescript
// forge.config.ts
import { execSync } from 'child_process';

hooks: {
  packageAfterCopy: async (_config, buildPath) => {
    // Get all dependencies of the module
    const deps = JSON.parse(
      execSync('npm ls your-native-module --json --all', { encoding: 'utf8' })
    );

    // Copy each dependency
    for (const dep of Object.keys(deps.dependencies)) {
      // Copy logic here...
    }
  },
}
```

**Pros**: Complete solution
**Cons**: Complex, slow packaging, larger bundle size

### Option B: Bundle JS Dependencies with Vite

Keep only the `.node` files external, bundle everything else:

```typescript
// vite.main.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        // Only the actual .node binary loading
        'bindings',
      ],
    },
  },
});
```

Then configure Vite to bundle the native module's JS code while keeping binary loading external.

**Pros**: Smaller bundle, fewer files to manage
**Cons**: Complex Vite configuration, may break some modules

### Option C: Lazy Loading with Fallback

Load the module dynamically and handle missing dependency gracefully:

```typescript
// src/main/services/optional-feature.ts
let nativeModule: typeof import('your-native-module') | null = null;

export async function initOptionalFeature(): Promise<boolean> {
  try {
    nativeModule = await import('your-native-module');
    return true;
  } catch (error) {
    console.warn('Optional feature unavailable:', error);
    return false;
  }
}

export function useOptionalFeature() {
  if (!nativeModule) {
    throw new Error('Feature not available - module failed to load');
  }
  return nativeModule;
}
```

**Pros**: App doesn't crash, graceful degradation
**Cons**: Feature unavailable, user confusion

### Option D: Separate Process

Run the complex native module in a separate Node.js process with its own `node_modules`:

```typescript
// src/main/services/feature-process.ts
import { fork } from 'child_process';
import path from 'path';

const featureProcess = fork(path.join(__dirname, 'feature-worker.js'), [], {
  cwd: path.join(process.resourcesPath, 'feature-runtime'),
});

featureProcess.on('message', (result) => {
  // Handle results from subprocess
});
```

**Pros**: Clean separation, can have different Node version
**Cons**: IPC overhead, more complex architecture

### Option E: Disable for Packaging (Temporary)

If the feature isn't critical, disable it to unblock releases:

```typescript
// forge.config.ts
const nativeModules = [
  'better-sqlite3', // Works fine
  // 'complex-native-module', // Disabled - see issue #123
];
```

```typescript
// src/main/services/index.ts
// export * from './complex-feature';  // Disabled until packaging fixed
```

**Pros**: Unblocks releases
**Cons**: Feature unavailable in production

## Decision Matrix

| Approach | When to Use                                             |
| -------- | ------------------------------------------------------- |
| Option A | Module is critical, you have time to implement          |
| Option B | Module's JS can be bundled, binaries are simple         |
| Option C | Feature is nice-to-have, not critical                   |
| Option D | Module needs isolation (different Node version, memory) |
| Option E | Need to ship now, fix later                             |

## Key Insight

**Test packaging early and often when adding native modules.**

Don't wait until feature completion to discover packaging issues. After adding any new native module:

1. Run `npm run package`
2. Test the packaged app
3. Fix packaging issues immediately

The longer you wait, the harder it is to remove or refactor the dependency.

## Prevention Checklist

Before adding a native module with many dependencies:

- [ ] Check the dependency count: `npm ls module-name --all | wc -l`
- [ ] If > 10 dependencies, plan the packaging strategy first
- [ ] Test packaging on a branch before merging
- [ ] Document the packaging approach for the team
