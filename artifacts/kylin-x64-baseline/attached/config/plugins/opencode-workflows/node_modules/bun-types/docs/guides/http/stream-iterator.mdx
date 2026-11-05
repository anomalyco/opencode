---
title: Streaming HTTP Server with Async Iterators
sidebarTitle: Stream with iterators
mode: center
---

In Bun, [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) objects can accept an async generator function as their body. This allows you to stream data to the client as it becomes available, rather than waiting for the entire response to be ready.

```ts stream-iterator.ts icon="/icons/typescript.svg"
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response(
      // An async generator function
      async function* () {
        yield "Hello, ";
        await Bun.sleep(100);
        yield "world!";

        // you can also yield a TypedArray or Buffer
        yield new Uint8Array(["\n".charCodeAt(0)]);
      },
      { headers: { "Content-Type": "text/plain" } },
    );
  },
});
```

---

You can pass any async iterable directly to `Response`:

```ts stream-iterator.ts icon="/icons/typescript.svg"
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response(
      {
        [Symbol.asyncIterator]: async function* () {
          yield "Hello, ";
          await Bun.sleep(100);
          yield "world!";
        },
      },
      { headers: { "Content-Type": "text/plain" } },
    );
  },
});
```
