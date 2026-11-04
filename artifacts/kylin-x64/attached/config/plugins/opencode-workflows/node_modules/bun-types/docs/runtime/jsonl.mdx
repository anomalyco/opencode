---
title: JSONL
description: Parse newline-delimited JSON (JSONL) with Bun's built-in streaming parser
---

Bun has built-in support for parsing [JSONL](https://jsonlines.org/) (newline-delimited JSON), where each line is a separate JSON value. The parser is implemented in C++ using JavaScriptCore's optimized JSON parser and supports streaming use cases.

```ts
const results = Bun.JSONL.parse('{"name":"Alice"}\n{"name":"Bob"}\n');
// [{ name: "Alice" }, { name: "Bob" }]
```

---

## `Bun.JSONL.parse()`

Parse a complete JSONL input and return an array of all parsed values.

```ts
import { JSONL } from "bun";

const input = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Charlie"}\n';
const records = JSONL.parse(input);
console.log(records);
// [
//   { id: 1, name: "Alice" },
//   { id: 2, name: "Bob" },
//   { id: 3, name: "Charlie" }
// ]
```

Input can be a string or a `Uint8Array`:

```ts
const buffer = new TextEncoder().encode('{"a":1}\n{"b":2}\n');
const results = Bun.JSONL.parse(buffer);
// [{ a: 1 }, { b: 2 }]
```

When passed a `Uint8Array`, a UTF-8 BOM at the start of the buffer is automatically skipped.

### Error handling

If the input contains invalid JSON, `Bun.JSONL.parse()` throws a `SyntaxError`:

```ts
try {
  Bun.JSONL.parse('{"valid":true}\n{invalid}\n');
} catch (error) {
  console.error(error); // SyntaxError: Failed to parse JSONL
}
```

---

## `Bun.JSONL.parseChunk()`

For streaming scenarios, `parseChunk` parses as many complete values as possible from the input and reports how far it got. This is useful when receiving data incrementally (e.g., from a network stream) and you need to know where to resume parsing.

```ts
const chunk = '{"id":1}\n{"id":2}\n{"id":3';

const result = Bun.JSONL.parseChunk(chunk);
console.log(result.values); // [{ id: 1 }, { id: 2 }]
console.log(result.read); // 17 — characters consumed
console.log(result.done); // false — incomplete value remains
console.log(result.error); // null — no parse error
```

### Return value

`parseChunk` returns an object with four properties:

| Property | Type                  | Description                                                             |
| -------- | --------------------- | ----------------------------------------------------------------------- |
| `values` | `any[]`               | Array of successfully parsed JSON values                                |
| `read`   | `number`              | Number of bytes (for `Uint8Array`) or characters (for strings) consumed |
| `done`   | `boolean`             | `true` if the entire input was consumed with no remaining data          |
| `error`  | `SyntaxError \| null` | Parse error, or `null` if no error occurred                             |

### Streaming example

Use `read` to slice off consumed input and carry forward the remainder:

```ts
let buffer = "";

async function processStream(stream: ReadableStream<string>) {
  for await (const chunk of stream) {
    buffer += chunk;
    const result = Bun.JSONL.parseChunk(buffer);

    for (const value of result.values) {
      handleRecord(value);
    }

    // Keep only the unconsumed portion
    buffer = buffer.slice(result.read);
  }

  // Handle any remaining data
  if (buffer.length > 0) {
    const final = Bun.JSONL.parseChunk(buffer);
    for (const value of final.values) {
      handleRecord(value);
    }
    if (final.error) {
      console.error("Parse error in final chunk:", final.error.message);
    }
  }
}
```

### Byte offsets with `Uint8Array`

When the input is a `Uint8Array`, you can pass optional `start` and `end` byte offsets:

```ts
const buf = new TextEncoder().encode('{"a":1}\n{"b":2}\n{"c":3}\n');

// Parse starting from byte 8
const result = Bun.JSONL.parseChunk(buf, 8);
console.log(result.values); // [{ b: 2 }, { c: 3 }]
console.log(result.read); // 24

// Parse a specific range
const partial = Bun.JSONL.parseChunk(buf, 0, 8);
console.log(partial.values); // [{ a: 1 }]
```

The `read` value is always a byte offset into the original buffer. Use it with `TypedArray.subarray()` for zero-copy streaming:

```ts
let buf = new Uint8Array(0);

async function processBinaryStream(stream: ReadableStream<Uint8Array>) {
  for await (const chunk of stream) {
    // Append chunk to buffer
    const newBuf = new Uint8Array(buf.length + chunk.length);
    newBuf.set(buf);
    newBuf.set(chunk, buf.length);
    buf = newBuf;

    const result = Bun.JSONL.parseChunk(buf);

    for (const value of result.values) {
      handleRecord(value);
    }

    // Keep unconsumed bytes
    buf = buf.slice(result.read);
  }
}
```

### Error recovery

Unlike `parse()`, `parseChunk()` does not throw on invalid JSON. Instead, it returns the error in the `error` property, along with any values that were successfully parsed before the error:

```ts
const input = '{"a":1}\n{invalid}\n{"b":2}\n';
const result = Bun.JSONL.parseChunk(input);

console.log(result.values); // [{ a: 1 }] — values parsed before the error
console.log(result.error); // SyntaxError
console.log(result.read); // 7 — position up to last successful parse
```

---

## Supported value types

Each line can be any valid JSON value, not just objects:

```ts
const input = '42\n"hello"\ntrue\nnull\n[1,2,3]\n{"key":"value"}\n';
const values = Bun.JSONL.parse(input);
// [42, "hello", true, null, [1, 2, 3], { key: "value" }]
```

---

## Performance notes

- **ASCII fast path**: Pure ASCII input is parsed directly without copying, using a zero-allocation `StringView`.
- **UTF-8 support**: Non-ASCII `Uint8Array` input is decoded to UTF-16 using SIMD-accelerated conversion.
- **BOM handling**: UTF-8 BOM (`0xEF 0xBB 0xBF`) at the start of a `Uint8Array` is automatically skipped.
- **Pre-built object shape**: The result object from `parseChunk` uses a cached structure for fast property access.
