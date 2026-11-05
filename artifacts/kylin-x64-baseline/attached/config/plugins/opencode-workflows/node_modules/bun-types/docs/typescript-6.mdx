---
title: TypeScript 6 and 7
description: "How to configure Bun's type definitions for TypeScript 6.0 and 7.0, which no longer auto-discover @types packages. Fix 'Cannot find name Bun' and other missing type errors after upgrading TypeScript."
---

TypeScript 6.0 changed how type definitions are discovered. If you've upgraded TypeScript and your editor no longer recognizes `Bun`, `Request`, or other globals from `@types/bun`, here's how to fix it.

## What changed

Starting in TypeScript 6.0, the `types` field in `compilerOptions` defaults to an empty array instead of including all `@types/*` packages. You now need to explicitly list the type packages you use.

## Add `"types": ["bun"]` to your tsconfig

In your `tsconfig.json`, add `"types": ["bun"]` to `compilerOptions`:

```jsonc tsconfig.json icon="file-json"
{
  "compilerOptions": {
    "types": ["bun"], // [!code ++]
  },
}
```

This tells TypeScript to load type definitions from `@types/bun`. If you use other `@types/*` packages, include them too:

```jsonc tsconfig.json icon="file-json"
{
  "compilerOptions": {
    "types": ["bun", "react"],
  },
}
```

You still need `@types/bun` installed — the `types` option tells TypeScript _which_ packages to include, but the package itself must exist in `node_modules`:

```sh terminal icon="terminal"
bun add -d @types/bun
```

## Full recommended tsconfig.json

Here's the full recommended `tsconfig.json` for a Bun project using TypeScript 6.0 or later:

```jsonc tsconfig.json icon="file-json"
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "types": ["bun"],

    // Bundler mode
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Some stricter flags (disabled by default)
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false,
  },
}
```

## Does this apply to TypeScript 7?

Yes. TypeScript 7 carries forward the same default. If you're upgrading directly from TypeScript 5 to 7, the same fix applies — add `"types": ["bun"]` to your `compilerOptions`.
