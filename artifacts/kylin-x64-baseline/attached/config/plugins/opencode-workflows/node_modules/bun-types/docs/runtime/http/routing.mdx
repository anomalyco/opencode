---
title: Routing
description: Define routes in `Bun.serve` using static paths, parameters, and wildcards
---

You can add routes to `Bun.serve()` by using the `routes` property (for static paths, parameters, and wildcards) or by handling unmatched requests with the [`fetch`](#fetch) method.

`Bun.serve()`'s router builds on top uWebSocket's [tree-based approach](https://github.com/oven-sh/bun/blob/0d1a00fa0f7830f8ecd99c027fce8096c9d459b6/packages/bun-uws/src/HttpRouter.h#L57-L64) to add [SIMD-accelerated route parameter decoding](https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/decodeURIComponentSIMD.cpp#L21-L271) and [JavaScriptCore structure caching](https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/ServerRouteList.cpp#L100-L101) to push the performance limits of what modern hardware allows.

## Basic Setup

```ts title="server.ts" icon="/icons/typescript.svg"
Bun.serve({
  routes: {
    "/": () => new Response("Home"),
    "/api": () => Response.json({ success: true }),
    "/users": async () => Response.json({ users: [] }),
  },
  fetch() {
    return new Response("Unmatched route");
  },
});
```

Routes in `Bun.serve()` receive a `BunRequest` (which extends [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)) and return a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) or `Promise<Response>`. This makes it easier to use the same code for both sending & receiving HTTP requests.

```ts
// Simplified for brevity
interface BunRequest<T extends string> extends Request {
  params: Record<T, string>;
  readonly cookies: CookieMap;
}
```

## Asynchronous Routes

### Async/await

You can use async/await in route handlers to return a `Promise<Response>`.

```ts
import { sql, serve } from "bun";

serve({
  port: 3001,
  routes: {
    "/api/version": async () => {
      const [version] = await sql`SELECT version()`;
      return Response.json(version);
    },
  },
});
```

### Promise

You can also return a `Promise<Response>` from a route handler.

```ts
import { sql, serve } from "bun";

serve({
  routes: {
    "/api/version": () => {
      return new Promise(resolve => {
        setTimeout(async () => {
          const [version] = await sql`SELECT version()`;
          resolve(Response.json(version));
        }, 100);
      });
    },
  },
});
```

---

## Route precedence

Routes are matched in order of specificity:

1. Exact routes (`/users/all`)
2. Parameter routes (`/users/:id`)
3. Wildcard routes (`/users/*`)
4. Global catch-all (`/*`)

```ts
Bun.serve({
  routes: {
    // Most specific first
    "/api/users/me": () => new Response("Current user"),
    "/api/users/:id": req => new Response(`User ${req.params.id}`),
    "/api/*": () => new Response("API catch-all"),
    "/*": () => new Response("Global catch-all"),
  },
});
```

---

## Type-safe route parameters

TypeScript parses route parameters when passed as a string literal, so that your editor will show autocomplete when accessing `request.params`.

```ts title="index.ts" icon="/icons/typescript.svg"
import type { BunRequest } from "bun";

Bun.serve({
  routes: {
    // TypeScript knows the shape of params when passed as a string literal
    "/orgs/:orgId/repos/:repoId": req => {
      const { orgId, repoId } = req.params;
      return Response.json({ orgId, repoId });
    },

    "/orgs/:orgId/repos/:repoId/settings": (
      // optional: you can explicitly pass a type to BunRequest:
      req: BunRequest<"/orgs/:orgId/repos/:repoId/settings">,
    ) => {
      const { orgId, repoId } = req.params;
      return Response.json({ orgId, repoId });
    },
  },
});
```

Percent-encoded route parameter values are automatically decoded. Unicode characters are supported. Invalid unicode is replaced with the unicode replacement character `&0xFFFD;`.

### Static responses

Routes can also be `Response` objects (without the handler function). Bun.serve() optimizes it for zero-allocation dispatch - perfect for health checks, redirects, and fixed content:

```ts
Bun.serve({
  routes: {
    // Health checks
    "/health": new Response("OK"),
    "/ready": new Response("Ready", {
      headers: {
        // Pass custom headers
        "X-Ready": "1",
      },
    }),

    // Redirects
    "/blog": Response.redirect("https://bun.com/blog"),

    // API responses
    "/api/config": Response.json({
      version: "1.0.0",
      env: "production",
    }),
  },
});
```

Static responses do not allocate additional memory after initialization. You can generally expect at least a 15% performance improvement over manually returning a `Response` object.

Static route responses are cached for the lifetime of the server object. To reload static routes, call `server.reload(options)`.

### File Responses vs Static Responses

When serving files in routes, there are two distinct behaviors depending on whether you buffer the file content or serve it directly:

```ts
Bun.serve({
  routes: {
    // Static route - content is buffered in memory at startup
    "/logo.png": new Response(await Bun.file("./logo.png").bytes()),

    // File route - content is read from filesystem on each request
    "/download.zip": new Response(Bun.file("./download.zip")),
  },
});
```

**Static routes** (`new Response(await file.bytes())`) buffer content in memory at startup:

- **Zero filesystem I/O** during requests - content served entirely from memory
- **ETag support** - Automatically generates and validates ETags for caching
- **If-None-Match** - Returns `304 Not Modified` when client ETag matches
- **No 404 handling** - Missing files cause startup errors, not runtime 404s
- **Memory usage** - Full file content stored in RAM
- **Best for**: Small static assets, API responses, frequently accessed files

**File routes** (`new Response(Bun.file(path))`) read from filesystem per request:

- **Filesystem reads** on each request - checks file existence and reads content
- **Built-in 404 handling** - Returns `404 Not Found` if file doesn't exist or becomes inaccessible
- **Last-Modified support** - Uses file modification time for `If-Modified-Since` headers
- **If-Modified-Since** - Returns `304 Not Modified` when file hasn't changed since client's cached version
- **Range request support** - Automatically handles partial content requests with `Content-Range` headers
- **Streaming transfers** - Uses buffered reader with backpressure handling for efficient memory usage
- **Memory efficient** - Only buffers small chunks during transfer, not entire file
- **Best for**: Large files, dynamic content, user uploads, files that change frequently

---

## Streaming files

To stream a file, return a `Response` object with a `BunFile` object as the body.

```ts
Bun.serve({
  fetch(req) {
    return new Response(Bun.file("./hello.txt"));
  },
});
```

<Info>
  ⚡️ **Speed** — Bun automatically uses the [`sendfile(2)`](https://man7.org/linux/man-pages/man2/sendfile.2.html)
  system call when possible, enabling zero-copy file transfers in the kernel—the fastest way to send files.
</Info>

You can send part of a file using the [`slice(start, end)`](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice) method on the `Bun.file` object. This automatically sets the `Content-Range` and `Content-Length` headers on the `Response` object.

```ts
Bun.serve({
  fetch(req) {
    // parse `Range` header
    const [start = 0, end = Infinity] = req.headers
      .get("Range") // Range: bytes=0-100
      .split("=") // ["Range: bytes", "0-100"]
      .at(-1) // "0-100"
      .split("-") // ["0", "100"]
      .map(Number); // [0, 100]

    // return a slice of the file
    const bigFile = Bun.file("./big-video.mp4");
    return new Response(bigFile.slice(start, end));
  },
});
```

---

## `fetch` request handler

The `fetch` handler handles incoming requests that weren't matched by any route. It receives a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) object and returns a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) or [`Promise<Response>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

```ts
Bun.serve({
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response("Home page!");
    if (url.pathname === "/blog") return new Response("Blog!");
    return new Response("404!");
  },
});
```

The `fetch` handler supports async/await:

```ts
import { sleep, serve } from "bun";

serve({
  async fetch(req) {
    const start = performance.now();
    await sleep(10);
    const end = performance.now();
    return new Response(`Slept for ${end - start}ms`);
  },
});
```

Promise-based responses are also supported:

```ts
Bun.serve({
  fetch(req) {
    // Forward the request to another server.
    return fetch("https://example.com");
  },
});
```

You can also access the `Server` object from the `fetch` handler. It's the second argument passed to the `fetch` function.

```ts
// `server` is passed in as the second argument to `fetch`.
const server = Bun.serve({
  fetch(req, server) {
    const ip = server.requestIP(req);
    return new Response(`Your IP is ${ip.address}`);
  },
});
```
