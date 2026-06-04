# Native Module Packaging with Electron Forge + Vite

> **Severity**: P0 - App fails to start after packaging

## Problem

After packaging with Electron Forge + Vite, the app crashes immediately:

```
Error: Cannot find module 'better-sqlite3'
Require stack:
- /path/to/app.asar/.vite/build/main.js
```

Development (`npm start`) works fine, but packaged app (`npm run package`) fails.

## Common Native Modules Affected

- `better-sqlite3`
- `sqlite3`
- `sharp`
- `node-canvas`
- `serialport`
- Any module containing `.node` binary files

## Initial Attempts (All Failed)

### 1. Mark as external in Vite config

```typescript
// vite.main.config.ts
external: ['better-sqlite3'];
```

**Why it fails**: This only tells Vite not to bundle the module. The packaged `main.js` generates `require('better-sqlite3')`, but Forge doesn't copy `node_modules` to the output.

### 2. Configure asar.unpack

```typescript
asar: {
  unpack: '**/{*.node,better-sqlite3/**/*}',
}
```

**Why it fails**: `asar.unpack` only extracts files that are already in the asar. If the module wasn't copied in the first place, there's nothing to extract.

### 3. Use AutoUnpackNativesPlugin

```typescript
plugins: [new AutoUnpackNativesPlugin({})];
```

**Why it fails**: Same reason - it unpacks `.node` files, but the module must exist in the asar first.

### 4. Disable OnlyLoadAppFromAsar

```typescript
[FuseV1Options.OnlyLoadAppFromAsar]: false
```

**Why it fails**: Necessary but not sufficient. Allows loading from unpacked directory, but doesn't solve the missing module problem.

## Root Cause

Vite's `external` config and Electron Forge's packaging are **two independent processes**:

```
Vite external: "Don't bundle this module, use require() at runtime"
                    |
              generates require('better-sqlite3')
                    |
Forge package: "By default, don't copy node_modules, only bundle source"
                    |
              Module not found at runtime!
```

## Solution

Configure `forge.config.ts` to explicitly copy native modules:

```typescript
import path from 'path';
import { cp, mkdir } from 'fs/promises';
import type { ForgeConfig } from '@electron-forge/shared-types';

// List all native modules and their dependencies
const nativeModules = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '*.{node,dll}',
    },
    // Whitelist native modules in ignore pattern
    ignore: [/node_modules\/(?!(better-sqlite3|bindings|file-uri-to-path)\/).*/],
  },
  rebuildConfig: {
    force: true,
  },
  hooks: {
    // Explicitly copy native modules after packaging
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const sourceNodeModulesPath = path.resolve(__dirname, 'node_modules');
      const destNodeModulesPath = path.resolve(buildPath, 'node_modules');

      await Promise.all(
        nativeModules.map(async (packageName) => {
          const sourcePath = path.join(sourceNodeModulesPath, packageName);
          const destPath = path.join(destNodeModulesPath, packageName);
          await mkdir(path.dirname(destPath), { recursive: true });
          await cp(sourcePath, destPath, {
            recursive: true,
            preserveTimestamps: true,
          });
        })
      );
    },
  },
};

export default config;
```

## Why This Works

1. **`ignore` with negative lookahead**: Excludes all `node_modules` EXCEPT the whitelisted packages. These modules get copied to the output.

2. **`packageAfterCopy` hook**: As a safety net, explicitly copies modules to `buildPath/node_modules/`. Even if the ignore pattern has issues, the hook ensures modules exist.

3. **`asar.unpack: '*.{node,dll}'`**: Extracts native binary files from asar. `.node` files cannot be loaded from inside an asar archive.

4. **`rebuildConfig.force: true`**: Ensures native modules are rebuilt for the current Electron version. Prevents NODE_MODULE_VERSION mismatch errors.

## Key Insight

**Two separate concerns**:

| Concern   | Tool  | What it does                            |
| --------- | ----- | --------------------------------------- |
| Bundling  | Vite  | Decides what to bundle vs require()     |
| Packaging | Forge | Decides what files to include in output |

You must configure BOTH:

1. Tell Vite: "Don't bundle this, use require()"
2. Tell Forge: "Include this module in the package"

## Dependency Chain

Native modules often have their own dependencies. For `better-sqlite3`:

```
better-sqlite3
├── bindings (loads .node files)
└── file-uri-to-path (dependency of bindings)
```

**Always check `node_modules/{package}/package.json` for dependencies and include them all.**

## Verification

After packaging, check the output:

```bash
# macOS
ls -la "out/YourApp-darwin-x64/YourApp.app/Contents/Resources/app.asar.unpacked/"

# Windows
dir "out\YourApp-win32-x64\resources\app.asar.unpacked\"

# Should see your .node files extracted
```

## References

- [Electron Forge: Auto Unpack Natives Plugin](https://www.electronforge.io/config/plugins/auto-unpack-natives)
- [Stack Overflow: Cannot find module 'better-sqlite3' after building](https://stackoverflow.com/questions/79544832/cannot-find-module-better-sqlite3-after-building-electron-forge-vite-app-on-l)
