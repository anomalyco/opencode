---
title: Streams
description: Use Bun's streams API to work with binary data without loading it all into memory at once
---

Streams are an important abstraction for working with binary data without loading it all into memory at once. They are commonly used for reading and writing files, sending and receiving network requests, and processing large amounts of data.

Bun implements the Web APIs [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) and [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream).

<Note>
  Bun also implements the `node:stream` module, including
  [`Readable`](https://nodejs.org/api/stream.html#stream_readable_streams),
  [`Writable`](https://nodejs.org/api/stream.html#stream_writable_streams), and
  [`Duplex`](https://nodejs.org/api/stream.html#stream_duplex_and_transform_streams). For complete documentation, refer
  to the [Node.js docs](https://nodejs.org/api/stream.html).
</Note>

To create a `ReadableStream`:

```ts
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});
```

The contents of a `ReadableStream` can be read chunk-by-chunk with `for await` syntax.

```ts
for await (const chunk of stream) {
  console.log(chunk);
}

// hello
// world
```

---

## Direct `ReadableStream`

Bun implements an optimized version of `ReadableStream` that avoid unnecessary data copying & queue management logic.

With a traditional `ReadableStream`, chunks of data are _enqueued_. Each chunk is copied into a queue, where it sits until the stream is ready to send more data.

```ts
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});
```

With a direct `ReadableStream`, chunks of data are written directly to the stream. No queueing happens, and there's no need to clone the chunk data into memory. The `controller` API is updated to reflect this; instead of `.enqueue()` you call `.write`.

```ts
const stream = new ReadableStream({
  type: "direct", // [!code ++]
  pull(controller) {
    controller.write("hello");
    controller.write("world");
  },
});
```

When using a direct `ReadableStream`, the destination handles all chunk queueing. The consumer of the stream receives exactly what is passed to `controller.write()`, without any encoding or modification.

---

## Async generator streams

Bun also supports async generator functions as a source for `Response` and `Request`. Use async generators to create a `ReadableStream` that fetches data from an asynchronous source.

```ts
const response = new Response(
  (async function* () {
    yield "hello";
    yield "world";
  })(),
);

await response.text(); // "helloworld"
```

You can also use `[Symbol.asyncIterator]` directly.

```ts
const response = new Response({
  [Symbol.asyncIterator]: async function* () {
    yield "hello";
    yield "world";
  },
});

await response.text(); // "helloworld"
```

If you need more granular control over the stream, `yield` will return the direct ReadableStream controller.

```ts
const response = new Response({
  [Symbol.asyncIterator]: async function* () {
    const controller = yield "hello";
    await controller.end();
  },
});

await response.text(); // "hello"
```

---

## `Bun.ArrayBufferSink`

The `Bun.ArrayBufferSink` class is a fast incremental writer for constructing an `ArrayBuffer` of unknown size.

```ts
const sink = new Bun.ArrayBufferSink();

sink.write("h");
sink.write("e");
sink.write("l");
sink.write("l");
sink.write("o");

sink.end();
// ArrayBuffer(5) [ 104, 101, 108, 108, 111 ]
```

To instead retrieve the data as a `Uint8Array`, pass the `asUint8Array` option to the `start` method.

```ts
const sink = new Bun.ArrayBufferSink();
sink.start({
  asUint8Array: true, // [!code ++]
});

sink.write("h");
sink.write("e");
sink.write("l");
sink.write("l");
sink.write("o");

sink.end();
// Uint8Array(5) [ 104, 101, 108, 108, 111 ]
```

The `.write()` method supports strings, typed arrays, `ArrayBuffer`, and `SharedArrayBuffer`.

```ts
sink.write("h");
sink.write(new Uint8Array([101, 108]));
sink.write(Buffer.from("lo").buffer);

sink.end();
```

Once `.end()` is called, no more data can be written to the `ArrayBufferSink`. However, in the context of buffering a stream, it's useful to continuously write data and periodically `.flush()` the contents (say, into a `WriteableStream`). To support this, pass `stream: true` to the constructor.

```ts
const sink = new Bun.ArrayBufferSink();
sink.start({
  stream: true, // [!code ++]
});

sink.write("h");
sink.write("e");
sink.write("l");
sink.flush();
// ArrayBuffer(5) [ 104, 101, 108 ]

sink.write("l");
sink.write("o");
sink.flush();
// ArrayBuffer(5) [ 108, 111 ]
```

The `.flush()` method returns the buffered data as an `ArrayBuffer` (or `Uint8Array` if `asUint8Array: true`) and clears internal buffer.

To manually set the size of the internal buffer in bytes, pass a value for `highWaterMark`:

```ts
const sink = new Bun.ArrayBufferSink();
sink.start({
  highWaterMark: 1024 * 1024, // 1 MB  // [!code ++]
});
```

---

## Reference

```ts See Typescript Definitions expandable
/**
 * Fast incremental writer that becomes an `ArrayBuffer` on end().
 */
export class ArrayBufferSink {
  constructor();

  start(options?: {
    asUint8Array?: boolean;
    /**
     * Preallocate an internal buffer of this size
     * This can significantly improve performance when the chunk size is small
     */
    highWaterMark?: number;
    /**
     * On {@link ArrayBufferSink.flush}, return the written data as a `Uint8Array`.
     * Writes will restart from the beginning of the buffer.
     */
    stream?: boolean;
  }): void;

  write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
  /**
   * Flush the internal buffer
   *
   * If {@link ArrayBufferSink.start} was passed a `stream` option, this will return a `ArrayBuffer`
   * If {@link ArrayBufferSink.start} was passed a `stream` option and `asUint8Array`, this will return a `Uint8Array`
   * Otherwise, this will return the number of bytes written since the last flush
   *
   * This API might change later to separate Uint8ArraySink and ArrayBufferSink
   */
  flush(): number | Uint8Array<ArrayBuffer> | ArrayBuffer;
  end(): ArrayBuffer | Uint8Array<ArrayBuffer>;
}
```
