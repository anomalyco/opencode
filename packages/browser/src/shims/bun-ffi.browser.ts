type Pointer = number
type PointerInput = ArrayBuffer | ArrayBufferView | null | undefined

interface BrowserFfiRuntime {
  ptr: (value: PointerInput) => Pointer | null
  toArrayBuffer: (pointer: Pointer, byteOffset?: number, byteLength?: number) => ArrayBuffer
}

function getActiveRuntime(): BrowserFfiRuntime | null {
  return (globalThis as Record<string, unknown>).__OPENTUI_FFI_RUNTIME__ as BrowserFfiRuntime | null
}

export function dlopen(): never {
  throw new Error("bun:ffi is unavailable in the browser")
}

export function ptr(input: PointerInput): Pointer | null {
  if (input == null) {
    return null
  }

  const runtime = getActiveRuntime()
  if (!runtime) {
    throw new Error("bun:ffi pointers are unavailable in the browser")
  }

  return runtime.ptr(input)
}

export function toArrayBuffer(
  input: Pointer | ArrayBuffer | ArrayBufferView | Uint8Array,
  byteOffset = 0,
  byteLength?: number,
): ArrayBuffer {
  if (typeof input === "number") {
    const runtime = getActiveRuntime()
    if (!runtime) {
      throw new Error("bun:ffi pointers are unavailable in the browser")
    }

    return runtime.toArrayBuffer(input, byteOffset, byteLength)
  }

  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
  }

  return new Uint8Array(input).buffer
}

export class JSCallback {
  public readonly ptr = 0

  constructor(_fn: unknown, _options?: unknown) {}

  public close(): void {}
}

export default {
  dlopen,
  ptr,
  toArrayBuffer,
  JSCallback,
}
