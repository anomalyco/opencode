---
title: Streaming HTTP Server with Node.js Streams
sidebarTitle: Stream with Node.js
mode: center
---

In Bun, [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) objects can accept a Node.js [`Readable`](https://nodejs.org/api/stream.html#stream_readable_streams).

This works because Bun's `Response` object allows any async iterable as its body. Node.js streams are async iterables, so you can pass them directly to `Response`.

```ts server.ts icon="/icons/typescript.svg"
import { Readable } from "stream";
import { serve } from "bun";
serve({
  port: 3000,
  fetch(req) {
    return new Response(Readable.from(["Hello, ", "world!"]), {
      headers: { "Content-Type": "text/plain" },
    });
  },
});
```
