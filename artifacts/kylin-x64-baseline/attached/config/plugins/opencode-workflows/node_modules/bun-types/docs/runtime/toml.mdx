---
title: TOML
description: Use Bun's built-in support for TOML files through both runtime APIs and bundler integration
---

In Bun, TOML is a first-class citizen alongside JSON, JSON5, and YAML. You can:

- Parse TOML strings with `Bun.TOML.parse`
- `import` & `require` TOML files as modules at runtime (including hot reloading & watch mode support)
- `import` & `require` TOML files in frontend apps via Bun's bundler

---

## Runtime API

### `Bun.TOML.parse()`

Parse a TOML string into a JavaScript object.

```ts
import { TOML } from "bun";
const text = `
name = "my-app"
version = "1.0.0"
debug = true

[database]
host = "localhost"
port = 5432

[features]
tags = ["web", "api"]
`;

const data = TOML.parse(text);
console.log(data);
// {
//   name: "my-app",
//   version: "1.0.0",
//   debug: true,
//   database: { host: "localhost", port: 5432 },
//   features: { tags: ["web", "api"] }
// }
```

#### Supported TOML Features

Bun's TOML parser supports the [TOML v1.0 specification](https://toml.io/en/v1.0.0), including:

- **Strings**: basic (`"..."`) and literal (`'...'`), including multi-line
- **Integers**: decimal, hex (`0x`), octal (`0o`), and binary (`0b`)
- **Floats**: including `inf` and `nan`
- **Booleans**: `true` and `false`
- **Arrays**: including mixed types and nested arrays
- **Tables**: standard (`[table]`) and inline (`{ key = "value" }`)
- **Array of tables**: `[[array]]`
- **Dotted keys**: `a.b.c = "value"`
- **Comments**: using `#`

```ts
const data = Bun.TOML.parse(`
# Application config
title = "My App"

[owner]
name = "John Doe"

[database]
enabled = true
ports = [8000, 8001, 8002]
connection_max = 5000

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[servers.beta]
ip = "10.0.0.2"
role = "backend"
`);
```

#### Error Handling

`Bun.TOML.parse()` throws if the TOML is invalid:

```ts
try {
  Bun.TOML.parse("invalid = = =");
} catch (error) {
  console.error("Failed to parse TOML:", error.message);
}
```

---

## Module Import

### ES Modules

You can import TOML files directly as ES modules. The TOML content is parsed and made available as both default and named exports:

```toml config.toml
[database]
host = "localhost"
port = 5432
name = "myapp"

[redis]
host = "localhost"
port = 6379

[features]
auth = true
rateLimit = true
analytics = false
```

#### Default Import

```ts app.ts icon="/icons/typescript.svg"
import config from "./config.toml";

console.log(config.database.host); // "localhost"
console.log(config.redis.port); // 6379
```

#### Named Imports

You can destructure top-level TOML tables as named imports:

```ts app.ts icon="/icons/typescript.svg"
import { database, redis, features } from "./config.toml";

console.log(database.host); // "localhost"
console.log(redis.port); // 6379
console.log(features.auth); // true
```

Or combine both:

```ts app.ts icon="/icons/typescript.svg"
import config, { database, features } from "./config.toml";

// Use the full config object
console.log(config);

// Or use specific parts
if (features.rateLimit) {
  setupRateLimiting(database);
}
```

#### Import Attributes

You can also use import attributes to load any file as TOML:

```ts app.ts icon="/icons/typescript.svg"
import myConfig from "./my.config" with { type: "toml" };
```

### CommonJS

TOML files can also be required in CommonJS:

```ts app.ts icon="/icons/typescript.svg"
const config = require("./config.toml");
console.log(config.database.name); // "myapp"

// Destructuring also works
const { database, redis } = require("./config.toml");
console.log(database.port); // 5432
```

---

## Hot Reloading with TOML

When you run your application with `bun --hot`, changes to TOML files are automatically detected and reloaded without restarting:

```toml config.toml
[server]
port = 3000
host = "localhost"

[features]
debug = true
verbose = false
```

```ts server.ts icon="/icons/typescript.svg"
import { server, features } from "./config.toml";

console.log(`Starting server on ${server.host}:${server.port}`);

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

Now when you modify `config.toml`, the changes are immediately reflected in your running application.

---

## Bundler Integration

When you import TOML files and bundle with Bun, the TOML is parsed at build time and included as a JavaScript module:

```bash terminal icon="terminal"
bun build app.ts --outdir=dist
```

This means:

- Zero runtime TOML parsing overhead in production
- Smaller bundle sizes
- Tree-shaking support for unused properties (named imports)

### Dynamic Imports

TOML files can be dynamically imported:

```ts
const config = await import("./config.toml");
```
