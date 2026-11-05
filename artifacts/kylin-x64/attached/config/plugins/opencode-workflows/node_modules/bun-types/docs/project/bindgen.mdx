---
title: Bindgen
description: Bindgen for Bun
---

<Note>This document is for maintainers and contributors to Bun, and describes internal implementation details.</Note>

The new bindings generator, introduced to the codebase in Dec 2024, scans for
`*.bind.ts` to find function and class definition, and generates glue code to
interop between JavaScript and native code.

There are currently other code generators and systems that achieve similar
purposes. The following will all eventually be completely phased out in favor of
this one:

- "Classes generator", converting `*.classes.ts` for custom classes.
- "JS2Native", allowing ad-hoc calls from `src/js` to native code.

## Creating JS Functions in Zig

Given a file implementing a simple function, such as `add`

```zig src/jsc/math.zig
pub fn add(global: *jsc.JSGlobalObject, a: i32, b: i32) !i32 {
    return std.math.add(i32, a, b) catch {
        // Binding functions can return `error.OutOfMemory` and `error.JSError`.
        // Others like `error.Overflow` from `std.math.add` must be converted.
        // Remember to be descriptive.
        return global.throwPretty("Integer overflow while adding", .{});
    };
}

const gen = bun.gen.math; // "math" being this file's basename

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
```

Then describe the API schema using a `.bind.ts` function. The binding file goes next to the Zig file.

```ts src/jsc/math.bind.ts icon="/icons/typescript.svg"
import { t, fn } from "bindgen";

export const add = fn({
  args: {
    global: t.globalObject,
    a: t.i32,
    b: t.i32.default(1),
  },
  ret: t.i32,
});
```

This function declaration is equivalent to:

```ts
/**
 * Throws if zero arguments are provided.
 * Wraps out of range numbers using modulo.
 */
declare function add(a: number, b: number = 1): number;
```

The code generator will provide `bun.gen.math.jsAdd`, which is the native
function implementation. To pass to JavaScript, use
`bun.gen.math.createAddCallback(global)`. JS files in `src/js/` may use
`$bindgenFn("math.bind.ts", "add")` to get a handle to the implementation.

## Strings

The type for receiving strings is one of [`t.DOMString`](https://webidl.spec.whatwg.org/#idl-DOMString), [`t.ByteString`](https://webidl.spec.whatwg.org/#idl-ByteString), and [`t.USVString`](https://webidl.spec.whatwg.org/#idl-USVString). These map directly to their WebIDL counterparts, and have slightly different conversion logic. Bindgen will pass BunString to native code in all cases.

When in doubt, use DOMString.

`t.UTF8String` can be used in place of `t.DOMString`, but will call `bun.String.toUTF8`. The native callback gets `[]const u8` (WTF-8 data) passed to native code, freeing it after the function returns.

TLDRs from WebIDL spec:

- ByteString can only contain valid latin1 characters. It is not safe to assume bun.String is already in 8-bit format, but it is extremely likely.
- USVString will not contain invalid surrogate pairs, aka text that can be represented correctly in UTF-8.
- DOMString is the loosest but also most recommended strategy.

## Function Variants

A `variants` can specify multiple variants (also known as overloads).

```ts src/jsc/math.bind.ts icon="/icons/typescript.svg"
import { t, fn } from "bindgen";

export const action = fn({
  variants: [
    {
      args: {
        a: t.i32,
      },
      ret: t.i32,
    },
    {
      args: {
        a: t.DOMString,
      },
      ret: t.DOMString,
    },
  ],
});
```

In Zig, each variant gets a number, based on the order the schema defines.

```zig
fn action1(a: i32) i32 {
  return a;
}

fn action2(a: bun.String) bun.String {
  return a;
}
```

## `t.dictionary`

A `dictionary` is a definition for a JavaScript object, typically as a function inputs. For function outputs, it is usually a smarter idea to declare a class type to add functions and destructuring.

## Enumerations

To use [WebIDL's enumeration](https://webidl.spec.whatwg.org/#idl-enums) type, use either:

- `t.stringEnum`: Create and codegen a new enum type.
- `t.zigEnum`: Derive a bindgen type off of an existing enum in the codebase.

An example of `stringEnum` as used in `fmt.zig` / `bun:internal-for-testing`

```ts
export const Formatter = t.stringEnum("highlight-javascript", "escape-powershell");

export const fmtString = fn({
  args: {
    global: t.globalObject,
    code: t.UTF8String,
    formatter: Formatter,
  },
  ret: t.DOMString,
});
```

WebIDL strongly encourages using kebab case for enumeration values, to be consistent with existing Web APIs.

### Deriving enums from Zig code

TODO: zigEnum

## `t.oneOf`

A `oneOf` is a union between two or more types. It is represented by `union(enum)` in Zig.

TODO:

## Attributes

There are set of attributes that can be chained onto `t.*` types. On all types there are:

- `.required`, in dictionary parameters only
- `.optional`, in function arguments only
- `.default(T)`

When a value is optional, it is lowered to a Zig optional.

Depending on the type, there are more attributes available. See the type definitions in auto-complete for more details. Note that one of the above three can only be applied, and they must be applied at the end.

### Integer Attributes

Integer types allow customizing the overflow behavior with `clamp` or `enforceRange`

```ts
import { t, fn } from "bindgen";

export const add = fn({
  args: {
    global: t.globalObject,
    // enforce in i32 range
    a: t.i32.enforceRange(),
    // clamp to u16 range
    b: t.u16,
    // enforce in arbitrary range, with a default if not provided
    c: t.i32.enforceRange(0, 1000).default(5),
    // clamp to arbitrary range, or null
    d: t.u16.clamp(0, 10).optional,
  },
  ret: t.i32,
});
```

Various Node.js validator functions such as `validateInteger`, `validateNumber`, and more are available. Use these when implementing Node.js APIs, so the error messages match 1:1 what Node would do.

Unlike `enforceRange`, which is taken from WebIDL, `validate*` functions are much more strict on the input they accept. For example, Node's numerical validator check `typeof value === 'number'`, while WebIDL uses `ToNumber` for lossy conversion.

```ts
import { t, fn } from "bindgen";

export const add = fn({
  args: {
    global: t.globalObject,
    // throw if not given a number
    a: t.f64.validateNumber(),
    // valid in i32 range
    a: t.i32.validateInt32(),
    // f64 within safe integer range
    b: t.f64.validateInteger(),
    // f64 in given range
    c: t.f64.validateNumber(-10000, 10000),
  },
  ret: t.i32,
});
```

## Callbacks

TODO

## Classes

TODO
