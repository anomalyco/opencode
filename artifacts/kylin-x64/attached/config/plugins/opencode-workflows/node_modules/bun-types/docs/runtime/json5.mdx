---
title: JSON5
description: Use Bun's built-in support for JSON5 files through both runtime APIs and bundler integration
---

In Bun, JSON5 is a first-class citizen alongside JSON, TOML, and YAML. You can:

- Parse and stringify JSON5 with `Bun.JSON5.parse` and `Bun.JSON5.stringify`
- `import` & `require` JSON5 files as modules at runtime (including hot reloading & watch mode support)
- `import` & `require` JSON5 files in frontend apps via Bun's bundler

---

## Conformance

Bun's JSON5 parser passes 100% of the [official JSON5 test suite](https://github.com/json5/json5-tests). The parser is written in Zig for optimal performance. You can view our [translated test suite](https://github.com/oven-sh/bun/blob/main/test/js/bun/json5/json5-test-suite.test.ts) to see every test case.

---

## Runtime API

### `Bun.JSON5.parse()`

Parse a JSON5 string into a JavaScript value.

```ts
import { JSON5 } from "bun";

const data = JSON5.parse(`{
  // JSON5 supports comments
  name: 'my-app',
  version: '1.0.0',
  debug: true,

  // trailing commas are allowed
  tags: ['web', 'api',],
}`);

console.log(data);
// {
//   name: "my-app",
//   version: "1.0.0",
//   debug: true,
//   tags: ["web", "api"]
// }
```

#### Supported JSON5 Features

JSON5 is a superset of JSON based on ECMAScript 5.1 syntax. It supports:

- **Comments**: single-line (`//`) and multi-line (`/* */`)
- **Trailing commas**: in objects and arrays
- **Unquoted keys**: valid ECMAScript 5.1 identifiers can be used as keys
- **Single-quoted strings**: in addition to double-quoted strings
- **Multi-line strings**: using backslash line continuations
- **Hex numbers**: `0xFF`
- **Leading & trailing decimal points**: `.5` and `5.`
- **Infinity and NaN**: positive and negative
- **Explicit plus sign**: `+42`

```ts
const data = JSON5.parse(`{
  // Unquoted keys
  unquoted: 'keys work',

  // Single and double quotes
  single: 'single-quoted',
  double: "double-quoted",

  // Trailing commas
  trailing: 'comma',

  // Special numbers
  hex: 0xDEADbeef,
  half: .5,
  to: Infinity,
  nan: NaN,

  // Multi-line strings
  multiline: 'line 1 \
line 2',
}`);
```

#### Error Handling

`Bun.JSON5.parse()` throws a `SyntaxError` if the input is invalid JSON5:

```ts
try {
  JSON5.parse("{invalid}");
} catch (error) {
  console.error("Failed to parse JSON5:", error.message);
}
```

### `Bun.JSON5.stringify()`

Stringify a JavaScript value to a JSON5 string.

```ts
import { JSON5 } from "bun";

const str = JSON5.stringify({ name: "my-app", version: "1.0.0" });
console.log(str);
// {name:'my-app',version:'1.0.0'}
```

#### Pretty Printing

Pass a `space` argument to format the output with indentation:

```ts
const pretty = JSON5.stringify(
  {
    name: "my-app",
    debug: true,
    tags: ["web", "api"],
  },
  null,
  2,
);

console.log(pretty);
// {
//   name: 'my-app',
//   debug: true,
//   tags: [
//     'web',
//     'api',
//   ],
// }
```

The `space` argument can be a number (number of spaces) or a string (used as the indent character):

```ts
// Tab indentation
JSON5.stringify(data, null, "\t");
```

#### Special Values

Unlike `JSON.stringify`, `JSON5.stringify` preserves special numeric values:

```ts
JSON5.stringify({ inf: Infinity, ninf: -Infinity, nan: NaN });
// {inf:Infinity,ninf:-Infinity,nan:NaN}
```

---

## Module Import

### ES Modules

You can import JSON5 files directly as ES modules:

```json5 config.json5
{
  // Database configuration
  database: {
    host: "localhost",
    port: 5432,
    name: "myapp",
  },

  features: {
    auth: true,
    rateLimit: true,
    analytics: false,
  },
}
```

#### Default Import

```ts app.ts icon="/icons/typescript.svg"
import config from "./config.json5";

console.log(config.database.host); // "localhost"
console.log(config.features.auth); // true
```

#### Named Imports

You can destructure top-level properties as named imports:

```ts app.ts icon="/icons/typescript.svg"
import { database, features } from "./config.json5";

console.log(database.host); // "localhost"
console.log(features.rateLimit); // true
```

### CommonJS

JSON5 files can also be required in CommonJS:

```ts app.ts icon="/icons/typescript.svg"
const config = require("./config.json5");
console.log(config.database.name); // "myapp"

// Destructuring also works
const { database, features } = require("./config.json5");
```

---

## Hot Reloading with JSON5

When you run your application with `bun --hot`, changes to JSON5 files are automatically detected and reloaded:

```json5 config.json5
{
  server: {
    port: 3000,
    host: "localhost",
  },
  features: {
    debug: true,
    verbose: false,
  },
}
```

```ts server.ts icon="/icons/typescript.svg"
import { server, features } from "./config.json5";

Bun.serve({
  port: server.port,
  hostname: server.host,
  fetch(req) {
    if (features.verbose) {
      console.log(`${req.method} ${req.url}`);
    }
    return new Response("Hello World");
  },
});
```

Run with hot reloading:

```bash terminal icon="terminal"
bun --hot server.ts
```

---

## Bundler Integration

When you import JSON5 files and bundle with Bun, the JSON5 is parsed at build time and included as a JavaScript module:

```bash terminal icon="terminal"
bun build app.ts --outdir=dist
```

This means:

- Zero runtime JSON5 parsing overhead in production
- Smaller bundle sizes
- Tree-shaking support for unused properties (named imports)

### Dynamic Imports

JSON5 files can be dynamically imported:

```ts
const { default: config } = await import("./config.json5");
```
