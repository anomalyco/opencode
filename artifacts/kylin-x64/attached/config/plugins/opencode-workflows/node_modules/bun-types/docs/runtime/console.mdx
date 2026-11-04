---
title: Console
description: The console object in Bun
---

<Note>
  Bun provides a browser- and Node.js-compatible [console](https://developer.mozilla.org/en-US/docs/Web/API/console)
  global. This page only documents Bun-native APIs.
</Note>

---

## Object inspection depth

Bun allows you to configure how deeply nested objects are displayed in `console.log()` output:

- **CLI flag**: Use `--console-depth <number>` to set the depth for a single run
- **Configuration**: Set `console.depth` in your `bunfig.toml` for persistent configuration
- **Default**: Objects are inspected to a depth of `2` levels

```js
const nested = { a: { b: { c: { d: "deep" } } } };
console.log(nested);
// Default (depth 2): { a: { b: [Object] } }
// With depth 4: { a: { b: { c: { d: 'deep' } } } }
```

The CLI flag takes precedence over the configuration file setting.

---

## Reading from stdin

In Bun, the `console` object can be used as an `AsyncIterable` to sequentially read lines from `process.stdin`.

```ts adder.ts icon="/icons/typescript.svg"
for await (const line of console) {
  console.log(line);
}
```

This is useful for implementing interactive programs, like the following addition calculator.

```ts adder.ts icon="/icons/typescript.svg"
console.log(`Let's add some numbers!`);
console.write(`Count: 0\n> `);

let count = 0;
for await (const line of console) {
  count += Number(line);
  console.write(`Count: ${count}\n> `);
}
```

To run the file:

```bash terminal icon="terminal"
bun adder.ts
Let's add some numbers!
Count: 0
> 5
Count: 5
> 5
Count: 10
> 5
Count: 15
```
