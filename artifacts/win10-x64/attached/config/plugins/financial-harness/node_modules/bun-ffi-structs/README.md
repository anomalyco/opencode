# bun-ffi-structs

TypeScript FFI struct library for Bun. Define and pack/unpack C-style structs with memory layout control for FFI calls.

## Features

- **Type-safe struct definitions** with primitives (u8, u16, u32, u64, i16, i32, f32, f64, bool_u8, bool_u32, pointer)
- **Enums** with custom base types and bidirectional mapping
- **Nested structs** (inline or as pointers)
- **Arrays** of primitives, enums, structs, and object pointers
- **Automatic alignment** following C struct layout rules (little-endian)
- **Field options**: optional, defaults, validation, transforms (packTransform, unpackTransform)
- **Conditional fields** for platform-specific layouts
- **mapValue/reduceValue** transformations for input/output type conversions
- **Object pointers** for referencing external objects with `.ptr` property
- **Allocation utilities** with pre-allocated sub-buffers for arrays
- **C strings** (null-terminated) and raw string pointers

## Installation

```bash
bun install bun-ffi-structs
```

For local development, use `scripts/link-dev.sh <target-project-root>` to symlink this package into another project's node_modules.

## Usage

See [examples/README.md](examples/README.md) for runnable examples demonstrating various features.

```typescript
import { defineStruct, defineEnum, allocStruct, objectPtr } from "./structs_ffi"

const ColorEnum = defineEnum({ RED: 0, GREEN: 1, BLUE: 2 })

const PositionStruct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
  ["z", "f32"],
])

const ObjectStruct = defineStruct([
  ["id", "u32"],
  ["position", PositionStruct],
  ["color", ColorEnum],
  ["count", "u32", { lengthOf: "items" }],
  ["items", ["u32"]],
])

const buffer: ArrayBuffer = ObjectStruct.pack({
  id: 42,
  position: { x: 1.0, y: 2.0, z: 3.0 },
  color: "BLUE",
  items: [10, 20, 30],
})

const unpacked = ObjectStruct.unpack(buffer)
// -> resolves to type {
//   id: number
//   position: { x: number, y: number, z: number }
//   color: "RED" | "GREEN" | "BLUE"
//   items: Iterable<number>
//   count?: number | null | undefined
// }
```
