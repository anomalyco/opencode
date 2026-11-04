---
title: Transpiler
description: Use Bun's transpiler to transpile JavaScript and TypeScript code
---

Bun exposes its internal transpiler via the `Bun.Transpiler` class. To create an instance of Bun's transpiler:

```ts
const transpiler = new Bun.Transpiler({
  loader: "tsx", // "js" | "jsx" | "ts" | "tsx"
});
```

---

## `.transformSync()`

Transpile code synchronously with the `.transformSync()` method. Modules are not resolved and the code is not executed. The result is a string of vanilla JavaScript code.

<CodeGroup>
```ts transpile.ts icon="/icons/typescript.svg" 
const transpiler = new Bun.Transpiler({
  loader: 'tsx',
});

const code = `
import * as whatever from "./whatever.ts"
export function Home(props: {title: string}){
  return <p>{props.title}</p>;
}`;

const result = transpiler.transformSync(code);

````

```ts output
import { __require as require } from "bun:wrap";
import * as JSX from "react/jsx-dev-runtime";
var jsx = require(JSX).jsxDEV;

export default jsx(
  "div",
  {
    children: "hi!",
  },
  undefined,
  false,
  undefined,
  this,
);
````

</CodeGroup>

To override the default loader specified in the `new Bun.Transpiler()` constructor, pass a second argument to `.transformSync()`.

```ts
transpiler.transformSync("<div>hi!</div>", "tsx");
```

<Accordion title="Nitty gritty">

When `.transformSync` is called, the transpiler is run in the same thread as the currently executed code.

If a macro is used, it will be run in the same thread as the transpiler, but in a separate event loop from the rest of your application. Currently, globals between macros and regular code are shared, which means it is possible (but not recommended) to share states between macros and regular code. Attempting to use AST nodes outside of a macro is undefined behavior.

</Accordion>

---

## `.transform()`

The `transform()` method is an async version of `.transformSync()` that returns a `Promise<string>`.

```js
const transpiler = new Bun.Transpiler({ loader: "jsx" });
const result = await transpiler.transform("<div>hi!</div>");
console.log(result);
```

Unless you're transpiling _many_ large files, you should probably use `Bun.Transpiler.transformSync`. The cost of the threadpool will often take longer than actually transpiling code.

```ts
await transpiler.transform("<div>hi!</div>", "tsx");
```

<Accordion title="Nitty gritty">

The `.transform()` method runs the transpiler in Bun's worker threadpool, so if you run it 100 times, it will run it across `Math.floor($cpu_count * 0.8)` threads, without blocking the main JavaScript thread.

If your code uses a macro, it will potentially spawn a new copy of Bun's JavaScript runtime environment in that new thread.

</Accordion>

## `.scan()`

The `Transpiler` instance can also scan some source code and return a list of its imports and exports, plus additional metadata about each one. [Type-only](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#type-only-imports-and-export) imports and exports are ignored.

<CodeGroup>

```ts example.ts icon="/icons/typescript.svg"
const transpiler = new Bun.Transpiler({
  loader: "tsx",
});

const code = `
import React from 'react';
import type {ReactNode} from 'react';
const val = require('./cjs.js')
import('./loader');

export const name = "hello";
`;

const result = transpiler.scan(code);
```

```json output
{
  "exports": ["name"],
  "imports": [
    {
      "kind": "import-statement",
      "path": "react"
    },
    {
      "kind": "import-statement",
      "path": "remix"
    },
    {
      "kind": "dynamic-import",
      "path": "./loader"
    }
  ]
}
```

</CodeGroup>

Each import in the `imports` array has a `path` and `kind`. Bun categories imports into the following kinds:

- `import-statement`: `import React from 'react'`
- `require-call`: `const val = require('./cjs.js')`
- `require-resolve`: `require.resolve('./cjs.js')`
- `dynamic-import`: `import('./loader')`
- `import-rule`: `@import 'foo.css'`
- `url-token`: `url('./foo.png')`

---

## `.scanImports()`

For performance-sensitive code, you can use the `.scanImports()` method to get a list of imports. It's faster than `.scan()` (especially for large files) but marginally less accurate due to some performance optimizations.

<CodeGroup>

```ts example.ts icon="/icons/typescript.svg"
const transpiler = new Bun.Transpiler({
  loader: "tsx",
});

const code = `
import React from 'react';
import type {ReactNode} from 'react';
const val = require('./cjs.js')
import('./loader');

export const name = "hello";
`;

const result = transpiler.scanImports(code);
```

```json results icon="file-json"
[
  {
    "kind": "import-statement",
    "path": "react"
  },
  {
    "kind": "require-call",
    "path": "./cjs.js"
  },
  {
    "kind": "dynamic-import",
    "path": "./loader"
  }
]
```

</CodeGroup>

---

## Reference

```ts See Typescript Definitions expandable
type Loader = "jsx" | "js" | "ts" | "tsx";

interface TranspilerOptions {
  // Replace key with value. Value must be a JSON string.
  // { "process.env.NODE_ENV": "\"production\"" }
  define?: Record<string, string>,

  // Default loader for this transpiler
  loader?: Loader,

  // Default platform to target
  // This affects how import and/or require is used
  target?: "browser" | "bun" | "node",

  // Specify a tsconfig.json file as stringified JSON or an object
  // Use this to set a custom JSX factory, fragment, or import source
  // For example, if you want to use Preact instead of React. Or if you want to use Emotion.
  tsconfig?: string | TSConfig,

  // Replace imports with macros
  macro?: MacroMap,

  // Specify a set of exports to eliminate
  // Or rename certain exports
  exports?: {
      eliminate?: string[];
      replace?: Record<string, string>;
  },

  // Whether to remove unused imports from transpiled file
  // Default: false
  trimUnusedImports?: boolean,

  // Whether to enable a set of JSX optimizations
  // jsxOptimizationInline ...,

  // Experimental whitespace minification
  minifyWhitespace?: boolean,

  // Whether to inline constant values
  // Typically improves performance and decreases bundle size
  // Default: true
  inline?: boolean,
}

// Map import paths to macros
interface MacroMap {
  // {
  //   "react-relay": {
  //     "graphql": "bun-macro-relay/bun-macro-relay.tsx"
  //   }
  // }
  [packagePath: string]: {
    [importItemName: string]: string,
  },
}

class Bun.Transpiler {
  constructor(options: TranspilerOptions)

  transform(code: string, loader?: Loader): Promise<string>
  transformSync(code: string, loader?: Loader): string

  scan(code: string): {exports: string[], imports: Import}
  scanImports(code: string): Import[]
}

type Import = {
  path: string,
  kind:
  // import foo from 'bar'; in JavaScript
  | "import-statement"
  // require("foo") in JavaScript
  | "require-call"
  // require.resolve("foo") in JavaScript
  | "require-resolve"
  // Dynamic import() in JavaScript
  | "dynamic-import"
  // @import() in CSS
  | "import-rule"
  // url() in CSS
  | "url-token"
  // The import was injected by Bun
  | "internal"
  // Entry point (not common)
  | "entry-point-build"
  | "entry-point-run"
}

const transpiler = new Bun.Transpiler({ loader: "jsx" });
```
