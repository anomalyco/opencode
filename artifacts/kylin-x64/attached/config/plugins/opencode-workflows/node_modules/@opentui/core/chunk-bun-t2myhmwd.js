// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __require = import.meta.require;

// src/yoga.ts
var exports_yoga = {};
__export(exports_yoga, {
  default: () => yoga_default,
  Wrap: () => Wrap,
  WRAP_WRAP_REVERSE: () => WRAP_WRAP_REVERSE,
  WRAP_WRAP: () => WRAP_WRAP,
  WRAP_NO_WRAP: () => WRAP_NO_WRAP,
  Unit: () => Unit,
  UNIT_UNDEFINED: () => UNIT_UNDEFINED,
  UNIT_POINT: () => UNIT_POINT,
  UNIT_PERCENT: () => UNIT_PERCENT,
  UNIT_AUTO: () => UNIT_AUTO,
  PositionType: () => PositionType,
  POSITION_TYPE_STATIC: () => POSITION_TYPE_STATIC,
  POSITION_TYPE_RELATIVE: () => POSITION_TYPE_RELATIVE,
  POSITION_TYPE_ABSOLUTE: () => POSITION_TYPE_ABSOLUTE,
  Overflow: () => Overflow,
  OVERFLOW_VISIBLE: () => OVERFLOW_VISIBLE,
  OVERFLOW_SCROLL: () => OVERFLOW_SCROLL,
  OVERFLOW_HIDDEN: () => OVERFLOW_HIDDEN,
  NodeType: () => NodeType,
  Node: () => Node,
  NODE_TYPE_TEXT: () => NODE_TYPE_TEXT,
  NODE_TYPE_DEFAULT: () => NODE_TYPE_DEFAULT,
  MeasureMode: () => MeasureMode,
  MEASURE_MODE_UNDEFINED: () => MEASURE_MODE_UNDEFINED,
  MEASURE_MODE_EXACTLY: () => MEASURE_MODE_EXACTLY,
  MEASURE_MODE_AT_MOST: () => MEASURE_MODE_AT_MOST,
  LogLevel: () => LogLevel,
  LOG_LEVEL_WARN: () => LOG_LEVEL_WARN,
  LOG_LEVEL_VERBOSE: () => LOG_LEVEL_VERBOSE,
  LOG_LEVEL_INFO: () => LOG_LEVEL_INFO,
  LOG_LEVEL_FATAL: () => LOG_LEVEL_FATAL,
  LOG_LEVEL_ERROR: () => LOG_LEVEL_ERROR,
  LOG_LEVEL_DEBUG: () => LOG_LEVEL_DEBUG,
  Justify: () => Justify,
  JUSTIFY_SPACE_EVENLY: () => JUSTIFY_SPACE_EVENLY,
  JUSTIFY_SPACE_BETWEEN: () => JUSTIFY_SPACE_BETWEEN,
  JUSTIFY_SPACE_AROUND: () => JUSTIFY_SPACE_AROUND,
  JUSTIFY_FLEX_START: () => JUSTIFY_FLEX_START,
  JUSTIFY_FLEX_END: () => JUSTIFY_FLEX_END,
  JUSTIFY_CENTER: () => JUSTIFY_CENTER,
  Gutter: () => Gutter,
  GUTTER_ROW: () => GUTTER_ROW,
  GUTTER_COLUMN: () => GUTTER_COLUMN,
  GUTTER_ALL: () => GUTTER_ALL,
  FlexDirection: () => FlexDirection,
  FLEX_DIRECTION_ROW_REVERSE: () => FLEX_DIRECTION_ROW_REVERSE,
  FLEX_DIRECTION_ROW: () => FLEX_DIRECTION_ROW,
  FLEX_DIRECTION_COLUMN_REVERSE: () => FLEX_DIRECTION_COLUMN_REVERSE,
  FLEX_DIRECTION_COLUMN: () => FLEX_DIRECTION_COLUMN,
  ExperimentalFeature: () => ExperimentalFeature,
  Errata: () => Errata,
  Edge: () => Edge,
  EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS: () => EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS,
  ERRATA_STRETCH_FLEX_BASIS: () => ERRATA_STRETCH_FLEX_BASIS,
  ERRATA_NONE: () => ERRATA_NONE,
  ERRATA_CLASSIC: () => ERRATA_CLASSIC,
  ERRATA_ALL: () => ERRATA_ALL,
  ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING: () => ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING,
  ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE: () => ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE,
  EDGE_VERTICAL: () => EDGE_VERTICAL,
  EDGE_TOP: () => EDGE_TOP,
  EDGE_START: () => EDGE_START,
  EDGE_RIGHT: () => EDGE_RIGHT,
  EDGE_LEFT: () => EDGE_LEFT,
  EDGE_HORIZONTAL: () => EDGE_HORIZONTAL,
  EDGE_END: () => EDGE_END,
  EDGE_BOTTOM: () => EDGE_BOTTOM,
  EDGE_ALL: () => EDGE_ALL,
  Display: () => Display,
  Direction: () => Direction,
  Dimension: () => Dimension,
  DISPLAY_NONE: () => DISPLAY_NONE,
  DISPLAY_FLEX: () => DISPLAY_FLEX,
  DISPLAY_CONTENTS: () => DISPLAY_CONTENTS,
  DIRECTION_RTL: () => DIRECTION_RTL,
  DIRECTION_LTR: () => DIRECTION_LTR,
  DIRECTION_INHERIT: () => DIRECTION_INHERIT,
  DIMENSION_WIDTH: () => DIMENSION_WIDTH,
  DIMENSION_HEIGHT: () => DIMENSION_HEIGHT,
  Config: () => Config,
  BoxSizing: () => BoxSizing,
  BOX_SIZING_CONTENT_BOX: () => BOX_SIZING_CONTENT_BOX,
  BOX_SIZING_BORDER_BOX: () => BOX_SIZING_BORDER_BOX,
  Align: () => Align,
  ALIGN_STRETCH: () => ALIGN_STRETCH,
  ALIGN_SPACE_EVENLY: () => ALIGN_SPACE_EVENLY,
  ALIGN_SPACE_BETWEEN: () => ALIGN_SPACE_BETWEEN,
  ALIGN_SPACE_AROUND: () => ALIGN_SPACE_AROUND,
  ALIGN_FLEX_START: () => ALIGN_FLEX_START,
  ALIGN_FLEX_END: () => ALIGN_FLEX_END,
  ALIGN_CENTER: () => ALIGN_CENTER,
  ALIGN_BASELINE: () => ALIGN_BASELINE,
  ALIGN_AUTO: () => ALIGN_AUTO
});

// src/platform/ffi.ts
import { createRequire } from "module";
import { fileURLToPath } from "url";
var FFIType = {
  char: "char",
  int8_t: "int8_t",
  i8: "i8",
  uint8_t: "uint8_t",
  u8: "u8",
  int16_t: "int16_t",
  i16: "i16",
  uint16_t: "uint16_t",
  u16: "u16",
  int32_t: "int32_t",
  i32: "i32",
  int: "int",
  uint32_t: "uint32_t",
  u32: "u32",
  int64_t: "int64_t",
  i64: "i64",
  uint64_t: "uint64_t",
  u64: "u64",
  double: "double",
  f64: "f64",
  float: "float",
  f32: "f32",
  bool: "bool",
  ptr: "ptr",
  pointer: "pointer",
  void: "void",
  cstring: "cstring",
  function: "function",
  usize: "usize",
  callback: "callback",
  napi_env: "napi_env",
  napi_value: "napi_value",
  buffer: "buffer"
};
var FFI_UNAVAILABLE = "OpenTUI native FFI is not available for this runtime yet";
var BUN_DLOPEN_NULL = "Bun FFI backend does not support dlopen(null)";
var LIBRARY_CLOSED = "Cannot create FFI callback after library.close() has been called";
var NODE_CALLBACK_THREADSAFE = "Node FFI callbacks are same-thread only and do not support threadsafe callbacks";
var NODE_NAPI_UNSUPPORTED = "Node FFI backend does not support Bun N-API FFI types";
var NODE_POINTER_OVERRIDE = "Node FFI backend does not support FFIFunction.ptr overrides";
var NODE_POINTER_ARGUMENT = "Node FFI pointer arguments must be a Pointer, ArrayBuffer, or ArrayBufferView";
var NODE_PTR_VALUE = "node:ffi ptr() only supports ArrayBuffer and ArrayBufferView values backed by ArrayBuffer";
var NODE_STRING_RETURN = "Node FFI backend does not normalize string return values (yet)";
var NODE_USIZE_UNSUPPORTED = "Node FFI backend does not support usize yet";
var POINTER_NEGATIVE = "Pointer must be non-negative";
var POINTER_OFFSET_NEGATIVE = "Pointer offset must be non-negative";
var POINTER_OFFSET_UNSAFE = "Pointer offset must be a safe integer";
var POINTER_UNSAFE = "Pointer exceeds safe integer range";
var arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
function isArrayBuffer(value) {
  if (value === null || typeof value !== "object" || arrayBufferByteLength == null)
    return false;
  try {
    arrayBufferByteLength.call(value);
    return true;
  } catch {
    return false;
  }
}
function unavailable(cause) {
  throw new Error(FFI_UNAVAILABLE, { cause });
}
function createUnsupportedBackend(cause) {
  return {
    dlopen() {
      return unavailable(cause);
    },
    ptr() {
      return unavailable(cause);
    },
    suffix: "",
    toArrayBuffer() {
      return unavailable(cause);
    }
  };
}
var isBun = typeof process !== "undefined" && typeof process.versions === "object" && process.versions !== null && typeof process.versions.bun === "string";
var requireModule = createRequire(import.meta.url);
var backend = loadBackend();
function loadBackend() {
  if (isBun) {
    return createBunBackend(requireModule("bun:ffi"));
  }
  try {
    const nodeFfi = requireModule("node:ffi");
    return createNodeBackend(nodeFfi.default ?? nodeFfi);
  } catch (error) {
    return createUnsupportedBackend(error);
  }
}
function toPointer(value) {
  if (isBun && typeof value === "bigint") {
    return toSafeNumberPointer(value);
  }
  if (!isBun && typeof value === "number") {
    return toSafeBigIntPointer(value);
  }
  return value;
}
function ffiBool(value) {
  return value ? 1 : 0;
}
function toSafeNumberPointer(pointer) {
  if (pointer < 0n) {
    throw new Error(POINTER_NEGATIVE);
  }
  if (pointer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(POINTER_UNSAFE);
  }
  return Number(pointer);
}
function toSafeBigIntPointer(pointer) {
  if (pointer < 0) {
    throw new Error(POINTER_NEGATIVE);
  }
  if (!Number.isSafeInteger(pointer)) {
    throw new Error(POINTER_UNSAFE);
  }
  return BigInt(pointer);
}
function createManagedCallback(raw, callbacks) {
  let ptr = raw.ptr;
  let closed = false;
  const instance = {
    get ptr() {
      return ptr;
    },
    get threadsafe() {
      return raw.threadsafe;
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      callbacks.delete(instance);
      try {
        raw.close();
      } finally {
        ptr = null;
      }
    }
  };
  callbacks.add(instance);
  return instance;
}
function normalizeBunDefinitions(definitions) {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, normalizeBunDefinition(definition)]));
}
function normalizeBunDefinition(definition) {
  return {
    args: definition.args,
    returns: definition.returns,
    ptr: definition.ptr == null ? undefined : toBunPointer(definition.ptr),
    threadsafe: definition.threadsafe
  };
}
function toBunPointer(pointer) {
  return typeof pointer === "bigint" ? toSafeNumberPointer(pointer) : pointer;
}
function createBunBackend(bun) {
  return {
    dlopen(path, symbols) {
      if (path === null) {
        throw new Error(BUN_DLOPEN_NULL);
      }
      const library = bun.dlopen(path, normalizeBunDefinitions(symbols));
      const callbacks = new Set;
      let closed = false;
      return {
        symbols: library.symbols,
        createCallback(callback, definition) {
          if (closed) {
            throw new Error(LIBRARY_CLOSED);
          }
          const raw = new bun.JSCallback(callback, normalizeBunDefinition(definition));
          return createManagedCallback(raw, callbacks);
        },
        close() {
          if (closed) {
            return;
          }
          closed = true;
          try {
            library.close();
          } finally {
            for (const callback of [...callbacks]) {
              callback.close();
            }
          }
        }
      };
    },
    ptr: bun.ptr,
    suffix: bun.suffix,
    toArrayBuffer(pointer, offset, length) {
      return bun.toArrayBuffer(toBunPointer(pointer), offset, length);
    }
  };
}
function createNodeBackend(nodeFfi) {
  return {
    dlopen(path, symbols) {
      const { lib, functions } = nodeFfi.dlopen(toNodeLibraryPath(path), normalizeNodeDefinitions(symbols));
      const callbacks = new Set;
      let closed = false;
      let libraryClosed = false;
      return {
        symbols: wrapNodeSymbols(functions, symbols),
        createCallback(callback, definition) {
          if (closed) {
            throw new Error(LIBRARY_CLOSED);
          }
          if (definition.threadsafe) {
            throw new Error(NODE_CALLBACK_THREADSAFE);
          }
          const callbackPointer = lib.registerCallback(normalizeNodeDefinition(definition), callback);
          const raw = {
            ptr: callbackPointer,
            threadsafe: false,
            close() {
              if (!libraryClosed) {
                lib.unregisterCallback(callbackPointer);
              }
            }
          };
          return createManagedCallback(raw, callbacks);
        },
        close() {
          if (closed) {
            return;
          }
          closed = true;
          try {
            libraryClosed = true;
            lib.close();
          } finally {
            for (const callback of [...callbacks]) {
              callback.close();
            }
          }
        }
      };
    },
    ptr(value) {
      return toNodeSourcePointer(nodeFfi, value);
    },
    suffix: nodeFfi.suffix,
    toArrayBuffer(pointer, offset, length) {
      return nodeFfi.toArrayBuffer(toBigIntPointer(pointer) + toNodePointerOffset(offset), length, false);
    }
  };
}
function toNodeLibraryPath(path) {
  return path instanceof URL ? fileURLToPath(path) : path;
}
function normalizeNodeDefinitions(definitions) {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, normalizeNodeDefinition(definition)]));
}
function wrapNodeSymbols(functions, definitions) {
  return Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name, wrapNodeSymbol(fn, definitions[name])]));
}
function wrapNodeSymbol(fn, definition) {
  const pointerArgIndexes = (definition.args ?? []).flatMap((type, index) => isNodePointerArgumentType(type) ? [index] : []);
  if (pointerArgIndexes.length === 0) {
    return fn;
  }
  return (...args) => {
    const normalizedArgs = args.slice();
    for (const index of pointerArgIndexes) {
      normalizedArgs[index] = toNodePointerArgument(normalizedArgs[index]);
    }
    return fn(...normalizedArgs);
  };
}
function isNodePointerArgumentType(type) {
  return type === FFIType.ptr || type === FFIType.pointer || type === FFIType.function || type === FFIType.callback;
}
function toNodePointerArgument(value) {
  if (value == null) {
    return 0n;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return toBigIntPointer(value);
  }
  if (ArrayBuffer.isView(value)) {
    if (!isArrayBuffer(value.buffer)) {
      throw new TypeError(NODE_PTR_VALUE);
    }
    if (value.byteLength === 0) {
      return 0n;
    }
    return value;
  }
  if (isArrayBuffer(value)) {
    if (value.byteLength === 0) {
      return 0n;
    }
    return value;
  }
  throw new TypeError(NODE_POINTER_ARGUMENT);
}
function toNodeSourcePointer(nodeFfi, value) {
  if (ArrayBuffer.isView(value)) {
    if (!isArrayBuffer(value.buffer)) {
      throw new TypeError(NODE_PTR_VALUE);
    }
    return nodeFfi.getRawPointer(value.buffer) + BigInt(value.byteOffset);
  }
  if (isArrayBuffer(value)) {
    return nodeFfi.getRawPointer(value);
  }
  throw new TypeError(NODE_PTR_VALUE);
}
function toNodePointerOffset(offset) {
  if (offset == null) {
    return 0n;
  }
  if (offset < 0) {
    throw new Error(POINTER_OFFSET_NEGATIVE);
  }
  if (!Number.isSafeInteger(offset)) {
    throw new Error(POINTER_OFFSET_UNSAFE);
  }
  return BigInt(offset);
}
function normalizeNodeDefinition(definition) {
  if (definition.ptr != null) {
    throw new Error(NODE_POINTER_OVERRIDE);
  }
  return {
    arguments: (definition.args ?? []).map((type) => toNodeFFIType(type, "parameter")),
    return: toNodeFFIType(definition.returns ?? FFIType.void, "result")
  };
}
function toNodeFFIType(type, position) {
  switch (type) {
    case FFIType.char:
      return "char";
    case FFIType.int8_t:
    case FFIType.i8:
      return "i8";
    case FFIType.uint8_t:
    case FFIType.u8:
      return "u8";
    case FFIType.int16_t:
    case FFIType.i16:
      return "i16";
    case FFIType.uint16_t:
    case FFIType.u16:
      return "u16";
    case FFIType.int32_t:
    case FFIType.int:
    case FFIType.i32:
      return "i32";
    case FFIType.uint32_t:
    case FFIType.u32:
      return "u32";
    case FFIType.int64_t:
    case FFIType.i64:
      return "i64";
    case FFIType.uint64_t:
    case FFIType.u64:
      return "u64";
    case FFIType.double:
    case FFIType.f64:
      return "f64";
    case FFIType.float:
    case FFIType.f32:
      return "f32";
    case FFIType.bool:
      return "bool";
    case FFIType.ptr:
    case FFIType.pointer:
      return "pointer";
    case FFIType.void:
      return "void";
    case FFIType.cstring:
      if (position === "result") {
        throw new Error(NODE_STRING_RETURN);
      }
      return "string";
    case FFIType.function:
    case FFIType.callback:
      return "pointer";
    case FFIType.usize:
      throw new Error(NODE_USIZE_UNSUPPORTED);
    case FFIType.napi_env:
    case FFIType.napi_value:
      throw new Error(NODE_NAPI_UNSUPPORTED);
    case FFIType.buffer:
      return "buffer";
    default:
      return unsupportedNodeFFIType(type);
  }
}
function unsupportedNodeFFIType(type) {
  throw new Error(`Unsupported FFIType for node:ffi: ${String(type)}`);
}
function toBigIntPointer(pointer) {
  if (typeof pointer === "bigint") {
    if (pointer < 0n) {
      throw new Error(POINTER_NEGATIVE);
    }
    return pointer;
  }
  return toSafeBigIntPointer(pointer);
}
var dlopen = backend.dlopen;
var ptr = backend.ptr;
var suffix = backend.suffix;
var toArrayBuffer = backend.toArrayBuffer;

// src/platform/runtime.ts
import { existsSync } from "fs";
import { mkdir, writeFile as writeFileNode } from "fs/promises";
import { dirname, isAbsolute as isAbsolute2, resolve } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";

// ../../node_modules/.bun/ansi-regex@6.2.2/node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

// ../../node_modules/.bun/strip-ansi@7.1.2/node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}

// ../../node_modules/.bun/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/lookup.js
function isAmbiguous(x) {
  return x === 161 || x === 164 || x === 167 || x === 168 || x === 170 || x === 173 || x === 174 || x >= 176 && x <= 180 || x >= 182 && x <= 186 || x >= 188 && x <= 191 || x === 198 || x === 208 || x === 215 || x === 216 || x >= 222 && x <= 225 || x === 230 || x >= 232 && x <= 234 || x === 236 || x === 237 || x === 240 || x === 242 || x === 243 || x >= 247 && x <= 250 || x === 252 || x === 254 || x === 257 || x === 273 || x === 275 || x === 283 || x === 294 || x === 295 || x === 299 || x >= 305 && x <= 307 || x === 312 || x >= 319 && x <= 322 || x === 324 || x >= 328 && x <= 331 || x === 333 || x === 338 || x === 339 || x === 358 || x === 359 || x === 363 || x === 462 || x === 464 || x === 466 || x === 468 || x === 470 || x === 472 || x === 474 || x === 476 || x === 593 || x === 609 || x === 708 || x === 711 || x >= 713 && x <= 715 || x === 717 || x === 720 || x >= 728 && x <= 731 || x === 733 || x === 735 || x >= 768 && x <= 879 || x >= 913 && x <= 929 || x >= 931 && x <= 937 || x >= 945 && x <= 961 || x >= 963 && x <= 969 || x === 1025 || x >= 1040 && x <= 1103 || x === 1105 || x === 8208 || x >= 8211 && x <= 8214 || x === 8216 || x === 8217 || x === 8220 || x === 8221 || x >= 8224 && x <= 8226 || x >= 8228 && x <= 8231 || x === 8240 || x === 8242 || x === 8243 || x === 8245 || x === 8251 || x === 8254 || x === 8308 || x === 8319 || x >= 8321 && x <= 8324 || x === 8364 || x === 8451 || x === 8453 || x === 8457 || x === 8467 || x === 8470 || x === 8481 || x === 8482 || x === 8486 || x === 8491 || x === 8531 || x === 8532 || x >= 8539 && x <= 8542 || x >= 8544 && x <= 8555 || x >= 8560 && x <= 8569 || x === 8585 || x >= 8592 && x <= 8601 || x === 8632 || x === 8633 || x === 8658 || x === 8660 || x === 8679 || x === 8704 || x === 8706 || x === 8707 || x === 8711 || x === 8712 || x === 8715 || x === 8719 || x === 8721 || x === 8725 || x === 8730 || x >= 8733 && x <= 8736 || x === 8739 || x === 8741 || x >= 8743 && x <= 8748 || x === 8750 || x >= 8756 && x <= 8759 || x === 8764 || x === 8765 || x === 8776 || x === 8780 || x === 8786 || x === 8800 || x === 8801 || x >= 8804 && x <= 8807 || x === 8810 || x === 8811 || x === 8814 || x === 8815 || x === 8834 || x === 8835 || x === 8838 || x === 8839 || x === 8853 || x === 8857 || x === 8869 || x === 8895 || x === 8978 || x >= 9312 && x <= 9449 || x >= 9451 && x <= 9547 || x >= 9552 && x <= 9587 || x >= 9600 && x <= 9615 || x >= 9618 && x <= 9621 || x === 9632 || x === 9633 || x >= 9635 && x <= 9641 || x === 9650 || x === 9651 || x === 9654 || x === 9655 || x === 9660 || x === 9661 || x === 9664 || x === 9665 || x >= 9670 && x <= 9672 || x === 9675 || x >= 9678 && x <= 9681 || x >= 9698 && x <= 9701 || x === 9711 || x === 9733 || x === 9734 || x === 9737 || x === 9742 || x === 9743 || x === 9756 || x === 9758 || x === 9792 || x === 9794 || x === 9824 || x === 9825 || x >= 9827 && x <= 9829 || x >= 9831 && x <= 9834 || x === 9836 || x === 9837 || x === 9839 || x === 9886 || x === 9887 || x === 9919 || x >= 9926 && x <= 9933 || x >= 9935 && x <= 9939 || x >= 9941 && x <= 9953 || x === 9955 || x === 9960 || x === 9961 || x >= 9963 && x <= 9969 || x === 9972 || x >= 9974 && x <= 9977 || x === 9979 || x === 9980 || x === 9982 || x === 9983 || x === 10045 || x >= 10102 && x <= 10111 || x >= 11094 && x <= 11097 || x >= 12872 && x <= 12879 || x >= 57344 && x <= 63743 || x >= 65024 && x <= 65039 || x === 65533 || x >= 127232 && x <= 127242 || x >= 127248 && x <= 127277 || x >= 127280 && x <= 127337 || x >= 127344 && x <= 127373 || x === 127375 || x === 127376 || x >= 127387 && x <= 127404 || x >= 917760 && x <= 917999 || x >= 983040 && x <= 1048573 || x >= 1048576 && x <= 1114109;
}
function isFullWidth(x) {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
}
function isWide(x) {
  return x >= 4352 && x <= 4447 || x === 8986 || x === 8987 || x === 9001 || x === 9002 || x >= 9193 && x <= 9196 || x === 9200 || x === 9203 || x === 9725 || x === 9726 || x === 9748 || x === 9749 || x >= 9776 && x <= 9783 || x >= 9800 && x <= 9811 || x === 9855 || x >= 9866 && x <= 9871 || x === 9875 || x === 9889 || x === 9898 || x === 9899 || x === 9917 || x === 9918 || x === 9924 || x === 9925 || x === 9934 || x === 9940 || x === 9962 || x === 9970 || x === 9971 || x === 9973 || x === 9978 || x === 9981 || x === 9989 || x === 9994 || x === 9995 || x === 10024 || x === 10060 || x === 10062 || x >= 10067 && x <= 10069 || x === 10071 || x >= 10133 && x <= 10135 || x === 10160 || x === 10175 || x === 11035 || x === 11036 || x === 11088 || x === 11093 || x >= 11904 && x <= 11929 || x >= 11931 && x <= 12019 || x >= 12032 && x <= 12245 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12353 && x <= 12438 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12773 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 42124 || x >= 42128 && x <= 42182 || x >= 43360 && x <= 43388 || x >= 44032 && x <= 55203 || x >= 63744 && x <= 64255 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 94176 && x <= 94180 || x >= 94192 && x <= 94198 || x >= 94208 && x <= 101589 || x >= 101631 && x <= 101662 || x >= 101760 && x <= 101874 || x >= 110576 && x <= 110579 || x >= 110581 && x <= 110587 || x === 110589 || x === 110590 || x >= 110592 && x <= 110882 || x === 110898 || x >= 110928 && x <= 110930 || x === 110933 || x >= 110948 && x <= 110951 || x >= 110960 && x <= 111355 || x >= 119552 && x <= 119638 || x >= 119648 && x <= 119670 || x === 126980 || x === 127183 || x === 127374 || x >= 127377 && x <= 127386 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x === 127568 || x === 127569 || x >= 127584 && x <= 127589 || x >= 127744 && x <= 127776 || x >= 127789 && x <= 127797 || x >= 127799 && x <= 127868 || x >= 127870 && x <= 127891 || x >= 127904 && x <= 127946 || x >= 127951 && x <= 127955 || x >= 127968 && x <= 127984 || x === 127988 || x >= 127992 && x <= 128062 || x === 128064 || x >= 128066 && x <= 128252 || x >= 128255 && x <= 128317 || x >= 128331 && x <= 128334 || x >= 128336 && x <= 128359 || x === 128378 || x === 128405 || x === 128406 || x === 128420 || x >= 128507 && x <= 128591 || x >= 128640 && x <= 128709 || x === 128716 || x >= 128720 && x <= 128722 || x >= 128725 && x <= 128728 || x >= 128732 && x <= 128735 || x === 128747 || x === 128748 || x >= 128756 && x <= 128764 || x >= 128992 && x <= 129003 || x === 129008 || x >= 129292 && x <= 129338 || x >= 129340 && x <= 129349 || x >= 129351 && x <= 129535 || x >= 129648 && x <= 129660 || x >= 129664 && x <= 129674 || x >= 129678 && x <= 129734 || x === 129736 || x >= 129741 && x <= 129756 || x >= 129759 && x <= 129770 || x >= 129775 && x <= 129784 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
}

// ../../node_modules/.bun/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// ../../node_modules/.bun/emoji-regex@10.6.0/node_modules/emoji-regex/index.mjs
var emoji_regex_default = () => {
  return /[#*0-9]\uFE0F?\u20E3|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26AA\u26B0\u26B1\u26BD\u26BE\u26C4\u26C8\u26CF\u26D1\u26E9\u26F0-\u26F5\u26F7\u26F8\u26FA\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B55\u3030\u303D\u3297\u3299]\uFE0F?|[\u261D\u270C\u270D](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\u270A\u270B](?:\uD83C[\uDFFB-\uDFFF])?|[\u23E9-\u23EC\u23F0\u23F3\u25FD\u2693\u26A1\u26AB\u26C5\u26CE\u26D4\u26EA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2795-\u2797\u27B0\u27BF\u2B50]|\u26D3\uFE0F?(?:\u200D\uD83D\uDCA5)?|\u26F9(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\u2764\uFE0F?(?:\u200D(?:\uD83D\uDD25|\uD83E\uDE79))?|\uD83C(?:[\uDC04\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]\uFE0F?|[\uDF85\uDFC2\uDFC7](?:\uD83C[\uDFFB-\uDFFF])?|[\uDFC4\uDFCA](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDFCB\uDFCC](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF43\uDF45-\uDF4A\uDF4C-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF7\uDDFA-\uDDFF]|\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uDDF4\uD83C\uDDF2|\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uDDF6\uD83C\uDDE6|\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF]|\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uDDFC\uD83C[\uDDEB\uDDF8]|\uDDFD\uD83C\uDDF0|\uDDFE\uD83C[\uDDEA\uDDF9]|\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uDF44(?:\u200D\uD83D\uDFEB)?|\uDF4B(?:\u200D\uD83D\uDFE9)?|\uDFC3(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDFF3\uFE0F?(?:\u200D(?:\u26A7\uFE0F?|\uD83C\uDF08))?|\uDFF4(?:\u200D\u2620\uFE0F?|\uDB40\uDC67\uDB40\uDC62\uDB40(?:\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDC73\uDB40\uDC63\uDB40\uDC74|\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F)?)|\uD83D(?:[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3]\uFE0F?|[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC](?:\uD83C[\uDFFB-\uDFFF])?|[\uDC6E-\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4\uDEB5](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD74\uDD90](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC25\uDC27-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE41\uDE43\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED8\uDEDC-\uDEDF\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB\uDFF0]|\uDC08(?:\u200D\u2B1B)?|\uDC15(?:\u200D\uD83E\uDDBA)?|\uDC26(?:\u200D(?:\u2B1B|\uD83D\uDD25))?|\uDC3B(?:\u200D\u2744\uFE0F?)?|\uDC41\uFE0F?(?:\u200D\uD83D\uDDE8\uFE0F?)?|\uDC68(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDC68\uDC69]\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?))?|\uDC69(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?[\uDC68\uDC69]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?|\uDC69\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?))|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFC-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFD-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFD\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFE]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])))?))?|\uDD75(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDE2E(?:\u200D\uD83D\uDCA8)?|\uDE35(?:\u200D\uD83D\uDCAB)?|\uDE36(?:\u200D\uD83C\uDF2B\uFE0F?)?|\uDE42(?:\u200D[\u2194\u2195]\uFE0F?)?|\uDEB6(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?)|\uD83E(?:[\uDD0C\uDD0F\uDD18-\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5\uDEC3-\uDEC5\uDEF0\uDEF2-\uDEF8](?:\uD83C[\uDFFB-\uDFFF])?|[\uDD26\uDD35\uDD37-\uDD39\uDD3C-\uDD3E\uDDB8\uDDB9\uDDCD\uDDCF\uDDD4\uDDD6-\uDDDD](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDDDE\uDDDF](?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD0D\uDD0E\uDD10-\uDD17\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCC\uDDD0\uDDE0-\uDDFF\uDE70-\uDE7C\uDE80-\uDE8A\uDE8E-\uDEC2\uDEC6\uDEC8\uDECD-\uDEDC\uDEDF-\uDEEA\uDEEF]|\uDDCE(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDDD1(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1|\uDDD1\u200D\uD83E\uDDD2(?:\u200D\uD83E\uDDD2)?|\uDDD2(?:\u200D\uD83E\uDDD2)?))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])))?))?|\uDEF1(?:\uD83C(?:\uDFFB(?:\u200D\uD83E\uDEF2\uD83C[\uDFFC-\uDFFF])?|\uDFFC(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFD-\uDFFF])?|\uDFFD(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])?|\uDFFE(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFD\uDFFF])?|\uDFFF(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFE])?))?)/g;
};

// ../../node_modules/.bun/string-width@7.2.0/node_modules/string-width/index.js
var segmenter = new Intl.Segmenter;
var defaultIgnorableCodePointRegex = /^\p{Default_Ignorable_Code_Point}$/u;
function stringWidth(string, options = {}) {
  if (typeof string !== "string" || string.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  if (!countAnsiEscapeCodes) {
    string = stripAnsi(string);
  }
  if (string.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment: character } of segmenter.segment(string)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) {
      continue;
    }
    if (codePoint >= 8203 && codePoint <= 8207 || codePoint === 65279) {
      continue;
    }
    if (codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071) {
      continue;
    }
    if (codePoint >= 55296 && codePoint <= 57343) {
      continue;
    }
    if (codePoint >= 65024 && codePoint <= 65039) {
      continue;
    }
    if (defaultIgnorableCodePointRegex.test(character)) {
      continue;
    }
    if (emoji_regex_default().test(character)) {
      width += 2;
      continue;
    }
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
  }
  return width;
}

// src/platform/assets.ts
import { statSync } from "fs";
import { isAbsolute, join } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/lib/singleton.ts
var singletonCacheSymbol = Symbol.for("@opentui/core/singleton");
function singleton(key, factory) {
  const bag = globalThis[singletonCacheSymbol] ??= {};
  if (!(key in bag)) {
    bag[key] = factory();
  }
  return bag[key];
}
function getSingleton(key) {
  const bag = globalThis[singletonCacheSymbol];
  return bag?.[key];
}
function destroySingleton(key) {
  const bag = globalThis[singletonCacheSymbol];
  if (bag && key in bag) {
    delete bag[key];
  }
}

// src/lib/env.ts
var envRegistry = singleton("env-registry", () => ({}));
function registerEnvVar(config) {
  const existing = envRegistry[config.name];
  if (existing) {
    if (existing.description !== config.description || existing.type !== config.type || existing.default !== config.default) {
      throw new Error(`Environment variable "${config.name}" is already registered with different configuration. ` + `Existing: ${JSON.stringify(existing)}, New: ${JSON.stringify(config)}`);
    }
    return;
  }
  envRegistry[config.name] = config;
}
function normalizeBoolean(value) {
  const lowerValue = value.toLowerCase();
  return ["true", "1", "on", "yes"].includes(lowerValue);
}
function parseEnvValue(config) {
  const envValue = process.env[config.name];
  if (envValue === undefined && config.default !== undefined) {
    return config.default;
  }
  if (envValue === undefined) {
    throw new Error(`Required environment variable ${config.name} is not set. ${config.description}`);
  }
  switch (config.type) {
    case "boolean":
      return typeof envValue === "boolean" ? envValue : normalizeBoolean(envValue);
    case "number":
      const numValue = Number(envValue);
      if (isNaN(numValue)) {
        throw new Error(`Environment variable ${config.name} must be a valid number, got: ${envValue}`);
      }
      return numValue;
    case "string":
    default:
      return envValue;
  }
}

class EnvStore {
  parsedValues = new Map;
  get(key) {
    if (this.parsedValues.has(key)) {
      return this.parsedValues.get(key);
    }
    if (!(key in envRegistry)) {
      throw new Error(`Environment variable ${key} is not registered.`);
    }
    try {
      const value = parseEnvValue(envRegistry[key]);
      this.parsedValues.set(key, value);
      return value;
    } catch (error) {
      throw new Error(`Failed to parse env var ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  has(key) {
    return key in envRegistry;
  }
  clearCache() {
    this.parsedValues.clear();
  }
}
var envStore = singleton("env-store", () => new EnvStore);
function clearEnvCache() {
  envStore.clearCache();
}
function generateEnvMarkdown() {
  const configs = Object.values(envRegistry);
  if (configs.length === 0) {
    return `# Environment Variables

No environment variables registered.
`;
  }
  let markdown = `# Environment Variables

`;
  for (const config of configs) {
    markdown += `## ${config.name}

`;
    markdown += `${config.description}

`;
    markdown += `**Type:** \`${config.type || "string"}\`  
`;
    if (config.default !== undefined) {
      const defaultValue = typeof config.default === "string" ? `"${config.default}"` : String(config.default);
      markdown += `**Default:** \`${defaultValue}\`
`;
    } else {
      markdown += `**Default:** *Required*
`;
    }
    markdown += `
`;
  }
  return markdown;
}
function generateEnvColored() {
  const configs = Object.values(envRegistry);
  if (configs.length === 0) {
    return `\x1B[1;36mEnvironment Variables\x1B[0m

No environment variables registered.
`;
  }
  let output = `\x1B[1;36mEnvironment Variables\x1B[0m

`;
  for (const config of configs) {
    output += `\x1B[1;33m${config.name}\x1B[0m
`;
    output += `${config.description}
`;
    output += `\x1B[32mType:\x1B[0m \x1B[36m${config.type || "string"}\x1B[0m
`;
    if (config.default !== undefined) {
      const defaultValue = typeof config.default === "string" ? `"${config.default}"` : String(config.default);
      output += `\x1B[32mDefault:\x1B[0m \x1B[35m${defaultValue}\x1B[0m
`;
    } else {
      output += `\x1B[32mDefault:\x1B[0m \x1B[31mRequired\x1B[0m
`;
    }
    output += `
`;
  }
  return output;
}
var env = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== "string") {
      return;
    }
    return envStore.get(prop);
  },
  has(target, prop) {
    return envStore.has(prop);
  },
  ownKeys() {
    return Object.keys(envRegistry);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (envStore.has(prop)) {
      return {
        enumerable: true,
        configurable: true,
        get: () => envStore.get(prop)
      };
    }
    return;
  }
});

// src/platform/assets.ts
registerEnvVar({
  name: "OTUI_ASSET_ROOT",
  description: "Absolute directory containing relocatable OpenTUI runtime assets",
  type: "string",
  default: ""
});
function resolveAssetPath(key, fallback) {
  validateAssetKey(key);
  const configuredPath = resolveAssetRootPath(key);
  if (configuredPath !== undefined) {
    return configuredPath;
  }
  if (fallback === undefined) {
    throw new Error(`OpenTUI asset ${JSON.stringify(key)} has no package-relative fallback`);
  }
  const value = typeof fallback === "function" ? fallback() : fallback;
  return value instanceof URL ? fileURLToPath2(value) : value;
}
function resolveAssetRootPath(key) {
  validateAssetKey(key);
  const root = process.env.OTUI_ASSET_ROOT;
  if (!root) {
    return;
  }
  if (!isAbsolute(root)) {
    throw new Error(`OTUI_ASSET_ROOT must be an absolute directory, got ${JSON.stringify(root)}`);
  }
  const assetPath = join(root, key);
  let isFile = false;
  try {
    isFile = statSync(assetPath).isFile();
  } catch {}
  if (!isFile) {
    throw new Error(`Missing OpenTUI asset ${JSON.stringify(key)} at ${JSON.stringify(assetPath)}`);
  }
  return assetPath;
}
function validateAssetKey(key) {
  if (key.length === 0 || isAbsolute(key) || key.includes("\\") || key.split("/").includes("..")) {
    throw new Error(`Invalid OpenTUI asset key: ${JSON.stringify(key)}`);
  }
}

// src/platform/runtime.ts
var TEXT_ENCODER = new TextEncoder;
var bun = globalThis.Bun;
var sleep = bun?.sleep ?? standardSleep;
var stringWidth2 = bun?.stringWidth ?? stringWidth;
var stripANSI = bun?.stripANSI ?? stripAnsi;
var writeFile = bun?.write ?? writeFilePortable;
async function resolveBundledFilePath(key, loadBundledFile, fallbackPath, metaUrl, options = {}) {
  if (options.useAssetRoot ?? true) {
    const configuredPath = resolveAssetRootPath(key);
    if (configuredPath !== undefined) {
      return configuredPath;
    }
  }
  if (!bun) {
    const path = resolveFallbackFilePath(fallbackPath, metaUrl);
    if (existsSync(path)) {
      return path;
    }
    return await loadBundledFilePath(loadBundledFile, metaUrl, options.loadBundledFileFallback ?? false) ?? path;
  }
  return normalizeLoadedFilePath((await loadBundledFile()).default, metaUrl);
}
function resolveFallbackFilePath(fallbackPath, metaUrl) {
  const path = typeof fallbackPath === "function" ? fallbackPath() : fallbackPath;
  return fileURLToPath3(path instanceof URL ? path : new URL(path, metaUrl));
}
function normalizeLoadedFilePath(loadedPath, baseUrl) {
  if (loadedPath.startsWith("file:")) {
    return fileURLToPath3(loadedPath);
  }
  if (isAbsolute2(loadedPath)) {
    return loadedPath;
  }
  return resolve(dirname(fileURLToPath3(baseUrl)), loadedPath);
}
async function loadBundledFilePath(loadBundledFile, metaUrl, loadBundledFileFallback) {
  const specifier = extractBundledImportSpecifier(loadBundledFile);
  if (!specifier) {
    if (!loadBundledFileFallback) {
      return;
    }
    try {
      return normalizeLoadedFilePath((await loadBundledFile()).default, metaUrl);
    } catch {
      return;
    }
  }
  try {
    const moduleUrl = new URL(specifier, metaUrl);
    const loaded = await import(moduleUrl.href);
    return normalizeLoadedFilePath(loaded.default, moduleUrl.href);
  } catch {
    return;
  }
}
function extractBundledImportSpecifier(loadBundledFile) {
  const match = String(loadBundledFile).match(/\bimport\(\s*(["'`])([^"'`]+)\1/);
  return match?.[2];
}
function standardSleep(msOrDate) {
  const ms = msOrDate instanceof Date ? msOrDate.getTime() - Date.now() : msOrDate;
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function writeFilePortable(destination, data, options) {
  const destinationPath = destination instanceof URL ? fileURLToPath3(destination) : destination;
  if (options?.createPath) {
    await mkdir(dirname(destinationPath), { recursive: true });
  }
  const bytes = typeof data === "string" ? TEXT_ENCODER.encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  await writeFileNode(destinationPath, bytes, { mode: options?.mode });
  return bytes.byteLength;
}

// src/zig.ts
import { existsSync as existsSync3, writeFileSync } from "fs";
import { EventEmitter as EventEmitter4 } from "events";

// src/lib/RGBA.ts
var DEFAULT_FOREGROUND_RGB = [255, 255, 255];
var DEFAULT_BACKGROUND_RGB = [0, 0, 0];
var INTENT_RGB = 0;
var INTENT_INDEXED = 1;
var INTENT_DEFAULT = 2;
var ANSI16_RGB = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255]
];
var ANSI_256_CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
function packMeta(intent, slot = 0) {
  return (slot & 255 | (intent & 255) << 8) >>> 0;
}
function toU8(value) {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255);
}
function toByte(value) {
  return Math.round(Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0)));
}
function packRGBA8(r, g, b, a, meta) {
  return new Uint16Array([
    toByte(r) & 255 | (meta >>> 0 & 255) << 8,
    toByte(g) & 255 | (meta >>> 8 & 255) << 8,
    toByte(b) & 255 | (meta >>> 16 & 255) << 8,
    toByte(a) & 255 | (meta >>> 24 & 255) << 8
  ]);
}
function rgbaForAnsi256Index(index) {
  const [r, g, b] = ansi256IndexToRgb(index);
  return RGBA.fromInts(r, g, b);
}
function normalizeIndexedColorIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new RangeError(`Indexed color must be an integer in the range 0..255, got ${index}`);
  }
  return index;
}
function ansi256IndexToRgb(index) {
  const normalizedIndex = normalizeIndexedColorIndex(index);
  if (normalizedIndex < ANSI16_RGB.length) {
    return ANSI16_RGB[normalizedIndex];
  }
  if (normalizedIndex < 232) {
    const cubeIndex = normalizedIndex - 16;
    const r = Math.floor(cubeIndex / 36);
    const g = Math.floor(cubeIndex / 6) % 6;
    const b = cubeIndex % 6;
    return [ANSI_256_CUBE_LEVELS[r], ANSI_256_CUBE_LEVELS[g], ANSI_256_CUBE_LEVELS[b]];
  }
  const value = 8 + (normalizedIndex - 232) * 10;
  return [value, value, value];
}

class RGBA {
  buffer;
  constructor(buffer) {
    this.buffer = new Uint16Array(4);
    this.buffer.set(buffer.subarray(0, 4));
  }
  static fromArray(array) {
    return new RGBA(array);
  }
  static fromValues(r, g, b, a = 1) {
    return new RGBA(packRGBA8(toU8(r), toU8(g), toU8(b), toU8(a), packMeta(INTENT_RGB)));
  }
  static clone(rgba) {
    return new RGBA(rgba.buffer);
  }
  static fromInts(r, g, b, a = 255) {
    return new RGBA(packRGBA8(r, g, b, a, packMeta(INTENT_RGB)));
  }
  static fromHex(hex) {
    return hexToRgb(hex);
  }
  static fromIndex(index, snapshot) {
    const normalized = normalizeIndexedColorIndex(index);
    const rgba = snapshot ? parseColor(snapshot) : rgbaForAnsi256Index(normalized);
    const [r, g, b, a] = rgba.toInts();
    return new RGBA(packRGBA8(r, g, b, a, packMeta(INTENT_INDEXED, normalized)));
  }
  static defaultForeground(snapshot) {
    const rgba = snapshot ? parseColor(snapshot) : RGBA.fromInts(...DEFAULT_FOREGROUND_RGB);
    const [r, g, b, a] = rgba.toInts();
    return new RGBA(packRGBA8(r, g, b, a, packMeta(INTENT_DEFAULT)));
  }
  static defaultBackground(snapshot) {
    const rgba = snapshot ? parseColor(snapshot) : RGBA.fromInts(...DEFAULT_BACKGROUND_RGB);
    const [r, g, b, a] = rgba.toInts();
    return new RGBA(packRGBA8(r, g, b, a, packMeta(INTENT_DEFAULT)));
  }
  toInts() {
    return [this.buffer[0] & 255, this.buffer[1] & 255, this.buffer[2] & 255, this.buffer[3] & 255];
  }
  get r() {
    return (this.buffer[0] & 255) / 255;
  }
  set r(value) {
    this.buffer[0] = this.buffer[0] & 65280 | toU8(value);
  }
  get g() {
    return (this.buffer[1] & 255) / 255;
  }
  set g(value) {
    this.buffer[1] = this.buffer[1] & 65280 | toU8(value);
  }
  get b() {
    return (this.buffer[2] & 255) / 255;
  }
  set b(value) {
    this.buffer[2] = this.buffer[2] & 65280 | toU8(value);
  }
  get a() {
    return (this.buffer[3] & 255) / 255;
  }
  set a(value) {
    this.buffer[3] = this.buffer[3] & 65280 | toU8(value);
  }
  get meta() {
    return (this.buffer[0] >>> 8 | this.buffer[1] >>> 8 << 8 | this.buffer[2] >>> 8 << 16 | this.buffer[3] >>> 8 << 24) >>> 0;
  }
  get intent() {
    switch (this.meta >>> 8 & 255) {
      case INTENT_INDEXED:
        return "indexed";
      case INTENT_DEFAULT:
        return "default";
      default:
        return "rgb";
    }
  }
  get slot() {
    return this.meta & 255;
  }
  map(fn) {
    return [fn(this.r), fn(this.g), fn(this.b), fn(this.a)];
  }
  toString() {
    return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`;
  }
  equals(other) {
    if (!other)
      return false;
    return this.buffer[0] === other.buffer[0] && this.buffer[1] === other.buffer[1] && this.buffer[2] === other.buffer[2] && this.buffer[3] === other.buffer[3];
  }
}
function normalizeColorValue(value) {
  if (value == null)
    return null;
  return { rgba: parseColor(value) };
}
function hexToRgb(hex) {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  } else if (hex.length === 4) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[0-9A-Fa-f]{8}$/.test(hex)) {
    console.warn(`Invalid hex color: ${hex}, defaulting to magenta`);
    return RGBA.fromValues(1, 0, 1, 1);
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) : 255;
  return RGBA.fromInts(r, g, b, a);
}
function rgbToHex(rgb) {
  const [r, g, b, a] = rgb.toInts();
  const components = a === 255 ? [r, g, b] : [r, g, b, a];
  return "#" + components.map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hsvToRgb(h, s, v) {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return RGBA.fromValues(r, g, b, 1);
}
var CSS_COLOR_NAMES = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  silver: "#C0C0C0",
  gray: "#808080",
  grey: "#808080",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00FF00",
  aqua: "#00FFFF",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#FF00FF",
  purple: "#800080",
  orange: "#FFA500",
  brightblack: "#666666",
  brightred: "#FF6666",
  brightgreen: "#66FF66",
  brightblue: "#6666FF",
  brightyellow: "#FFFF66",
  brightcyan: "#66FFFF",
  brightmagenta: "#FF66FF",
  brightwhite: "#FFFFFF"
};
function parseColor(color) {
  if (typeof color === "string") {
    const lowerColor = color.toLowerCase();
    if (lowerColor === "transparent") {
      return RGBA.fromValues(0, 0, 0, 0);
    }
    if (CSS_COLOR_NAMES[lowerColor]) {
      return hexToRgb(CSS_COLOR_NAMES[lowerColor]);
    }
    return hexToRgb(color);
  }
  return color;
}

// src/lib/border.ts
var VALID_BORDER_STYLES = ["single", "double", "rounded", "heavy"];
function isValidBorderStyle(value) {
  return typeof value === "string" && VALID_BORDER_STYLES.includes(value);
}
function parseBorderStyle(value, fallback = "single") {
  if (isValidBorderStyle(value)) {
    return value;
  }
  if (value !== undefined && value !== null) {
    console.warn(`Invalid borderStyle "${value}", falling back to "${fallback}". Valid values are: ${VALID_BORDER_STYLES.join(", ")}`);
  }
  return fallback;
}
var BorderChars = {
  single: {
    topLeft: "\u250C",
    topRight: "\u2510",
    bottomLeft: "\u2514",
    bottomRight: "\u2518",
    horizontal: "\u2500",
    vertical: "\u2502",
    topT: "\u252C",
    bottomT: "\u2534",
    leftT: "\u251C",
    rightT: "\u2524",
    cross: "\u253C"
  },
  double: {
    topLeft: "\u2554",
    topRight: "\u2557",
    bottomLeft: "\u255A",
    bottomRight: "\u255D",
    horizontal: "\u2550",
    vertical: "\u2551",
    topT: "\u2566",
    bottomT: "\u2569",
    leftT: "\u2560",
    rightT: "\u2563",
    cross: "\u256C"
  },
  rounded: {
    topLeft: "\u256D",
    topRight: "\u256E",
    bottomLeft: "\u2570",
    bottomRight: "\u256F",
    horizontal: "\u2500",
    vertical: "\u2502",
    topT: "\u252C",
    bottomT: "\u2534",
    leftT: "\u251C",
    rightT: "\u2524",
    cross: "\u253C"
  },
  heavy: {
    topLeft: "\u250F",
    topRight: "\u2513",
    bottomLeft: "\u2517",
    bottomRight: "\u251B",
    horizontal: "\u2501",
    vertical: "\u2503",
    topT: "\u2533",
    bottomT: "\u253B",
    leftT: "\u2523",
    rightT: "\u252B",
    cross: "\u254B"
  }
};
function getBorderFromSides(sides) {
  const result = [];
  if (sides.top)
    result.push("top");
  if (sides.right)
    result.push("right");
  if (sides.bottom)
    result.push("bottom");
  if (sides.left)
    result.push("left");
  return result.length > 0 ? result : false;
}
function getBorderSides(border) {
  return border === true ? { top: true, right: true, bottom: true, left: true } : Array.isArray(border) ? {
    top: border.includes("top"),
    right: border.includes("right"),
    bottom: border.includes("bottom"),
    left: border.includes("left")
  } : { top: false, right: false, bottom: false, left: false };
}
function borderCharsToArray(chars) {
  const array = new Uint32Array(11);
  array[0] = chars.topLeft.codePointAt(0);
  array[1] = chars.topRight.codePointAt(0);
  array[2] = chars.bottomLeft.codePointAt(0);
  array[3] = chars.bottomRight.codePointAt(0);
  array[4] = chars.horizontal.codePointAt(0);
  array[5] = chars.vertical.codePointAt(0);
  array[6] = chars.topT.codePointAt(0);
  array[7] = chars.bottomT.codePointAt(0);
  array[8] = chars.leftT.codePointAt(0);
  array[9] = chars.rightT.codePointAt(0);
  array[10] = chars.cross.codePointAt(0);
  return array;
}
var BorderCharArrays = {
  single: borderCharsToArray(BorderChars.single),
  double: borderCharsToArray(BorderChars.double),
  rounded: borderCharsToArray(BorderChars.rounded),
  heavy: borderCharsToArray(BorderChars.heavy)
};
// src/lib/KeyHandler.ts
import { EventEmitter } from "events";

class KeyEvent {
  name;
  ctrl;
  meta;
  shift;
  option;
  sequence;
  number;
  raw;
  eventType;
  source;
  code;
  super;
  hyper;
  capsLock;
  numLock;
  baseCode;
  repeated;
  _defaultPrevented = false;
  _propagationStopped = false;
  constructor(key) {
    this.name = key.name;
    this.ctrl = key.ctrl;
    this.meta = key.meta;
    this.shift = key.shift;
    this.option = key.option;
    this.sequence = key.sequence;
    this.number = key.number;
    this.raw = key.raw;
    this.eventType = key.eventType;
    this.source = key.source;
    this.code = key.code;
    this.super = key.super;
    this.hyper = key.hyper;
    this.capsLock = key.capsLock;
    this.numLock = key.numLock;
    this.baseCode = key.baseCode;
    this.repeated = key.repeated;
  }
  get defaultPrevented() {
    return this._defaultPrevented;
  }
  get propagationStopped() {
    return this._propagationStopped;
  }
  preventDefault() {
    this._defaultPrevented = true;
  }
  stopPropagation() {
    this._propagationStopped = true;
  }
}

class PasteEvent {
  type = "paste";
  bytes;
  metadata;
  _defaultPrevented = false;
  _propagationStopped = false;
  constructor(bytes, metadata) {
    this.bytes = bytes;
    this.metadata = metadata;
  }
  get defaultPrevented() {
    return this._defaultPrevented;
  }
  get propagationStopped() {
    return this._propagationStopped;
  }
  preventDefault() {
    this._defaultPrevented = true;
  }
  stopPropagation() {
    this._propagationStopped = true;
  }
}

class KeyHandler extends EventEmitter {
  processParsedKey(parsedKey) {
    try {
      switch (parsedKey.eventType) {
        case "press":
          this.emit("keypress", new KeyEvent(parsedKey));
          break;
        case "release":
          this.emit("keyrelease", new KeyEvent(parsedKey));
          break;
        default:
          this.emit("keypress", new KeyEvent(parsedKey));
          break;
      }
    } catch (error) {
      console.error(`[KeyHandler] Error processing parsed key:`, error);
      return true;
    }
    return true;
  }
  processPaste(bytes, metadata) {
    try {
      this.emit("paste", new PasteEvent(bytes, metadata));
    } catch (error) {
      console.error(`[KeyHandler] Error processing paste:`, error);
    }
  }
}

class InternalKeyHandler extends KeyHandler {
  renderableHandlers = new Map;
  emit(event, ...args) {
    return this.emitWithPriority(event, ...args);
  }
  emitWithPriority(event, ...args) {
    let hasGlobalListeners = false;
    const globalListeners = this.listeners(event);
    if (globalListeners.length > 0) {
      hasGlobalListeners = true;
      for (const listener of globalListeners) {
        try {
          listener(...args);
        } catch (error) {
          console.error(`[KeyHandler] Error in global ${event} handler:`, error);
        }
        if (event === "keypress" || event === "keyrelease" || event === "paste") {
          const keyEvent = args[0];
          if (keyEvent.propagationStopped) {
            return hasGlobalListeners;
          }
        }
      }
    }
    const renderableSet = this.renderableHandlers.get(event);
    const renderableHandlers = renderableSet && renderableSet.size > 0 ? [...renderableSet] : [];
    let hasRenderableListeners = false;
    if (renderableSet && renderableSet.size > 0) {
      hasRenderableListeners = true;
      if (event === "keypress" || event === "keyrelease" || event === "paste") {
        const keyEvent = args[0];
        if (keyEvent.defaultPrevented)
          return hasGlobalListeners || hasRenderableListeners;
        if (keyEvent.propagationStopped)
          return hasGlobalListeners || hasRenderableListeners;
      }
      for (const handler of renderableHandlers) {
        try {
          handler(...args);
        } catch (error) {
          console.error(`[KeyHandler] Error in renderable ${event} handler:`, error);
        }
        if (event === "keypress" || event === "keyrelease" || event === "paste") {
          const keyEvent = args[0];
          if (keyEvent.propagationStopped) {
            return hasGlobalListeners || hasRenderableListeners;
          }
        }
      }
    }
    return hasGlobalListeners || hasRenderableListeners;
  }
  onInternal(event, handler) {
    if (!this.renderableHandlers.has(event)) {
      this.renderableHandlers.set(event, new Set);
    }
    this.renderableHandlers.get(event).add(handler);
  }
  offInternal(event, handler) {
    const handlers = this.renderableHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }
}
// src/lib/fonts/block.json
var block_default = {
  name: "block",
  version: "0.2.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 2,
  lines: 6,
  buffer: ["", "", "", "", "", ""],
  letterspace: [" ", " ", " ", " ", " ", " "],
  letterspace_size: 1,
  chars: {
    A: [
      " <c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2> ",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D  \u255A\u2550\u255D</c2>"
    ],
    B: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    C: [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    D: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    E: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557  </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u255D  </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    F: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557  </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u255D  </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c2>\u255A\u2550\u255D     </c2>"
    ],
    G: [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    H: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>  \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D  \u255A\u2550\u255D</c2>"
    ],
    I: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D</c2>"
    ],
    J: [
      "<c1>     \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>     \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>     \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    K: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>  \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1> \u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u255D  \u255A\u2550\u255D</c2>"
    ],
    L: [
      "<c1>\u2588\u2588</c1><c2>\u2557     </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    M: [
      "<c1>\u2588\u2588\u2588</c1><c2>\u2557</c2><c1>   \u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2><c1> \u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2554</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551\u255A</c2><c1>\u2588\u2588</c1><c2>\u2554\u255D</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551 \u255A\u2550\u255D</c2><c1> \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D     \u255A\u2550\u255D</c2>"
    ],
    N: [
      "<c1>\u2588\u2588\u2588</c1><c2>\u2557</c2><c1>   \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554</c2><c1>\u2588\u2588</c1><c2>\u2557</c2><c1> \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551\u255A</c2><c1>\u2588\u2588</c1><c2>\u2557</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551 \u255A</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D</c2>"
    ],
    O: [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    P: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u255D </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551     </c2>",
      "<c2>\u255A\u2550\u255D     </c2>"
    ],
    Q: [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>\u2584\u2584 \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550</c2><c1>\u2580\u2580</c1><c2>\u2550\u255D </c2>"
    ],
    R: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D  \u255A\u2550\u255D</c2>"
    ],
    S: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    T: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u255D</c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2551   </c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2551   </c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2551   </c2>",
      "<c2>   \u255A\u2550\u255D   </c2>"
    ],
    U: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>   \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    V: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>   \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>   \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2557</c2><c1> \u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D </c2>",
      "<c2>  \u255A\u2550\u2550\u2550\u255D  </c2>"
    ],
    W: [
      "<c1>\u2588\u2588</c1><c2>\u2557    </c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551    </c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1> \u2588</c1><c2>\u2557</c2><c1> \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>\u2588\u2588\u2588</c1><c2>\u2557</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588</c1><c2>\u2554</c2><c1>\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u255D\u255A\u2550\u2550\u255D </c2>"
    ],
    X: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>  \u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2557</c2><c1>\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A</c2><c1>\u2588\u2588\u2588</c1><c2>\u2554\u255D </c2>",
      " <c1>\u2588\u2588</c1><c2>\u2554</c2><c1>\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u255D</c2><c1> \u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u255D  \u255A\u2550\u255D</c2>"
    ],
    Y: [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>   \u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2557</c2><c1> \u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D </c2>",
      "<c2>  \u255A</c2><c1>\u2588\u2588</c1><c2>\u2554\u255D  </c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2551   </c2>",
      "<c2>   \u255A\u2550\u255D   </c2>"
    ],
    Z: [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550</c2><c1>\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>  \u2588\u2588\u2588</c1><c2>\u2554\u255D </c2>",
      " <c1>\u2588\u2588\u2588</c1><c2>\u2554\u255D  </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    "0": [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>\u2588\u2588</c1><c2>\u2554</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    "1": [
      " <c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      " <c1>\u2588\u2588</c1><c2>\u2551</c2>",
      " <c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2> \u255A\u2550\u255D</c2>"
    ],
    "2": [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      " <c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u255D </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    "3": [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      " <c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    "4": [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1>  \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>  \u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>     \u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>     \u255A\u2550\u255D</c2>"
    ],
    "5": [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"
    ],
    "6": [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    "7": [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>    \u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2554\u255D </c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2551  </c2>",
      "<c2>   \u255A\u2550\u255D  </c2>"
    ],
    "8": [
      " <c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    "9": [
      " <c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2> \u255A\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      " <c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u2550\u2550\u2550\u255D </c2>"
    ],
    "!": [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u255D</c2>"
    ],
    "?": [
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>  \u2584\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>  \u2580\u2580</c1><c2>\u2550\u2550\u255D </c2>",
      "<c1>  \u2588\u2588</c1><c2>\u2557   </c2>",
      "<c2>  \u255A\u2550\u255D   </c2>"
    ],
    ".": ["   ", "   ", "   ", "   ", "<c1>\u2588\u2588</c1><c2>\u2557</c2>", "<c2>\u255A\u2550\u255D</c2>"],
    "+": [
      "       ",
      "<c1>  \u2588\u2588</c1><c2>\u2557  </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2> \u255A</c2><c1>\u2588\u2588</c1><c2>\u2554\u2550\u255D</c2>",
      "<c2>  \u255A\u2550\u255D  </c2>",
      "       "
    ],
    "-": ["      ", "      ", "<c1>\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>", "<c2>\u255A\u2550\u2550\u2550\u2550\u255D</c2>", "      ", "      "],
    _: ["        ", "        ", "        ", "        ", "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>", "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D</c2>"],
    "=": [
      "       ",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u255D</c2>",
      "       "
    ],
    "@": [
      " <c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>\u2588\u2588</c1><c2>\u2557</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551</c2><c1>\u2588\u2588</c1><c2>\u2551</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A</c2><c1>\u2588</c1><c2>\u2551</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u255D\u255A\u2550\u2550\u2550\u255D </c2>"
    ],
    "#": [
      " <c1>\u2588\u2588</c1><c2>\u2557</c2><c1> \u2588\u2588</c1><c2>\u2557 </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2554\u2550</c2><c1>\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2554\u2550</c2><c1>\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2> \u255A\u2550\u255D \u255A\u2550\u255D </c2>"
    ],
    $: [
      "<c1>\u2584\u2584\u2588\u2588\u2588\u2584\u2584</c1><c2>\xB7</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550\u2550\u2550\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550</c2><c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551</c2>",
      "<c2>\u255A\u2550</c2><c1>\u2580\u2580\u2580</c1><c2>\u2550\u2550\u255D</c2>"
    ],
    "%": [
      "<c1>\u2588\u2588</c1><c2>\u2557</c2><c1> \u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u255D</c2><c1>\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>  \u2588\u2588</c1><c2>\u2554\u255D </c2>",
      " <c1>\u2588\u2588</c1><c2>\u2554\u255D  </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u255D</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2>\u255A\u2550\u255D \u255A\u2550\u255D</c2>"
    ],
    "&": [
      "<c1>   \u2588\u2588</c1><c2>\u2557   </c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2551   </c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u2550</c2><c1>\u2588\u2588</c1><c2>\u2554\u2550\u255D</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2551  </c2>",
      "<c2>\u255A\u2550\u2550\u2550\u2550\u2550\u255D  </c2>"
    ],
    "(": [
      " <c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2551 ",
      "<c1>\u2588\u2588</c1><c2>\u2551 ",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      "<c2> \u255A\u2550\u255D</c2>"
    ],
    ")": [
      "<c1>\u2588\u2588</c1><c2>\u2557 </c2>",
      "<c2>\u255A</c2><c1>\u2588\u2588</c1><c2>\u2557</c2>",
      " <c1>\u2588\u2588</c1><c2>\u2551</c2>",
      " <c1>\u2588\u2588</c1><c2>\u2551</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c2>\u255A\u2550\u255D </c2>"
    ],
    "/": [
      "<c1>    \u2588\u2588</c1><c2>\u2557</c2>",
      "<c1>   \u2588\u2588</c1><c2>\u2554\u255D</c2>",
      "<c1>  \u2588\u2588</c1><c2>\u2554\u255D </c2>",
      " <c1>\u2588\u2588</c1><c2>\u2554\u255D  </c2>",
      "<c1>\u2588\u2588</c1><c2>\u2554\u255D   </c2>",
      "<c2>\u255A\u2550\u255D    </c2>"
    ],
    ":": ["   ", "<c1>\u2588\u2588</c1><c2>\u2557</c2>", "<c2>\u255A\u2550\u255D</c2>", "<c1>\u2588\u2588</c1><c2>\u2557</c2>", "<c2>\u255A\u2550\u255D</c2>", "   "],
    ";": ["   ", "   ", "<c1>\u2588\u2588</c1><c2>\u2557</c2>", "<c2>\u255A\u2550\u255D</c2>", "<c1>\u2584\u2588</c1><c2>\u2557</c2>", "<c1>\u2580</c1><c2>\u2550\u255D</c2>"],
    ",": ["   ", "   ", "   ", "   ", "<c1>\u2584\u2588</c1><c2>\u2557</c2>", "<c1>\u2580</c1><c2>\u2550\u255D</c2>"],
    "'": ["<c1>\u2588</c1><c2>\u2557</c2> ", "<c2>\u255A\u255D</c2> ", "   ", "   ", "   ", "   "],
    '"': ["<c1>\u2588</c1><c2>\u2557</c2><c1>\u2588</c1><c2>\u2557</c2> ", "<c2>\u255A\u255D\u255A\u255D</c2> ", "     ", "     ", "     ", "     "],
    " ": ["   ", "   ", "   ", "   ", "   ", "   "]
  }
};
// src/lib/fonts/shade.json
var shade_default = {
  name: "shade",
  version: "0.2.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 2,
  lines: 8,
  buffer: ["", "", "", "", "", "", "", ""],
  letterspace: [
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>",
    "<c2>\u2591</c2>"
  ],
  letterspace_size: 1,
  chars: {
    A: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    B: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    C: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    D: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    E: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588</c1>  <c2>\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    F: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588</c1>  <c2>\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      " <c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    G: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u2588\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2> <c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    H: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    I: [
      "<c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1>",
      " <c1>\u2588</c1> ",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1>",
      "   ",
      "<c2>\u2591\u2591\u2591</c2>"
    ],
    J: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "  <c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    K: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    L: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    M: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    N: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588</c1><c2>\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588 \u2588\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2> <c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    O: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    P: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "<c1>\u2588</c1>  <c2>\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      " <c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    Q: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c1>\u2588\u2588\u2588</c1>",
      "<c2>\u2591</c2>   ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    R: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    S: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      " <c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2>  <c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    T: [
      "<c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1>",
      " <c1>\u2588</c1> ",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591 \u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>"
    ],
    U: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    V: [
      "<c2>\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      " <c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1> ",
      "<c2>\u2591</c2> <c1>\u2588</c1> <c2>\u2591</c2>",
      "<c2>\u2591\u2591 \u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591\u2591</c2>"
    ],
    W: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588  \u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    X: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588</c1>",
      " <c2>\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    Y: [
      "<c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1>",
      " <c1>\u2588</c1> ",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591 \u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>"
    ],
    Z: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "  <c1>\u2588</c1> ",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>",
      "<c1>\u2588</c1> <c2>\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "0": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u258C\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2> <c1>\u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "1": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588</c1><c2>\u2591\u2591</c2>",
      " <c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "2": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2590\u2588\u2588</c1><c2>\u2591</c2>",
      "   <c1>\u2588</c1>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1> ",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "3": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "   <c1>\u2588</c1>",
      "<c2>\u2591\u2591</c2><c1>\u2588\u2588</c1>",
      "<c2>\u2591\u2591</c2> <c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "4": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "   <c1>\u2588</c1>",
      "<c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      "<c2>\u2591\u2591\u2591</c2> ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "5": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "   <c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "   <c2>\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "6": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588\u2588</c1>",
      "<c1>\u2588</c1>   ",
      "<c1>\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "7": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "   <c1>\u2588</c1>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      " <c1>\u2588</c1>  ",
      "<c1>\u2588</c1> <c2>\u2591\u2591</c2>",
      " <c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "8": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c1>\u2588  \u2588</c1>",
      " <c1>\u2588\u2588</c1> ",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "9": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      " <c1>\u2588\u2588\u2588</c1>",
      "<c2>\u2591</c2>  <c1>\u2588</c1>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1> ",
      "<c2>\u2591\u2591 \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "!": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "?": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2590\u2588\u2588</c1><c2>\u2591</c2>",
      "   <c1>\u2588</c1>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1> ",
      "<c2>\u2591\u2591 \u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591\u2591 \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    ".": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591\u2591 \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "+": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588\u2588</c1>",
      "<c2>\u2591</c2> <c1>\u2588</c1> ",
      "<c2>\u2591\u2591 \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "-": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    _: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    "
    ],
    "=": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "@": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c1>\u2588  \u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u258C\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1> ",
      " <c1>\u2588\u2588\u2588</c1>",
      "    ",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    "#": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      " <c1>\u258C\u2590</c1> ",
      "<c1>\u2588\u2588\u2588\u2588</c1>",
      " <c1>\u258C\u2590</c1> ",
      "<c2>\u2591  \u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    $: [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u258C</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588\u2588\u2588</c1>",
      "<c1>\u2588 \u2588</c1> ",
      " <c1>\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u258C\u2588</c1>",
      "<c1>\u2588\u2588\u2588</c1> ",
      "   <c2>\u2591</c2>"
    ],
    "%": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1> ",
      " <c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1>",
      "<c1>\u2588</c1> <c2>\u2591</c2> ",
      " <c2>\u2591\u2591\u2591</c2>"
    ],
    "&": [
      "<c2>\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      "<c1>\u2588\u2588\u2588\u2588\u2588</c1>",
      "<c1>\u2588  \u2588</c1> ",
      "<c1>\u2588\u2588\u2588\u2588</c1><c2>\u2591</c2>",
      "<c2>    </c2> ",
      "<c2>\u2591\u2591\u2591\u2591\u2591</c2>"
    ],
    "(": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>",
      "<c1>\u2588</c1> <c2>\u2591\u2591</c2>",
      "<c1>\u2588</c1><c2>\u2591\u2591\u2591</c2>",
      " <c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591</c2> <c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591\u2591 \u2591</c2>"
    ],
    ")": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591</c2> <c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591\u2591</c2> <c1>\u2588</c1>",
      "<c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1> ",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>",
      "<c2>\u2591 \u2591\u2591</c2>"
    ],
    "/": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2><c1>\u2588</c1>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1> ",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c1>\u2588</c1> <c2>\u2591\u2591</c2>",
      " <c2>\u2591\u2591\u2591</c2>"
    ],
    ":": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591 \u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591 \u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    ";": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591 \u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>"
    ],
    ",": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591</c2><c1>\u2588</c1><c2>\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1> <c2>\u2591</c2>"
    ],
    "'": [
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591 \u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591</c2>"
    ],
    '"': [
      "<c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2><c1>\u2588</c1><c2>\u2591\u2591</c2>",
      "<c2>\u2591 \u2591 \u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2>"
    ],
    " ": [
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>",
      "<c2>\u2591\u2591\u2591</c2>"
    ]
  }
};
// src/lib/fonts/slick.json
var slick_default = {
  name: "slick",
  version: "0.1.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 2,
  lines: 6,
  buffer: ["", "", "", "", "", ""],
  letterspace: ["<c2>\u2571</c2>", "<c2>\u2571</c2>", "<c2>\u2571</c2>", "<c2>\u2571</c2>", "<c2>\u2571</c2>", "<c2>\u2571</c2>"],
  letterspace_size: 1,
  chars: {
    A: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2570\u256F</c1><c2>\u2571</c2><c1>\u2570\u256F</c1>"
    ],
    B: [
      "<c1>\u256D\u2501\u2501\u256E</c1><c2>\u2571</c2>",
      "<c1>\u2503\u256D\u256E\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2570\u256F\u2570\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    C: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2570\u256F</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    D: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2570\u256E\u256D\u256E\u2503</c1>",
      "<c2>\u2571</c2><c1>\u2503\u2503\u2503\u2503</c1>",
      "<c2>\u2571</c2><c1>\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u256D\u256F\u2570\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    E: ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u2501\u256F</c1>", "<c1>\u2503\u2570\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u2501\u256F</c1>", "<c1>\u2503\u2570\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    F: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u2501\u256F</c1>",
      "<c1>\u2503\u2570\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u2501\u256F</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571\u2571\u2571</c2>",
      "<c1>\u2570\u256F</c1><c2>\u2571\u2571\u2571</c2>"
    ],
    G: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2570\u256F</c1>",
      "<c1>\u2503\u2503\u256D\u2501\u256E</c1>",
      "<c1>\u2503\u2570\u253B\u2501\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    H: [
      "<c1>\u256D\u256E</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2570\u256F</c1><c2>\u2571</c2><c1>\u2570\u256F</c1>"
    ],
    I: [
      "<c1>\u256D\u2501\u2501\u256E</c1>",
      "<c1>\u2570\u252B\u2523\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571</c2>",
      "<c1>\u256D\u252B\u2523\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u256F</c1>"
    ],
    J: [
      "<c2>\u2571\u2571</c2><c1>\u256D\u256E</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u2503</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u256D\u256E\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u256F</c1>"
    ],
    K: [
      "<c1>\u256D\u256E\u256D\u2501\u256E</c1>",
      "<c1>\u2503\u2503\u2503\u256D\u256F</c1>",
      "<c1>\u2503\u2570\u256F\u256F</c1><c2>\u2571</c2>",
      "<c1>\u2503\u256D\u256E\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2503\u2503\u2570\u256E</c1>",
      "<c1>\u2570\u256F\u2570\u2501\u256F</c1>"
    ],
    L: [
      "<c1>\u256D\u256E</c1><c2>\u2571\u2571\u2571</c2>",
      "<c1>\u2503\u2503</c1><c2>\u2571\u2571\u2571</c2>",
      "<c1>\u2503\u2503</c1><c2>\u2571\u2571\u2571</c2>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    M: [
      "<c1>\u256D\u2501\u256E\u256D\u2501\u256E</c1>",
      "<c1>\u2503\u2503\u2570\u256F\u2503\u2503</c1>",
      "<c1>\u2503\u256D\u256E\u256D\u256E\u2503</c1>",
      "<c1>\u2503\u2503\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u2503\u2503\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u2570\u256F\u2570\u256F\u2570\u256F</c1>"
    ],
    N: [
      "<c1>\u256D\u2501\u256E</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2503\u2570\u256E\u2503\u2503</c1>",
      "<c1>\u2503\u256D\u256E\u2570\u256F\u2503</c1>",
      "<c1>\u2503\u2503\u2570\u256E\u2503\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503\u2503</c1>",
      "<c1>\u2570\u256F</c1><c2>\u2571</c2><c1>\u2570\u2501\u256F</c1>"
    ],
    O: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    P: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2503\u256D\u2501\u2501\u256F</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571\u2571\u2571</c2>",
      "<c1>\u2570\u256F</c1><c2>\u2571\u2571\u2571</c2>"
    ],
    Q: [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1><c2>\u2571</c2>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2570\u2501\u256F\u2503\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u2501\u256F</c1>"
    ],
    R: ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2503\u256D\u256E\u256D\u256F</c1>", "<c1>\u2503\u2503\u2503\u2570\u256E</c1>", "<c1>\u2570\u256F\u2570\u2501\u256F</c1>"],
    S: ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    T: [
      "<c1>\u256D\u2501\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u256E\u256D\u256E\u2503</c1>",
      "<c1>\u2570\u256F\u2503\u2503\u2570\u256F</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571\u2571</c2>"
    ],
    U: [
      "<c1>\u256D\u256E</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    V: [
      "<c1>\u256D\u256E</c1><c2>\u2571\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2570\u256E\u256D\u256F\u2503</c1>",
      "<c1>\u2570\u256E\u2503\u2503\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2503\u2570\u256F\u2503</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u2570\u256E\u256D\u256F</c1><c2>\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571\u2571</c2>"
    ],
    W: [
      "<c1>\u256D\u256E\u256D\u256E\u256D\u256E</c1>",
      "<c1>\u2503\u2503\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u2503\u2503\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u256F\u2570\u256F\u2503</c1>",
      "<c1>\u2570\u256E\u256D\u256E\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2570\u256F\u2570\u256F</c1><c2>\u2571</c2>"
    ],
    X: [
      "<c1>\u256D\u2501\u256E\u256D\u2501\u256E</c1>",
      "<c1>\u2570\u256E\u2570\u256F\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2570\u256E\u256D\u256F</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u256D\u256F\u2570\u256E</c1><c2>\u2571</c2>",
      "<c1>\u256D\u256F\u256D\u256E\u2570\u256E</c1>",
      "<c1>\u2570\u2501\u256F\u2570\u2501\u256F</c1>"
    ],
    Y: [
      "<c1>\u256D\u256E</c1><c2>\u2571\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2570\u256E\u256D\u256F\u2503</c1>",
      "<c1>\u2570\u256E\u2570\u256F\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2570\u256E\u256D\u256F</c1><c2>\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571\u2571</c2>"
    ],
    Z: [
      "<c1>\u256D\u2501\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u256E\u2501\u2503</c1>",
      "<c2>\u2571\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571</c2>",
      "<c1>\u256D\u256F\u2501\u2570\u2501\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u2501\u256F</c1>"
    ],
    "0": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2503\u2503\u2503\u2503</c1>", "<c1>\u2503\u2503\u2503\u2503\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "1": [
      "<c2>\u2571</c2><c1>\u256D\u256E</c1><c2>\u2571</c2>",
      "<c1>\u256D\u256F\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2570\u256E\u2503</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571</c2>",
      "<c1>\u256D\u256F\u2570\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u256F</c1>"
    ],
    "2": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2570\u256F\u256D\u256F\u2503</c1>", "<c1>\u256D\u2501\u256F\u256D\u256F</c1>", "<c1>\u2503\u2570\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "3": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2570\u256F\u256D\u256F\u2503</c1>", "<c1>\u256D\u256E\u2570\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "4": [
      "<c1>\u256D\u256E</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2503\u2503</c1><c2>\u2571</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2570\u2501\u256F\u2503</c1>",
      "<c1>\u2570\u2501\u2501\u256E\u2503</c1>",
      "<c2>\u2571\u2571\u2571</c2><c1>\u2503\u2503</c1>",
      "<c2>\u2571\u2571\u2571</c2><c1>\u2570\u256F</c1>"
    ],
    "5": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u2501\u256F</c1>", "<c1>\u2503\u2570\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u256E\u2503</c1>", "<c1>\u256D\u2501\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "6": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u2501\u256F</c1>", "<c1>\u2503\u2570\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "7": [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2570\u256F\u256D\u256F\u2503</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u256D\u256F</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u2503</c1><c2>\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571</c2>"
    ],
    "8": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "9": ["<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2503\u256D\u2501\u256E\u2503</c1>", "<c1>\u2503\u2570\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u256E\u2503</c1>", "<c1>\u256D\u2501\u2501\u256F\u2503</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "!": ["<c1>\u256D\u256E</c1>", "<c1>\u2503\u2503</c1>", "<c1>\u2503\u2503</c1>", "<c1>\u2570\u256F</c1>", "<c1>\u256D\u256E</c1>", "<c1>\u2570\u256F</c1>"],
    "?": [
      "<c1>\u256D\u2501\u2501\u2501\u256E</c1>",
      "<c1>\u2503\u256D\u2501\u256E\u2503</c1>",
      "<c1>\u2570\u256F\u256D\u256F\u2503</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2503\u256D\u256F</c1>",
      "<c2>\u2571\u2571</c2><c1>\u256D\u256E</c1><c2>\u2571</c2>",
      "<c2>\u2571\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571</c2>"
    ],
    ".": ["<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c1>\u256D\u256E</c1>", "<c1>\u2570\u256F</c1>"],
    "+": [
      "<c2>\u2571\u2571\u2571\u2571</c2>",
      "<c2>\u2571\u2571\u2571\u2571</c2>",
      "<c2>\u2571</c2><c1>\u256D\u256E</c1><c2>\u2571</c2>",
      "<c1>\u256D\u256F\u2570\u256E</c1>",
      "<c1>\u2570\u256E\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571</c2>"
    ],
    "-": ["<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c1>\u256D\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u256F</c1>", "<c2>\u2571\u2571\u2571\u2571</c2>"],
    _: ["<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c1>\u256D\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u256F</c1>"],
    "=": ["<c2>\u2571\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571\u2571</c2>", "<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>", "<c1>\u256D\u2501\u2501\u2501\u256E</c1>", "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"],
    "@": [
      "<c1>\u256D\u2501\u2501\u2501\u2501\u256E</c1><c2>\u2571</c2>",
      "<c1>\u2503\u256D\u2501\u2501\u256E\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2503\u256D\u2501\u2503\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2503\u2570\u256F\u2503\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2570\u2501\u2501\u256F\u2501\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u2501\u2501\u256F</c1>"
    ],
    "#": [
      "<c2>\u2571</c2><c1>\u256D\u2501\u2501\u256E</c1><c2>\u2571</c2>",
      "<c1>\u256D\u256F\u256D\u256E\u2570\u256E</c1>",
      "<c1>\u2570\u256E\u2503\u2503\u256D\u256F</c1>",
      "<c1>\u256D\u256F\u2503\u2503\u2570\u256E</c1>",
      "<c1>\u2570\u256E\u2570\u256F\u256D\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2570\u2501\u2501\u256F</c1><c2>\u2571</c2>"
    ],
    $: [
      "<c2>\u2571\u2571</c2><c1>\u256D\u256E</c1><c2>\u2571</c2>",
      "<c1>\u256D\u2501\u256F\u2570\u256E</c1>",
      "<c1>\u2503\u2570\u2501\u2501\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u256E\u2503</c1>",
      "<c1>\u2570\u256E\u256D\u2501\u256F</c1>",
      "<c2>\u2571</c2><c1>\u2570\u256F</c1><c2>\u2571\u2571</c2>"
    ],
    "%": [
      "<c1>\u256D\u256E</c1><c2>\u2571\u2571</c2><c1>\u256D\u2501\u256E</c1>",
      "<c1>\u2570\u256F</c1><c2>\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1>",
      "<c2>\u2571\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571\u2571</c2>",
      "<c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571</c2><c1>\u256D\u256E</c1>",
      "<c1>\u2570\u2501\u256F</c1><c2>\u2571\u2571</c2><c1>\u2570\u256F</c1>"
    ],
    "&": [
      "<c2>\u2571</c2><c1>\u256D\u2501\u2501\u256E</c1>",
      "<c2>\u2571</c2><c1>\u2503\u256D\u2501\u256F</c1>",
      "<c1>\u256D\u256F\u2570\u256E</c1><c2>\u2571</c2>",
      "<c1>\u2503\u256D\u256E\u2503</c1><c2>\u2571</c2>",
      "<c1>\u2503\u2570\u256F\u2503\u256E</c1>",
      "<c1>\u2570\u2501\u2501\u2501\u256F</c1>"
    ],
    "(": [
      "<c2>\u2571\u2571</c2><c1>\u256D\u2501\u256E</c1>",
      "<c2>\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1>",
      "<c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571</c2>",
      "<c1>\u2570\u256E\u2570\u256E</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u2570\u256E\u2570\u256E</c1>",
      "<c2>\u2571\u2571</c2><c1>\u2570\u2501\u256F</c1>"
    ],
    ")": [
      "<c1>\u256D\u2501\u256E</c1><c2>\u2571\u2571</c2>",
      "<c1>\u2570\u256E\u2570\u256E</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u2570\u256E\u2570\u256E</c1>",
      "<c2>\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1>",
      "<c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571</c2>",
      "<c1>\u2570\u2501\u256F</c1><c2>\u2571\u2571</c2>"
    ],
    "/": [
      "<c2>\u2571\u2571\u2571\u2571</c2><c1>\u256D\u2501\u256E</c1>",
      "<c2>\u2571\u2571\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1>",
      "<c2>\u2571\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571</c2>",
      "<c2>\u2571</c2><c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571\u2571</c2>",
      "<c1>\u256D\u256F\u256D\u256F</c1><c2>\u2571\u2571\u2571</c2>",
      "<c1>\u2570\u2501\u256F</c1><c2>\u2571\u2571\u2571\u2571</c2>"
    ],
    ":": ["<c2>\u2571\u2571</c2>", "<c1>\u256D\u256E</c1>", "<c1>\u2570\u256F</c1>", "<c1>\u256D\u256E</c1>", "<c1>\u2570\u256F</c1>", "<c2>\u2571\u2571</c2>"],
    ";": ["<c1>\u256D\u256E</c1>", "<c1>\u2503\u2503</c1>", "<c1>\u2570\u256F</c1>", "<c1>\u256D\u256E</c1>", "<c1>\u2570\u252B</c1>", "<c2>\u2571</c2><c1>\u256F</c1>"],
    ",": ["<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c1>\u256D\u256E</c1>", "<c1>\u2570\u252B</c1>", "<c2>\u2571</c2><c1>\u256F</c1>"],
    "'": ["<c1>\u256D\u256E</c1>", "<c1>\u2570\u256F</c1>", "<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>", "<c2>\u2571\u2571</c2>"],
    '"': ["<c1>\u256D\u256E\u256D\u256E</c1>", "<c1>\u2570\u256F\u2570\u256F</c1>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571\u2571</c2>"],
    " ": ["<c2>\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571</c2>", "<c2>\u2571\u2571\u2571</c2>"]
  }
};
// src/lib/fonts/tiny.json
var tiny_default = {
  name: "tiny",
  version: "0.2.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 1,
  lines: 2,
  buffer: ["", ""],
  letterspace: [" ", " "],
  letterspace_size: 1,
  chars: {
    A: ["\u2584\u2580\u2588", "\u2588\u2580\u2588"],
    B: ["\u2588\u2584\u2584", "\u2588\u2584\u2588"],
    C: ["\u2588\u2580\u2580", "\u2588\u2584\u2584"],
    D: ["\u2588\u2580\u2584", "\u2588\u2584\u2580"],
    E: ["\u2588\u2580\u2580", "\u2588\u2588\u2584"],
    F: ["\u2588\u2580\u2580", "\u2588\u2580 "],
    G: ["\u2588\u2580\u2580", "\u2588\u2584\u2588"],
    H: ["\u2588 \u2588", "\u2588\u2580\u2588"],
    I: ["\u2588", "\u2588"],
    J: ["  \u2588", "\u2588\u2584\u2588"],
    K: ["\u2588\u2584\u2580", "\u2588 \u2588"],
    L: ["\u2588  ", "\u2588\u2584\u2584"],
    M: ["\u2588\u2580\u2584\u2580\u2588", "\u2588 \u2580 \u2588"],
    N: ["\u2588\u2584 \u2588", "\u2588 \u2580\u2588"],
    O: ["\u2588\u2580\u2588", "\u2588\u2584\u2588"],
    P: ["\u2588\u2580\u2588", "\u2588\u2580\u2580"],
    Q: ["\u2588\u2580\u2588", "\u2580\u2580\u2588"],
    R: ["\u2588\u2580\u2588", "\u2588\u2580\u2584"],
    S: ["\u2588\u2580\u2580", "\u2584\u2584\u2588"],
    T: ["\u2580\u2588\u2580", " \u2588 "],
    U: ["\u2588 \u2588", "\u2588\u2584\u2588"],
    V: ["\u2588 \u2588", "\u2580\u2584\u2580"],
    W: ["\u2588 \u2588 \u2588", "\u2580\u2584\u2580\u2584\u2580"],
    X: ["\u2580\u2584\u2580", "\u2588 \u2588"],
    Y: ["\u2588\u2584\u2588", " \u2588 "],
    Z: ["\u2580\u2588", "\u2588\u2584"],
    "0": ["\u259E\u2588\u259A", "\u259A\u2588\u259E"],
    "1": ["\u2584\u2588", " \u2588"],
    "2": ["\u2580\u2588", "\u2588\u2584"],
    "3": ["\u2580\u2580\u2588", "\u2584\u2588\u2588"],
    "4": ["\u2588 \u2588", "\u2580\u2580\u2588"],
    "5": ["\u2588\u2580", "\u2584\u2588"],
    "6": ["\u2588\u2584\u2584", "\u2588\u2584\u2588"],
    "7": ["\u2580\u2580\u2588", "  \u2588"],
    "8": ["\u2588\u2588\u2588", "\u2588\u2584\u2588"],
    "9": ["\u2588\u2580\u2588", "\u2580\u2580\u2588"],
    "!": ["\u2588", "\u2584"],
    "?": ["\u2580\u2588", " \u2584"],
    ".": [" ", "\u2584"],
    "+": ["\u2584\u2588\u2584", " \u2580 "],
    "-": ["\u2584\u2584", "  "],
    _: ["  ", "\u2584\u2584"],
    "=": ["\u2580\u2580", "\u2580\u2580"],
    "@": ["\u259B\u2588\u259C", "\u2599\u259F\u2583"],
    "#": ["\u259F\u2584\u2599", "\u259C\u2580\u259B"],
    $: ["\u2596\u2588\u2597", "\u2598\u2588\u259D"],
    "%": ["\u2580 \u2584\u2580", "\u2584\u2580 \u2584"],
    "&": ["\u2584\u2584\u2588", "\u2588\u2584\u2588"],
    "(": ["\u2584\u2580", "\u2580\u2584"],
    ")": ["\u2580\u2584", "\u2584\u2580"],
    "/": ["  \u2584\u2580", "\u2584\u2580  "],
    ":": ["\u2580", "\u2584"],
    ";": ["  ", "\u2584\u2580"],
    ",": [" ", "\u2588"],
    "'": ["\u2580", " "],
    '"': ["\u259B \u259C", "   "],
    " ": [" ", " "]
  }
};
// src/lib/fonts/huge.json
var huge_default = {
  name: "huge",
  version: "0.2.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 2,
  lines: 11,
  buffer: ["", "", "", "", "", "", "", "", "", "", ""],
  letterspace: [" ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " "],
  letterspace_size: 1,
  chars: {
    A: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580         \u2580</c1> "
    ],
    B: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1>  ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1>  "
    ],
    C: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    D: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1>  ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1>  "
    ],
    E: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    F: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      " <c1>\u2580</c1>           "
    ],
    G: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    H: [
      " <c1>\u2584         \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580         \u2580</c1> "
    ],
    I: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580</c1> ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      " <c1>\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    J: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580</c1> ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>    ",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1>     "
    ],
    K: [
      " <c1>\u2584    \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580    \u2580</c1> "
    ],
    L: [
      " <c1>\u2584</c1>           ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    M: [
      " <c1>\u2584\u2584       \u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2580   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580         \u2580</c1> "
    ],
    N: [
      " <c1>\u2584\u2584        \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C      \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C    \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C    \u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C      \u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580        \u2580\u2580</c1> "
    ],
    O: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    P: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      " <c1>\u2580</c1>           "
    ],
    Q: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580</c1> ",
      "        <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "         <c1>\u2580</c1>   "
    ],
    R: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C      \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580         \u2580</c1> "
    ],
    S: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    T: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580</c1> ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "      <c1>\u2580</c1>      "
    ],
    U: [
      " <c1>\u2584         \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    V: [
      " <c1>\u2584               \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C             \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C           \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C         \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "    <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>      ",
      "       <c1>\u2590</c1><c2>\u2591</c2><c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>       ",
      "        <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>        ",
      "         <c1>\u2580</c1>         "
    ],
    W: [
      " <c1>\u2584         \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2584   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580       \u2580\u2580</c1> "
    ],
    X: [
      " <c1>\u2584       \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "    <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580       \u2580</c1> "
    ],
    Y: [
      " <c1>\u2584         \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580</c1> ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "      <c1>\u2580</c1>      "
    ],
    Z: [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "    <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "0": [
      "  <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1>  ",
      " <c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C    \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C    \u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      "  <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1>  "
    ],
    "1": [
      "    <c1>\u2584\u2584\u2584\u2584</c1>     ",
      "  <c1>\u2584\u2588</c1><c2>\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>    ",
      " <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "  <c1>\u2580\u2580 \u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "     <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "     <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "     <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "     <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      " <c1>\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "2": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "3": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "4": [
      " <c1>\u2584         \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "           <c1>\u2580</c1> "
    ],
    "5": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "6": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>          ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "7": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "         <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "        <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "       <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "    <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>      ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>       ",
      "    <c1>\u2580</c1>        "
    ],
    "8": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "9": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "          <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "!": [
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580</c1> ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580</c1> "
    ],
    "?": [
      "    <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1>  ",
      "  <c1>\u2584\u2588</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u2588\u2584</c1> ",
      " <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "  <c1>\u2580\u2580  \u2584\u2584\u2584\u2588</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "    <c1>\u2584\u2588</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u2588</c1> ",
      "   <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C\u2580\u2580\u2580\u2580</c1>  ",
      "   <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>      ",
      "    <c1>\u2580\u2580</c1>       ",
      "    <c1>\u2584\u2584</c1>       ",
      "   <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>      ",
      "    <c1>\u2580\u2580</c1>       "
    ],
    ".": [
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580</c1> "
    ],
    "+": [
      "          ",
      "          ",
      "    <c1>\u2584\u2584</c1>    ",
      "   <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>   ",
      " <c1>\u2584\u2584\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2588</c1><c2>\u2591\u2591</c2><c1>\u2588\u2580\u2580</c1> ",
      "   <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>   ",
      "    <c1>\u2580\u2580</c1>    ",
      "          ",
      "          "
    ],
    "-": [
      "       ",
      "       ",
      "       ",
      "       ",
      " <c1>\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580</c1> ",
      "       ",
      "       ",
      "       ",
      "       "
    ],
    _: [
      "       ",
      "       ",
      "       ",
      "       ",
      "       ",
      "       ",
      "       ",
      " <c1>\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580</c1> ",
      "       "
    ],
    "=": [
      "       ",
      "       ",
      " <c1>\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580</c1> ",
      "       ",
      " <c1>\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580</c1> ",
      "       ",
      "       "
    ],
    "@": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C        \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C  \u2584\u2584\u2584\u2584  \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2588</c1><c2>\u2591\u2591\u2591\u2591</c2><c1>\u2588 \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u2588\u2588\u2588\u2588</c1><c2>\u2591</c2><c1>\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C \u2588</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    "#": [
      "   <c1>\u2584         \u2584</c1>   ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      " <c1>\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580</c1> ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      " <c1>\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580</c1> ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C       \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "   <c1>\u2580         \u2580</c1>   "
    ],
    $: [
      "      <c1>\u2584</c1>      ",
      " <c1>\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580</c1> ",
      "      <c1>\u2580</c1>      "
    ],
    "%": [
      "         <c1>\u2584</c1> ",
      "  <c1>\u2584     \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "  <c1>\u2580   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "    <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2584</c1>  ",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2580</c1>  ",
      " <c1>\u2580</c1>         "
    ],
    "&": [
      " <c1>\u2584\u2584\u2584\u2584\u2584\u2584\u2584</c1>     ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C   \u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      " <c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2580\u2580\u2580\u2580\u2588</c1><c2>\u2591</c2><c1>\u258C \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C     \u2590</c1><c2>\u2591</c2><c1>\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2588\u2584\u2584\u2584\u2584\u2588</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      " <c1>\u2580\u2580\u2580\u2580\u2580\u2580  \u2580</c1>   "
    ],
    "(": [
      "  <c1>\u2584\u2584\u2584\u2584\u2584</c1> ",
      " <c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u2588\u2580\u2580\u2580</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>    ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u2588\u2584\u2584\u2584</c1> ",
      " <c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1>",
      "  <c1>\u2580\u2580\u2580\u2580\u2580</c1> "
    ],
    ")": [
      " <c1>\u2584\u2584\u2584\u2584\u2584</c1>  ",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      " <c1>\u2580\u2580\u2580\u2588</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "    <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "    <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "    <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "    <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "    <c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2584\u2584\u2584\u2588</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      "<c1>\u2590</c1><c2>\u2591\u2591\u2591\u2591\u2591</c2><c1>\u258C</c1> ",
      " <c1>\u2580\u2580\u2580\u2580\u2580</c1>  "
    ],
    "/": [
      "         <c1>\u2584</c1> ",
      "        <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>",
      "       <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1> ",
      "      <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>  ",
      "     <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>   ",
      "    <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>    ",
      "   <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>     ",
      "  <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>      ",
      " <c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>       ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u258C</c1>        ",
      " <c1>\u2580</c1>         "
    ],
    ":": [
      "    ",
      "    ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580</c1> ",
      "    ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580</c1> ",
      "    ",
      "    "
    ],
    ";": [
      "    ",
      "    ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u2580</c1> ",
      "    ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u258C</c1> ",
      " <c1>\u2580</c1>  ",
      "    "
    ],
    ",": [
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      "    ",
      " <c1>\u2584\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591\u2591</c2><c1>\u258C</c1>",
      " <c1>\u2580\u258C</c1> ",
      " <c1>\u2580</c1>  "
    ],
    "'": [
      " <c1>\u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2590</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2590</c1>",
      " <c1>\u2580</c1> ",
      "   ",
      "   ",
      "   ",
      "   ",
      "   ",
      "   ",
      "   "
    ],
    '"': [
      " <c1>\u2584  \u2584</c1> ",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2590\u2590</c1><c2>\u2591</c2><c1>\u2590</c1>",
      "<c1>\u2590</c1><c2>\u2591</c2><c1>\u2590\u2590</c1><c2>\u2591</c2><c1>\u2590</c1>",
      " <c1>\u2580  \u2580</c1> ",
      "      ",
      "      ",
      "      ",
      "      ",
      "      ",
      "      ",
      "      "
    ],
    " ": ["    ", "    ", "    ", "    ", "    ", "    ", "    ", "    ", "    ", "    ", "    "]
  }
};
// src/lib/fonts/grid.json
var grid_default = {
  name: "grid",
  version: "0.1.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 2,
  lines: 6,
  buffer: ["", "", "", "", "", ""],
  letterspace: ["<c2>\u254B</c2>", "<c2>\u254B</c2>", "<c2>\u254B</c2>", "<c2>\u254B</c2>", "<c2>\u254B</c2>", "<c2>\u254B</c2>"],
  letterspace_size: 1,
  chars: {
    A: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2513\u2503</c1>", "<c1>\u2503\u250F\u2513\u2503</c1>", "<c1>\u2517\u251B\u2517\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    B: [
      "<c1>\u250F\u2513</c1><c2>\u254B\u254B</c2>",
      "<c1>\u2503\u2517\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u2513\u2503</c1>",
      "<c1>\u2503\u2517\u251B\u2503</c1>",
      "<c1>\u2517\u2501\u2501\u251B</c1>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    C: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u251B</c1>", "<c1>\u2503\u2517\u2501\u2513</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    D: [
      "<c2>\u254B\u254B</c2><c1>\u250F\u2513</c1>",
      "<c1>\u250F\u2501\u251B\u2503</c1>",
      "<c1>\u2503\u250F\u2513\u2503</c1>",
      "<c1>\u2503\u2517\u251B\u2503</c1>",
      "<c1>\u2517\u2501\u2501\u251B</c1>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    E: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2503\u2503\u2501\u252B</c1>", "<c1>\u2503\u2503\u2501\u252B</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    F: [
      "<c2>\u254B</c2><c1>\u250F\u2501\u2513</c1>",
      "<c1>\u250F\u251B\u2517\u2513</c1>",
      "<c1>\u2517\u2513\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c2>\u254B</c2><c1>\u2517\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    G: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2513\u2503</c1>", "<c1>\u2503\u2517\u251B\u2503</c1>", "<c1>\u2517\u2501\u2513\u2503</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>"],
    H: [
      "<c1>\u250F\u2513</c1><c2>\u254B\u254B</c2>",
      "<c1>\u2503\u2517\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u2513\u2503</c1>",
      "<c1>\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u2517\u251B\u2517\u251B</c1>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    I: ["<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>", "<c1>\u250F\u2513</c1>", "<c1>\u2503\u2503</c1>", "<c1>\u2517\u251B</c1>", "<c2>\u254B\u254B</c2>"],
    J: [
      "<c2>\u254B</c2><c1>\u250F\u2513</c1>",
      "<c2>\u254B</c2><c1>\u2517\u251B</c1>",
      "<c2>\u254B</c2><c1>\u250F\u2513</c1>",
      "<c2>\u254B</c2><c1>\u2503\u2503</c1>",
      "<c1>\u250F\u251B\u2503</c1>",
      "<c1>\u2517\u2501\u251B</c1>"
    ],
    K: [
      "<c1>\u250F\u2513</c1><c2>\u254B\u254B</c2>",
      "<c1>\u2503\u2503\u250F\u2513</c1>",
      "<c1>\u2503\u2517\u251B\u251B</c1>",
      "<c1>\u2503\u250F\u2513\u2513</c1>",
      "<c1>\u2517\u251B\u2517\u251B</c1>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    L: [
      "<c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2503\u2517\u2513</c1>",
      "<c1>\u2517\u2501\u251B</c1>",
      "<c2>\u254B\u254B\u254B</c2>"
    ],
    M: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2513\u250F\u2513</c1>", "<c1>\u2503\u2517\u251B\u2503</c1>", "<c1>\u2503\u2503\u2503\u2503</c1>", "<c1>\u2517\u253B\u253B\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    N: [
      "<c2>\u254B\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2501\u2513</c1><c2>\u254B</c2>",
      "<c1>\u2503\u250F\u2513\u2513</c1>",
      "<c1>\u2503\u2503\u2503\u2503</c1>",
      "<c1>\u2517\u251B\u2517\u251B</c1>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    O: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2513\u2503</c1>", "<c1>\u2503\u2517\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    P: [
      "<c2>\u254B\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2501\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u2513\u2503</c1>",
      "<c1>\u2503\u2517\u251B\u2503</c1>",
      "<c1>\u2503\u250F\u2501\u251B</c1>",
      "<c1>\u2517\u251B</c1><c2>\u254B\u254B</c2>"
    ],
    Q: [
      "<c2>\u254B\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2501\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u2513\u2503</c1>",
      "<c1>\u2503\u2517\u251B\u2503</c1>",
      "<c1>\u2517\u2501\u2513\u2503</c1>",
      "<c2>\u254B\u254B</c2><c1>\u2517\u251B</c1>"
    ],
    R: [
      "<c2>\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u251B</c1>",
      "<c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2517\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B\u254B</c2>"
    ],
    S: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2503\u2501\u2501\u252B</c1>", "<c1>\u2523\u2501\u2501\u2503</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    T: [
      "<c2>\u254B</c2><c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c1>\u250F\u251B\u2517\u2513</c1>",
      "<c1>\u2517\u2513\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2503\u2517\u2513</c1>",
      "<c2>\u254B</c2><c1>\u2517\u2501\u251B</c1>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    U: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2513\u250F\u2513</c1>", "<c1>\u2503\u2503\u2503\u2503</c1>", "<c1>\u2503\u2517\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    V: [
      "<c2>\u254B\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2513\u250F\u2513</c1>",
      "<c1>\u2503\u2517\u251B\u2503</c1>",
      "<c1>\u2517\u2513\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2517\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    W: [
      "<c2>\u254B\u254B\u254B\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2513\u250F\u2513\u250F\u2513</c1>",
      "<c1>\u2503\u2517\u251B\u2517\u251B\u2503</c1>",
      "<c1>\u2517\u2513\u250F\u2513\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2517\u251B\u2517\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B\u254B\u254B\u254B\u254B</c2>"
    ],
    X: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2513\u250F\u2513</c1>", "<c1>\u2517\u254B\u254B\u251B</c1>", "<c1>\u250F\u254B\u254B\u2513</c1>", "<c1>\u2517\u251B\u2517\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    Y: [
      "<c2>\u254B\u254B\u254B\u254B\u254B</c2>",
      "<c1>\u250F\u2513</c1><c2>\u254B</c2><c1>\u250F\u2513</c1>",
      "<c1>\u2503\u2517\u2501\u251B\u2503</c1>",
      "<c1>\u2517\u2501\u2513\u250F\u251B</c1>",
      "<c1>\u2517\u2501\u2501\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B\u254B\u254B\u254B</c2>"
    ],
    Z: ["<c2>\u254B\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2523\u2501\u2501\u2503\u2503</c1>", "<c1>\u2503\u2503\u2501\u2501\u252B</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B\u254B</c2>"],
    "0": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2503\u2503\u2503\u2503\u2503</c1>", "<c1>\u2503\u2503\u2503\u2503\u2503</c1>", "<c1>\u2503\u2517\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "1": [
      "<c2>\u254B</c2><c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c1>\u250F\u251B\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2517\u2513\u2503</c1><c2>\u254B</c2>",
      "<c2>\u254B</c2><c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u250F\u251B\u2517\u2513</c1>",
      "<c1>\u2517\u2501\u2501\u251B</c1>"
    ],
    "2": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2517\u251B\u250F\u251B\u2503</c1>", "<c1>\u250F\u2501\u251B\u250F\u251B</c1>", "<c1>\u2503\u2517\u2501\u253B\u2513</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "3": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2517\u251B\u250F\u251B\u2503</c1>", "<c1>\u250F\u2513\u2517\u2513\u2503</c1>", "<c1>\u2503\u2517\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "4": [
      "<c1>\u250F\u2513</c1><c2>\u254B</c2><c1>\u250F\u2513</c1>",
      "<c1>\u2503\u2503</c1><c2>\u254B</c2><c1>\u2503\u2503</c1>",
      "<c1>\u2503\u2517\u2501\u251B\u2503</c1>",
      "<c1>\u2517\u2501\u2501\u2513\u2503</c1>",
      "<c2>\u254B\u254B\u254B</c2><c1>\u2503\u2503</c1>",
      "<c2>\u254B\u254B\u254B</c2><c1>\u2517\u251B</c1>"
    ],
    "5": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2501\u251B</c1>", "<c1>\u2503\u2517\u2501\u2501\u2513</c1>", "<c1>\u2517\u2501\u2501\u2513\u2503</c1>", "<c1>\u250F\u2501\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "6": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2501\u251B</c1>", "<c1>\u2503\u2517\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2503\u2517\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "7": [
      "<c1>\u250F\u2501\u2501\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u2501\u2513\u2503</c1>",
      "<c1>\u2517\u251B\u250F\u251B\u2503</c1>",
      "<c2>\u254B\u254B</c2><c1>\u2503\u250F\u251B</c1>",
      "<c2>\u254B\u254B</c2><c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B</c2><c1>\u2517\u251B</c1><c2>\u254B</c2>"
    ],
    "8": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2503\u2517\u2501\u251B\u2503</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2503\u2517\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "9": ["<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2503\u250F\u2501\u2513\u2503</c1>", "<c1>\u2503\u2517\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2513\u2503</c1>", "<c1>\u250F\u2501\u2501\u251B\u2503</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>"],
    "!": ["<c1>\u250F\u2513</c1>", "<c1>\u2503\u2503</c1>", "<c1>\u2503\u2503</c1>", "<c1>\u2517\u251B</c1>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>"],
    "?": [
      "<c1>\u250F\u2501\u2501\u2501\u2513</c1>",
      "<c1>\u2503\u250F\u2501\u2513\u2503</c1>",
      "<c1>\u2517\u251B\u250F\u251B\u2503</c1>",
      "<c2>\u254B\u254B</c2><c1>\u2503\u250F\u251B</c1>",
      "<c2>\u254B\u254B</c2><c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B</c2><c1>\u2517\u251B</c1><c2>\u254B</c2>"
    ],
    ".": ["<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>"],
    "+": [
      "<c2>\u254B\u254B\u254B\u254B</c2>",
      "<c2>\u254B</c2><c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c1>\u250F\u251B\u2517\u2513</c1>",
      "<c1>\u2517\u2513\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2517\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    "-": ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    _: ["<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2513</c1>", "<c1>\u2517\u2501\u2501\u251B</c1>"],
    "=": ["<c2>\u254B\u254B\u254B\u254B\u254B</c2>", "<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>", "<c1>\u250F\u2501\u2501\u2501\u2513</c1>", "<c1>\u2517\u2501\u2501\u2501\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B\u254B</c2>"],
    "@": [
      "<c1>\u250F\u2501\u2501\u2501\u2501\u2513</c1><c2>\u254B</c2>",
      "<c1>\u2503\u250F\u2501\u2501\u2513\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2503\u2503\u250F\u2501\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2503\u2503\u2517\u251B\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2503\u2517\u2501\u2501\u251B\u2517\u2513</c1>",
      "<c1>\u2517\u2501\u2501\u2501\u2501\u2501\u251B</c1>"
    ],
    "#": [
      "<c2>\u254B</c2><c1>\u250F\u2501\u2501\u2501\u2513</c1><c2>\u254B</c2>",
      "<c1>\u250F\u251B\u250F\u2501\u2513\u2517\u2513</c1>",
      "<c1>\u2517\u2513\u2503\u2503\u2503\u250F\u251B</c1>",
      "<c1>\u250F\u251B\u2503\u2503\u2503\u2517\u2513</c1>",
      "<c1>\u2517\u2513\u2517\u2501\u251B\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2517\u2501\u2501\u2501\u251B</c1><c2>\u254B</c2>"
    ],
    $: [
      "<c2>\u254B</c2><c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c1>\u250F\u251B\u2517\u2513</c1>",
      "<c1>\u2503\u2501\u2501\u252B</c1>",
      "<c1>\u2523\u2501\u2501\u2503</c1>",
      "<c1>\u2517\u2513\u250F\u251B</c1>",
      "<c2>\u254B</c2><c1>\u2517\u251B</c1><c2>\u254B</c2>"
    ],
    "%": [
      "<c1>\u250F\u2513</c1><c2>\u254B\u254B</c2><c1>\u250F\u2501\u2513</c1>",
      "<c1>\u2517\u251B</c1><c2>\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1>",
      "<c2>\u254B\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B\u254B</c2>",
      "<c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B</c2><c1>\u250F\u2513</c1>",
      "<c1>\u2517\u2501\u251B</c1><c2>\u254B\u254B</c2><c1>\u2517\u251B</c1>"
    ],
    "&": [
      "<c2>\u254B\u254B</c2><c1>\u250F\u2513</c1><c2>\u254B</c2>",
      "<c2>\u254B\u254B</c2><c1>\u2503\u2503</c1><c2>\u254B</c2>",
      "<c1>\u250F\u2501\u251B\u2517\u2513</c1>",
      "<c1>\u2503\u250F\u2513\u250F\u251B</c1>",
      "<c1>\u2503\u2517\u251B\u2503</c1><c2>\u254B</c2>",
      "<c1>\u2517\u2501\u2501\u251B</c1><c2>\u254B</c2>"
    ],
    "(": [
      "<c2>\u254B\u254B</c2><c1>\u250F\u2501\u2513</c1>",
      "<c2>\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1>",
      "<c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B</c2>",
      "<c1>\u2517\u2513\u2517\u2513</c1><c2>\u254B</c2>",
      "<c2>\u254B</c2><c1>\u2517\u2513\u2517\u2513</c1>",
      "<c2>\u254B\u254B</c2><c1>\u2517\u2501\u251B</c1>"
    ],
    ")": [
      "<c1>\u250F\u2501\u2513</c1><c2>\u254B\u254B</c2>",
      "<c1>\u2517\u2513\u2517\u2513</c1><c2>\u254B</c2>",
      "<c2>\u254B</c2><c1>\u2517\u2513\u2517\u2513</c1>",
      "<c2>\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1>",
      "<c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B</c2>",
      "<c1>\u2517\u2501\u251B</c1><c2>\u254B\u254B</c2>"
    ],
    "/": [
      "<c2>\u254B\u254B\u254B\u254B</c2><c1>\u250F\u2501\u2513</c1>",
      "<c2>\u254B\u254B\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1>",
      "<c2>\u254B\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B</c2>",
      "<c2>\u254B</c2><c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B\u254B</c2>",
      "<c1>\u250F\u251B\u250F\u251B</c1><c2>\u254B\u254B\u254B</c2>",
      "<c1>\u2517\u2501\u251B</c1><c2>\u254B\u254B\u254B\u254B</c2>"
    ],
    ":": ["<c2>\u254B\u254B</c2>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>", "<c2>\u254B\u254B</c2>"],
    ";": ["<c2>\u254B\u254B</c2>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>", "<c2>\u254B\u254B</c2>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u252B</c1>"],
    ",": ["<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c1>\u250F\u2513</c1>", "<c1>\u2517\u252B</c1>"],
    "'": ["<c1>\u250F\u2513</c1>", "<c1>\u2517\u251B</c1>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>"],
    '"': ["<c1>\u250F\u2513\u250F\u2513</c1>", "<c1>\u2517\u251B\u2517\u251B</c1>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>", "<c2>\u254B\u254B\u254B\u254B</c2>"],
    " ": ["<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>", "<c2>\u254B\u254B</c2>"]
  }
};
// src/lib/fonts/pallet.json
var pallet_default = {
  name: "pallet",
  version: "0.1.0",
  homepage: "https://github.com/dominikwilkowski/cfonts",
  colors: 2,
  lines: 6,
  buffer: ["", "", "", "", "", ""],
  letterspace: ["<c2>\u2500</c2>", "<c2>\u2500</c2>", "<c2>\u2500</c2>", "<c2>\u2500</c2>", "<c2>\u2500</c2>", "<c2>\u2500</c2>"],
  letterspace_size: 1,
  chars: {
    A: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u255A\u255D</c1><c2>\u2500</c2><c1>\u255A\u255D</c1>"
    ],
    B: [
      "<c1>\u2554\u2550\u2550\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2554\u2557\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u255A\u255D\u255A\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    C: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u255A\u255D</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    D: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u255A\u2557\u2554\u2557\u2551</c1>",
      "<c2>\u2500</c2><c1>\u2551\u2551\u2551\u2551</c1>",
      "<c2>\u2500</c2><c1>\u2551\u2551\u2551\u2551</c1>",
      "<c1>\u2554\u255D\u255A\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    E: ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2550\u255D</c1>", "<c1>\u2551\u255A\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2550\u255D</c1>", "<c1>\u2551\u255A\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    F: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2550\u255D</c1>",
      "<c1>\u2551\u255A\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2550\u255D</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500\u2500\u2500</c2>",
      "<c1>\u255A\u255D</c1><c2>\u2500\u2500\u2500</c2>"
    ],
    G: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u255A\u255D</c1>",
      "<c1>\u2551\u2551\u2554\u2550\u2557</c1>",
      "<c1>\u2551\u255A\u2569\u2550\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    H: [
      "<c1>\u2554\u2557</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u255A\u255D</c1><c2>\u2500</c2><c1>\u255A\u255D</c1>"
    ],
    I: [
      "<c1>\u2554\u2550\u2550\u2557</c1>",
      "<c1>\u255A\u2563\u2560\u255D</c1>",
      "<c2>\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2554\u2563\u2560\u2557</c1>",
      "<c1>\u255A\u2550\u2550\u255D</c1>"
    ],
    J: [
      "<c2>\u2500\u2500</c2><c1>\u2554\u2557</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2554\u2557\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u255D</c1>"
    ],
    K: [
      "<c1>\u2554\u2557\u2554\u2550\u2557</c1>",
      "<c1>\u2551\u2551\u2551\u2554\u255D</c1>",
      "<c1>\u2551\u255A\u255D\u255D</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2554\u2557\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2551\u2551\u255A\u2557</c1>",
      "<c1>\u255A\u255D\u255A\u2550\u255D</c1>"
    ],
    L: [
      "<c1>\u2554\u2557</c1><c2>\u2500\u2500\u2500</c2>",
      "<c1>\u2551\u2551</c1><c2>\u2500\u2500\u2500</c2>",
      "<c1>\u2551\u2551</c1><c2>\u2500\u2500\u2500</c2>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    M: [
      "<c1>\u2554\u2550\u2557\u2554\u2550\u2557</c1>",
      "<c1>\u2551\u2551\u255A\u255D\u2551\u2551</c1>",
      "<c1>\u2551\u2554\u2557\u2554\u2557\u2551</c1>",
      "<c1>\u2551\u2551\u2551\u2551\u2551\u2551</c1>",
      "<c1>\u2551\u2551\u2551\u2551\u2551\u2551</c1>",
      "<c1>\u255A\u255D\u255A\u255D\u255A\u255D</c1>"
    ],
    N: [
      "<c1>\u2554\u2550\u2557</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u2551\u255A\u2557\u2551\u2551</c1>",
      "<c1>\u2551\u2554\u2557\u255A\u255D\u2551</c1>",
      "<c1>\u2551\u2551\u255A\u2557\u2551\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551\u2551</c1>",
      "<c1>\u255A\u255D</c1><c2>\u2500</c2><c1>\u255A\u2550\u255D</c1>"
    ],
    O: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    P: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u2551\u2554\u2550\u2550\u255D</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500\u2500\u2500</c2>",
      "<c1>\u255A\u255D</c1><c2>\u2500\u2500\u2500</c2>"
    ],
    Q: [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u255A\u2550\u255D\u2560\u2557</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u2550\u255D</c1>"
    ],
    R: ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u2551\u2554\u2557\u2554\u255D</c1>", "<c1>\u2551\u2551\u2551\u255A\u2557</c1>", "<c1>\u255A\u255D\u255A\u2550\u255D</c1>"],
    S: ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    T: [
      "<c1>\u2554\u2550\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2557\u2554\u2557\u2551</c1>",
      "<c1>\u255A\u255D\u2551\u2551\u255A\u255D</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u255A\u255D</c1><c2>\u2500\u2500</c2>"
    ],
    U: [
      "<c1>\u2554\u2557</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"
    ],
    V: [
      "<c1>\u2554\u2557</c1><c2>\u2500\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u255A\u2557\u2554\u255D\u2551</c1>",
      "<c1>\u255A\u2557\u2551\u2551\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u2551\u255A\u255D\u2551</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u255A\u2557\u2554\u255D</c1><c2>\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u255A\u255D</c1><c2>\u2500\u2500</c2>"
    ],
    W: [
      "<c1>\u2554\u2557\u2554\u2557\u2554\u2557</c1>",
      "<c1>\u2551\u2551\u2551\u2551\u2551\u2551</c1>",
      "<c1>\u2551\u2551\u2551\u2551\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u255D\u255A\u255D\u2551</c1>",
      "<c1>\u255A\u2557\u2554\u2557\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u255A\u255D\u255A\u255D</c1><c2>\u2500</c2>"
    ],
    X: [
      "<c1>\u2554\u2550\u2557\u2554\u2550\u2557</c1>",
      "<c1>\u255A\u2557\u255A\u255D\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u255A\u2557\u2554\u255D</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u2554\u255D\u255A\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2554\u255D\u2554\u2557\u255A\u2557</c1>",
      "<c1>\u255A\u2550\u255D\u255A\u2550\u255D</c1>"
    ],
    Y: [
      "<c1>\u2554\u2557</c1><c2>\u2500\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u255A\u2557\u2554\u255D\u2551</c1>",
      "<c1>\u255A\u2557\u255A\u255D\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u255A\u2557\u2554\u255D</c1><c2>\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u255A\u255D</c1><c2>\u2500\u2500</c2>"
    ],
    Z: [
      "<c1>\u2554\u2550\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u255A\u2550\u2550\u2557\u2550\u2551</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500</c2>",
      "<c1>\u2554\u255D\u2550\u255A\u2550\u2557</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u2550\u255D</c1>"
    ],
    "0": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u2551\u2551\u2551\u2551</c1>", "<c1>\u2551\u2551\u2551\u2551\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "1": [
      "<c2>\u2500</c2><c1>\u2554\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2554\u255D\u2551</c1><c2>\u2500</c2>",
      "<c1>\u255A\u2557\u2551</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2554\u255D\u255A\u2557</c1>",
      "<c1>\u255A\u2550\u2550\u255D</c1>"
    ],
    "2": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u255A\u255D\u2554\u255D\u2551</c1>", "<c1>\u2554\u2550\u255D\u2554\u255D</c1>", "<c1>\u2551\u2551\u255A\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "3": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u255A\u255D\u2554\u255D\u2551</c1>", "<c1>\u2554\u2557\u255A\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "4": [
      "<c1>\u2554\u2557</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u2551\u2551</c1><c2>\u2500</c2><c1>\u2551\u2551</c1>",
      "<c1>\u2551\u255A\u2550\u255D\u2551</c1>",
      "<c1>\u255A\u2550\u2550\u2557\u2551</c1>",
      "<c2>\u2500\u2500\u2500</c2><c1>\u2551\u2551</c1>",
      "<c2>\u2500\u2500\u2500</c2><c1>\u255A\u255D</c1>"
    ],
    "5": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2550\u255D</c1>", "<c1>\u2551\u255A\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2557\u2551</c1>", "<c1>\u2554\u2550\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "6": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2550\u255D</c1>", "<c1>\u2551\u255A\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "7": [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u255A\u255D\u2554\u255D\u2551</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2554\u255D</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u255A\u255D</c1><c2>\u2500</c2>"
    ],
    "8": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "9": ["<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2557\u2551</c1>", "<c1>\u2554\u2550\u2550\u255D\u2551</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>"],
    "!": ["<c1>\u2554\u2557</c1>", "<c1>\u2551\u2551</c1>", "<c1>\u2551\u2551</c1>", "<c1>\u255A\u255D</c1>", "<c1>\u2554\u2557</c1>", "<c1>\u255A\u255D</c1>"],
    "?": [
      "<c1>\u2554\u2550\u2550\u2550\u2557</c1>",
      "<c1>\u2551\u2554\u2550\u2557\u2551</c1>",
      "<c1>\u255A\u255D\u2554\u255D\u2551</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2554\u255D</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2554\u2557</c1><c2>\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u255A\u255D</c1><c2>\u2500</c2>"
    ],
    ".": ["<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>", "<c1>\u2554\u2557</c1>", "<c1>\u255A\u255D</c1>"],
    "+": [
      "<c2>\u2500\u2500\u2500\u2500</c2>",
      "<c2>\u2500\u2500\u2500\u2500</c2>",
      "<c2>\u2500</c2><c1>\u2554\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2554\u255D\u255A\u2557</c1>",
      "<c1>\u255A\u2557\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u255A\u255D</c1><c2>\u2500</c2>"
    ],
    "-": ["<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c1>\u2554\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u255D</c1>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>"],
    _: ["<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c1>\u2554\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u255D</c1>"],
    "=": ["<c2>\u2500\u2500\u2500\u2500\u2500</c2>", "<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>", "<c1>\u2554\u2550\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2550\u255D</c1>", "<c2>\u2500\u2500\u2500\u2500\u2500</c2>"],
    "@": [
      "<c1>\u2554\u2550\u2550\u2550\u2550\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2554\u2550\u2550\u2557\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2551\u2554\u2550\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u2551\u255A\u255D\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2551\u255A\u2550\u2550\u255D\u2560\u2557</c1>",
      "<c1>\u255A\u2550\u2550\u2550\u2550\u2550\u255D</c1>"
    ],
    "#": [
      "<c2>\u2500</c2><c1>\u2554\u2569\u2569\u2569\u2557</c1><c2>\u2500</c2>",
      "<c1>\u2554\u255D\u2554\u2550\u2557\u255A\u2557</c1>",
      "<c1>\u255A\u2557\u2560\u2550\u2563\u2554\u255D</c1>",
      "<c1>\u2554\u255D\u2560\u2550\u2563\u255A\u2557</c1>",
      "<c1>\u255A\u2557\u255A\u2550\u255D\u2554\u255D</c1>",
      "<c2>\u2500</c2><c1>\u255A\u2566\u2566\u2566\u255D</c1><c2>\u2500</c2>"
    ],
    $: ["<c1>\u2554\u255D\u2569\u255A\u2557</c1>", "<c1>\u2551\u2554\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u2550\u2557</c1>", "<c1>\u255A\u2550\u2550\u2557\u2551</c1>", "<c1>\u2551\u255A\u2550\u255D\u2551</c1>", "<c1>\u255A\u2557\u2566\u2554\u255D</c1>"],
    "%": [
      "<c1>\u2554\u2557</c1><c2>\u2500\u2500</c2><c1>\u2554\u2550\u2557</c1>",
      "<c1>\u255A\u255D</c1><c2>\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500\u2500</c2>",
      "<c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500</c2><c1>\u2554\u2557</c1>",
      "<c1>\u255A\u2550\u255D</c1><c2>\u2500\u2500</c2><c1>\u255A\u255D</c1>"
    ],
    "&": [
      "<c2>\u2500\u2500</c2><c1>\u2554\u2557</c1><c2>\u2500</c2>",
      "<c2>\u2500\u2500</c2><c1>\u2551\u2551</c1><c2>\u2500</c2>",
      "<c1>\u2554\u2550\u255D\u255A\u2557</c1>",
      "<c1>\u2551\u2554\u2557\u2554\u255D</c1>",
      "<c1>\u2551\u255A\u255D\u2551</c1><c2>\u2500</c2>",
      "<c1>\u255A\u2550\u2550\u255D</c1><c2>\u2500</c2>"
    ],
    "(": [
      "<c2>\u2500\u2500</c2><c1>\u2554\u2550\u2557</c1>",
      "<c2>\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1>",
      "<c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500</c2>",
      "<c1>\u255A\u2557\u255A\u2557</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u255A\u2557\u255A\u2557</c1>",
      "<c2>\u2500\u2500</c2><c1>\u255A\u2550\u255D</c1>"
    ],
    ")": [
      "<c1>\u2554\u2550\u2557</c1><c2>\u2500\u2500</c2>",
      "<c1>\u255A\u2557\u255A\u2557</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u255A\u2557\u255A\u2557</c1>",
      "<c2>\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1>",
      "<c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500</c2>",
      "<c1>\u255A\u2550\u255D</c1><c2>\u2500\u2500</c2>"
    ],
    "/": [
      "<c2>\u2500\u2500\u2500\u2500</c2><c1>\u2554\u2550\u2557</c1>",
      "<c2>\u2500\u2500\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1>",
      "<c2>\u2500\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500</c2>",
      "<c2>\u2500</c2><c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500\u2500</c2>",
      "<c1>\u2554\u255D\u2554\u255D</c1><c2>\u2500\u2500\u2500</c2>",
      "<c1>\u255A\u2550\u255D</c1><c2>\u2500\u2500\u2500\u2500</c2>"
    ],
    ":": ["<c2>\u2500\u2500</c2>", "<c1>\u2554\u2557</c1>", "<c1>\u255A\u255D</c1>", "<c1>\u2554\u2557</c1>", "<c1>\u255A\u255D</c1>", "<c2>\u2500\u2500</c2>"],
    ";": ["<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>", "<c1>\u2554\u2557</c1>", "<c1>\u255A\u2563</c1>", "<c2>\u2500</c2><c1>\u255D</c1>"],
    ",": ["<c1>\u2554\u2557</c1>", "<c1>\u2551\u2551</c1>", "<c1>\u255A\u255D</c1>", "<c1>\u2554\u2557</c1>", "<c1>\u255A\u2563</c1>", "<c2>\u2500</c2><c1>\u255D</c1>"],
    "'": ["<c1>\u2554\u2557</c1>", "<c1>\u2551\u2551</c1>", "<c1>\u255A\u255D</c1>", "<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>", "<c2>\u2500\u2500</c2>"],
    '"': ["<c1>\u2554\u2557\u2554\u2557</c1>", "<c1>\u2551\u2551\u2551\u2551</c1>", "<c1>\u255A\u255D\u255A\u255D</c1>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500\u2500</c2>"],
    " ": ["<c2>\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500</c2>", "<c2>\u2500\u2500\u2500</c2>"]
  }
};

// src/lib/ascii.font.ts
var fonts = {
  tiny: tiny_default,
  block: block_default,
  shade: shade_default,
  slick: slick_default,
  huge: huge_default,
  grid: grid_default,
  pallet: pallet_default
};
var parsedFonts = {};
function parseColorTags(text) {
  const segments = [];
  let currentIndex = 0;
  const colorTagRegex = /<c(\d+)>(.*?)<\/c\d+>/g;
  let lastIndex = 0;
  let match;
  while ((match = colorTagRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index);
      if (plainText) {
        segments.push({ text: plainText, colorIndex: 0 });
      }
    }
    const colorIndex = parseInt(match[1]) - 1;
    const taggedText = match[2];
    segments.push({ text: taggedText, colorIndex: Math.max(0, colorIndex) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      segments.push({ text: remainingText, colorIndex: 0 });
    }
  }
  return segments;
}
function getParsedFont(fontKey) {
  if (!parsedFonts[fontKey]) {
    const fontDef = fonts[fontKey];
    const parsedChars = {};
    for (const [char, lines] of Object.entries(fontDef.chars)) {
      parsedChars[char] = lines.map((line) => parseColorTags(line));
    }
    parsedFonts[fontKey] = {
      ...fontDef,
      colors: fontDef.colors || 1,
      chars: parsedChars
    };
  }
  return parsedFonts[fontKey];
}
function measureText({ text, font = "tiny" }) {
  const fontDef = getParsedFont(font);
  if (!fontDef) {
    console.warn(`Font '${font}' not found`);
    return { width: 0, height: 0 };
  }
  let currentX = 0;
  for (let i = 0;i < text.length; i++) {
    const char = text[i].toUpperCase();
    const charDef = fontDef.chars[char];
    if (!charDef) {
      const spaceChar = fontDef.chars[" "];
      if (spaceChar && spaceChar[0]) {
        let spaceWidth = 0;
        for (const segment of spaceChar[0]) {
          spaceWidth += segment.text.length;
        }
        currentX += spaceWidth;
      } else {
        currentX += 1;
      }
      continue;
    }
    let charWidth = 0;
    if (charDef[0]) {
      for (const segment of charDef[0]) {
        charWidth += segment.text.length;
      }
    }
    currentX += charWidth;
    if (i < text.length - 1) {
      currentX += fontDef.letterspace_size;
    }
  }
  return {
    width: currentX,
    height: fontDef.lines
  };
}
function getCharacterPositions(text, font = "tiny") {
  const fontDef = getParsedFont(font);
  if (!fontDef) {
    return [0];
  }
  const positions = [0];
  let currentX = 0;
  for (let i = 0;i < text.length; i++) {
    const char = text[i].toUpperCase();
    const charDef = fontDef.chars[char];
    let charWidth = 0;
    if (!charDef) {
      const spaceChar = fontDef.chars[" "];
      if (spaceChar && spaceChar[0]) {
        for (const segment of spaceChar[0]) {
          charWidth += segment.text.length;
        }
      } else {
        charWidth = 1;
      }
    } else if (charDef[0]) {
      for (const segment of charDef[0]) {
        charWidth += segment.text.length;
      }
    }
    currentX += charWidth;
    if (i < text.length - 1) {
      currentX += fontDef.letterspace_size;
    }
    positions.push(currentX);
  }
  return positions;
}
function coordinateToCharacterIndex(x, text, font = "tiny") {
  const positions = getCharacterPositions(text, font);
  if (x < 0) {
    return 0;
  }
  for (let i = 0;i < positions.length - 1; i++) {
    const currentPos = positions[i];
    const nextPos = positions[i + 1];
    if (x >= currentPos && x < nextPos) {
      const charMidpoint = currentPos + (nextPos - currentPos) / 2;
      return x < charMidpoint ? i : i + 1;
    }
  }
  if (positions.length > 0 && x >= positions[positions.length - 1]) {
    return text.length;
  }
  return 0;
}
function renderFontToFrameBuffer(buffer, {
  text,
  x = 0,
  y = 0,
  color = [RGBA.fromInts(255, 255, 255, 255)],
  backgroundColor = RGBA.fromInts(0, 0, 0, 255),
  font = "tiny"
}) {
  const width = buffer.width;
  const height = buffer.height;
  const fontDef = getParsedFont(font);
  if (!fontDef) {
    console.warn(`Font '${font}' not found`);
    return { width: 0, height: 0 };
  }
  const colors = Array.isArray(color) ? color : [color];
  if (y < 0 || y + fontDef.lines > height) {
    return { width: 0, height: fontDef.lines };
  }
  let currentX = x;
  const startX = x;
  for (let i = 0;i < text.length; i++) {
    const char = text[i].toUpperCase();
    const charDef = fontDef.chars[char];
    if (!charDef) {
      const spaceChar = fontDef.chars[" "];
      if (spaceChar && spaceChar[0]) {
        let spaceWidth = 0;
        for (const segment of spaceChar[0]) {
          spaceWidth += segment.text.length;
        }
        currentX += spaceWidth;
      } else {
        currentX += 1;
      }
      continue;
    }
    let charWidth = 0;
    if (charDef[0]) {
      for (const segment of charDef[0]) {
        charWidth += segment.text.length;
      }
    }
    if (currentX >= width)
      break;
    if (currentX + charWidth < 0) {
      currentX += charWidth + fontDef.letterspace_size;
      continue;
    }
    for (let lineIdx = 0;lineIdx < fontDef.lines && lineIdx < charDef.length; lineIdx++) {
      const segments = charDef[lineIdx];
      const renderY = y + lineIdx;
      if (renderY >= 0 && renderY < height) {
        let segmentX = currentX;
        for (const segment of segments) {
          const segmentColor = colors[segment.colorIndex] || colors[0];
          for (let charIdx = 0;charIdx < segment.text.length; charIdx++) {
            const renderX = segmentX + charIdx;
            if (renderX >= 0 && renderX < width) {
              const fontChar = segment.text[charIdx];
              if (fontChar !== " ") {
                buffer.setCellWithAlphaBlending(renderX, renderY, fontChar, parseColor(segmentColor), parseColor(backgroundColor));
              }
            }
          }
          segmentX += segment.text.length;
        }
      }
    }
    currentX += charWidth;
    if (i < text.length - 1) {
      currentX += fontDef.letterspace_size;
    }
  }
  return {
    width: currentX - startX,
    height: fontDef.lines
  };
}
// src/types.ts
var TextAttributes = {
  NONE: 0,
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  BLINK: 1 << 4,
  INVERSE: 1 << 5,
  HIDDEN: 1 << 6,
  STRIKETHROUGH: 1 << 7
};
var ATTRIBUTE_BASE_BITS = 8;
var ATTRIBUTE_BASE_MASK = 255;
function getBaseAttributes(attr) {
  return attr & ATTRIBUTE_BASE_MASK;
}
var DebugOverlayCorner;
((DebugOverlayCorner2) => {
  DebugOverlayCorner2[DebugOverlayCorner2["topLeft"] = 0] = "topLeft";
  DebugOverlayCorner2[DebugOverlayCorner2["topRight"] = 1] = "topRight";
  DebugOverlayCorner2[DebugOverlayCorner2["bottomLeft"] = 2] = "bottomLeft";
  DebugOverlayCorner2[DebugOverlayCorner2["bottomRight"] = 3] = "bottomRight";
})(DebugOverlayCorner ||= {});
var TargetChannel;
((TargetChannel2) => {
  TargetChannel2[TargetChannel2["FG"] = 1] = "FG";
  TargetChannel2[TargetChannel2["BG"] = 2] = "BG";
  TargetChannel2[TargetChannel2["Both"] = 3] = "Both";
})(TargetChannel ||= {});

// src/utils.ts
function createTextAttributes({
  bold = false,
  italic = false,
  underline = false,
  dim = false,
  blink = false,
  inverse = false,
  hidden = false,
  strikethrough = false
} = {}) {
  let attributes = TextAttributes.NONE;
  if (bold)
    attributes |= TextAttributes.BOLD;
  if (italic)
    attributes |= TextAttributes.ITALIC;
  if (underline)
    attributes |= TextAttributes.UNDERLINE;
  if (dim)
    attributes |= TextAttributes.DIM;
  if (blink)
    attributes |= TextAttributes.BLINK;
  if (inverse)
    attributes |= TextAttributes.INVERSE;
  if (hidden)
    attributes |= TextAttributes.HIDDEN;
  if (strikethrough)
    attributes |= TextAttributes.STRIKETHROUGH;
  return attributes;
}
var ATTRIBUTE_BASE_MASK2 = 255;
var LINK_ID_SHIFT = 8;
var LINK_ID_PAYLOAD_MASK = 16777215;
function attributesWithLink(baseAttributes, linkId) {
  const base = baseAttributes & ATTRIBUTE_BASE_MASK2;
  const linkBits = (linkId & LINK_ID_PAYLOAD_MASK) << LINK_ID_SHIFT;
  return base | linkBits;
}
function getLinkId(attributes) {
  return attributes >>> LINK_ID_SHIFT & LINK_ID_PAYLOAD_MASK;
}
function visualizeRenderableTree(renderable, maxDepth = 10) {
  function buildTreeLines(node, prefix = "", parentPrefix = "", isLastChild = true, depth = 0) {
    if (depth >= maxDepth) {
      return [`${prefix}${node.id} ... (max depth reached)`];
    }
    const lines = [];
    const children = node.getChildren();
    lines.push(`${prefix}${node.id}`);
    if (children.length > 0) {
      const lastChildIndex = children.length - 1;
      children.forEach((child, index) => {
        const childIsLast = index === lastChildIndex;
        const connector = childIsLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
        const childPrefix = parentPrefix + (isLastChild ? "    " : "\u2502   ");
        const childLines = buildTreeLines(child, childPrefix + connector, childPrefix, childIsLast, depth + 1);
        lines.push(...childLines);
      });
    }
    return lines;
  }
  const treeLines = buildTreeLines(renderable);
  console.log(`Renderable Tree:
` + treeLines.join(`
`));
}

// src/lib/styled-text.ts
var BrandedStyledText = Symbol.for("@opentui/core/StyledText");
function isStyledText(obj) {
  return obj && obj[BrandedStyledText];
}

class StyledText {
  [BrandedStyledText] = true;
  chunks;
  constructor(chunks) {
    this.chunks = chunks;
  }
}
function stringToStyledText(content) {
  const chunk = {
    __isChunk: true,
    text: content
  };
  return new StyledText([chunk]);
}
function applyStyle(input, style) {
  if (typeof input === "object" && "__isChunk" in input) {
    const existingChunk = input;
    const fg = style.fg ? parseColor(style.fg) : existingChunk.fg;
    const bg = style.bg ? parseColor(style.bg) : existingChunk.bg;
    const newAttrs = createTextAttributes(style);
    const mergedAttrs = existingChunk.attributes ? existingChunk.attributes | newAttrs : newAttrs;
    return {
      __isChunk: true,
      text: existingChunk.text,
      fg,
      bg,
      attributes: mergedAttrs,
      link: existingChunk.link
    };
  } else {
    const plainTextStr = String(input);
    const fg = style.fg ? parseColor(style.fg) : undefined;
    const bg = style.bg ? parseColor(style.bg) : undefined;
    const attributes = createTextAttributes(style);
    return {
      __isChunk: true,
      text: plainTextStr,
      fg,
      bg,
      attributes
    };
  }
}
var black = (input) => applyStyle(input, { fg: "black" });
var red = (input) => applyStyle(input, { fg: "red" });
var green = (input) => applyStyle(input, { fg: "green" });
var yellow = (input) => applyStyle(input, { fg: "yellow" });
var blue = (input) => applyStyle(input, { fg: "blue" });
var magenta = (input) => applyStyle(input, { fg: "magenta" });
var cyan = (input) => applyStyle(input, { fg: "cyan" });
var white = (input) => applyStyle(input, { fg: "white" });
var brightBlack = (input) => applyStyle(input, { fg: "brightBlack" });
var brightRed = (input) => applyStyle(input, { fg: "brightRed" });
var brightGreen = (input) => applyStyle(input, { fg: "brightGreen" });
var brightYellow = (input) => applyStyle(input, { fg: "brightYellow" });
var brightBlue = (input) => applyStyle(input, { fg: "brightBlue" });
var brightMagenta = (input) => applyStyle(input, { fg: "brightMagenta" });
var brightCyan = (input) => applyStyle(input, { fg: "brightCyan" });
var brightWhite = (input) => applyStyle(input, { fg: "brightWhite" });
var bgBlack = (input) => applyStyle(input, { bg: "black" });
var bgRed = (input) => applyStyle(input, { bg: "red" });
var bgGreen = (input) => applyStyle(input, { bg: "green" });
var bgYellow = (input) => applyStyle(input, { bg: "yellow" });
var bgBlue = (input) => applyStyle(input, { bg: "blue" });
var bgMagenta = (input) => applyStyle(input, { bg: "magenta" });
var bgCyan = (input) => applyStyle(input, { bg: "cyan" });
var bgWhite = (input) => applyStyle(input, { bg: "white" });
var bold = (input) => applyStyle(input, { bold: true });
var italic = (input) => applyStyle(input, { italic: true });
var underline = (input) => applyStyle(input, { underline: true });
var strikethrough = (input) => applyStyle(input, { strikethrough: true });
var dim = (input) => applyStyle(input, { dim: true });
var reverse = (input) => applyStyle(input, { reverse: true });
var blink = (input) => applyStyle(input, { blink: true });
var fg = (color) => (input) => applyStyle(input, { fg: color });
var bg = (color) => (input) => applyStyle(input, { bg: color });
var link = (url) => (input) => {
  const chunk = typeof input === "object" && "__isChunk" in input ? input : {
    __isChunk: true,
    text: String(input)
  };
  return {
    ...chunk,
    link: { url }
  };
};
function t(strings, ...values) {
  const chunks = [];
  for (let i = 0;i < strings.length; i++) {
    const raw = strings[i];
    if (raw) {
      chunks.push({
        __isChunk: true,
        text: raw,
        attributes: 0
      });
    }
    const val = values[i];
    if (typeof val === "object" && "__isChunk" in val) {
      chunks.push(val);
    } else if (val !== undefined) {
      const plainTextStr = String(val);
      chunks.push({
        __isChunk: true,
        text: plainTextStr,
        attributes: 0
      });
    }
  }
  return new StyledText(chunks);
}

// src/lib/hast-styled-text.ts
function hastToTextChunks(node, syntaxStyle, parentStyles = []) {
  const chunks = [];
  if (node.type === "text") {
    const stylesToMerge = parentStyles.length > 0 ? parentStyles : ["default"];
    const mergedStyle = syntaxStyle.mergeStyles(...stylesToMerge);
    chunks.push({
      __isChunk: true,
      text: node.value,
      fg: mergedStyle.fg,
      bg: mergedStyle.bg,
      attributes: mergedStyle.attributes
    });
  } else if (node.type === "element") {
    let currentStyles = [...parentStyles];
    if (node.properties?.className) {
      const classes = node.properties.className.split(" ");
      for (const cls of classes) {
        currentStyles.push(cls);
      }
    }
    for (const child of node.children) {
      chunks.push(...hastToTextChunks(child, syntaxStyle, currentStyles));
    }
  }
  return chunks;
}
function hastToStyledText(hast, syntaxStyle) {
  const chunks = hastToTextChunks(hast, syntaxStyle);
  return new StyledText(chunks);
}
// src/lib/clock.ts
class SystemClock {
  now() {
    if (!globalThis.performance || typeof globalThis.performance.now !== "function") {
      throw new Error("SystemClock requires globalThis.performance.now()");
    }
    return globalThis.performance.now();
  }
  setTimeout(fn, delayMs) {
    return globalThis.setTimeout(fn, delayMs);
  }
  clearTimeout(handle) {
    globalThis.clearTimeout(handle);
  }
  setInterval(fn, delayMs) {
    return globalThis.setInterval(fn, delayMs);
  }
  clearInterval(handle) {
    globalThis.clearInterval(handle);
  }
}
// src/lib/parse.keypress.ts
import { Buffer as Buffer2 } from "buffer";

// src/lib/parse.keypress-kitty.ts
var kittyKeyMap = {
  27: "escape",
  9: "tab",
  13: "return",
  127: "backspace",
  57344: "escape",
  57345: "return",
  57346: "tab",
  57347: "backspace",
  57348: "insert",
  57349: "delete",
  57350: "left",
  57351: "right",
  57352: "up",
  57353: "down",
  57354: "pageup",
  57355: "pagedown",
  57356: "home",
  57357: "end",
  57358: "capslock",
  57359: "scrolllock",
  57360: "numlock",
  57361: "printscreen",
  57362: "pause",
  57363: "menu",
  57364: "f1",
  57365: "f2",
  57366: "f3",
  57367: "f4",
  57368: "f5",
  57369: "f6",
  57370: "f7",
  57371: "f8",
  57372: "f9",
  57373: "f10",
  57374: "f11",
  57375: "f12",
  57376: "f13",
  57377: "f14",
  57378: "f15",
  57379: "f16",
  57380: "f17",
  57381: "f18",
  57382: "f19",
  57383: "f20",
  57384: "f21",
  57385: "f22",
  57386: "f23",
  57387: "f24",
  57388: "f25",
  57389: "f26",
  57390: "f27",
  57391: "f28",
  57392: "f29",
  57393: "f30",
  57394: "f31",
  57395: "f32",
  57396: "f33",
  57397: "f34",
  57398: "f35",
  57399: "kp0",
  57400: "kp1",
  57401: "kp2",
  57402: "kp3",
  57403: "kp4",
  57404: "kp5",
  57405: "kp6",
  57406: "kp7",
  57407: "kp8",
  57408: "kp9",
  57409: "kpdecimal",
  57410: "kpdivide",
  57411: "kpmultiply",
  57412: "kpminus",
  57413: "kpplus",
  57414: "kpenter",
  57415: "kpequal",
  57416: "kpseparator",
  57417: "kpleft",
  57418: "kpright",
  57419: "kpup",
  57420: "kpdown",
  57421: "kppageup",
  57422: "kppagedown",
  57423: "kphome",
  57424: "kpend",
  57425: "kpinsert",
  57426: "kpdelete",
  57427: "clear",
  57428: "mediaplay",
  57429: "mediapause",
  57430: "mediaplaypause",
  57431: "mediareverse",
  57432: "mediastop",
  57433: "mediafastforward",
  57434: "mediarewind",
  57435: "medianext",
  57436: "mediaprev",
  57437: "mediarecord",
  57438: "volumedown",
  57439: "volumeup",
  57440: "mute",
  57441: "leftshift",
  57442: "leftctrl",
  57443: "leftalt",
  57444: "leftsuper",
  57445: "lefthyper",
  57446: "leftmeta",
  57447: "rightshift",
  57448: "rightctrl",
  57449: "rightalt",
  57450: "rightsuper",
  57451: "righthyper",
  57452: "rightmeta",
  57453: "iso_level3_shift",
  57454: "iso_level5_shift"
};
var kittyNamedSingleStrokeKeys = [...new Set(Object.values(kittyKeyMap))];
var printableKeypadText = {
  kp0: "0",
  kp1: "1",
  kp2: "2",
  kp3: "3",
  kp4: "4",
  kp5: "5",
  kp6: "6",
  kp7: "7",
  kp8: "8",
  kp9: "9",
  kpdecimal: ".",
  kpdivide: "/",
  kpmultiply: "*",
  kpminus: "-",
  kpplus: "+",
  kpequal: "=",
  kpseparator: ","
};
function getPrintableKittyKeyText(key) {
  return printableKeypadText[key.name];
}
function fromKittyMods(mod) {
  return {
    shift: !!(mod & 1),
    alt: !!(mod & 2),
    ctrl: !!(mod & 4),
    super: !!(mod & 8),
    hyper: !!(mod & 16),
    meta: !!(mod & 32),
    capsLock: !!(mod & 64),
    numLock: !!(mod & 128)
  };
}
var functionalKeyMap = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  E: "clear",
  P: "f1",
  Q: "f2",
  S: "f4"
};
var tildeKeyMap = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
  "11": "f1",
  "12": "f2",
  "13": "f3",
  "14": "f4",
  "15": "f5",
  "17": "f6",
  "18": "f7",
  "19": "f8",
  "20": "f9",
  "21": "f10",
  "23": "f11",
  "24": "f12",
  "29": "menu",
  "57427": "clear"
};
function parseKittySpecialKey(sequence) {
  const specialKeyRe = /^\x1b\[(\d+);(\d+):(\d+)([A-Z~])$/;
  const match = specialKeyRe.exec(sequence);
  if (!match)
    return null;
  const keyNumOrOne = match[1];
  const modifierStr = match[2];
  const eventTypeStr = match[3];
  const terminator = match[4];
  let keyName;
  if (terminator === "~") {
    keyName = tildeKeyMap[keyNumOrOne];
  } else {
    if (keyNumOrOne !== "1")
      return null;
    keyName = functionalKeyMap[terminator];
  }
  if (!keyName)
    return null;
  const key = {
    name: keyName,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence,
    raw: sequence,
    eventType: "press",
    source: "kitty",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false
  };
  if (modifierStr) {
    const modifierMask = parseInt(modifierStr, 10);
    if (!isNaN(modifierMask) && modifierMask > 1) {
      const mods = fromKittyMods(modifierMask - 1);
      key.shift = mods.shift;
      key.ctrl = mods.ctrl;
      key.meta = mods.alt || mods.meta;
      key.option = mods.alt;
      key.super = mods.super;
      key.hyper = mods.hyper;
      key.capsLock = mods.capsLock;
      key.numLock = mods.numLock;
    }
  }
  if (eventTypeStr === "1" || !eventTypeStr) {
    key.eventType = "press";
  } else if (eventTypeStr === "2") {
    key.eventType = "press";
    key.repeated = true;
  } else if (eventTypeStr === "3") {
    key.eventType = "release";
  }
  return key;
}
function parseKittyKeyboard(sequence) {
  const specialResult = parseKittySpecialKey(sequence);
  if (specialResult)
    return specialResult;
  const kittyRe = /^\x1b\[([^\x1b]+)u$/;
  const match = kittyRe.exec(sequence);
  if (!match)
    return null;
  const params = match[1];
  const fields = params.split(";");
  if (fields.length < 1)
    return null;
  const key = {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence,
    raw: sequence,
    eventType: "press",
    source: "kitty",
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false
  };
  let text = "";
  const field1 = fields[0]?.split(":") || [];
  const codepointStr = field1[0];
  if (!codepointStr)
    return null;
  const codepoint = parseInt(codepointStr, 10);
  if (isNaN(codepoint))
    return null;
  let shiftedCodepoint;
  let baseCodepoint;
  if (field1[1]) {
    const shifted = parseInt(field1[1], 10);
    if (!isNaN(shifted) && shifted > 0 && shifted <= 1114111) {
      shiftedCodepoint = shifted;
    }
  }
  if (field1[2]) {
    const base = parseInt(field1[2], 10);
    if (!isNaN(base) && base > 0 && base <= 1114111) {
      baseCodepoint = base;
    }
  }
  const knownKey = kittyKeyMap[codepoint];
  if (knownKey) {
    key.name = knownKey;
    key.code = `[${codepoint}u`;
  } else if (codepoint === 0) {
    key.name = "";
  } else {
    if (codepoint > 0 && codepoint <= 1114111) {
      const char = String.fromCodePoint(codepoint);
      key.name = char === " " ? "space" : char;
      if (baseCodepoint) {
        key.baseCode = baseCodepoint;
      }
    } else {
      return null;
    }
  }
  if (fields[1]) {
    const field2 = fields[1].split(":");
    const modifierStr = field2[0];
    const eventTypeStr = field2[1];
    if (modifierStr) {
      const modifierMask = parseInt(modifierStr, 10);
      if (!isNaN(modifierMask) && modifierMask > 1) {
        const mods = fromKittyMods(modifierMask - 1);
        key.shift = mods.shift;
        key.ctrl = mods.ctrl;
        key.meta = mods.alt || mods.meta;
        key.option = mods.alt;
        key.super = mods.super;
        key.hyper = mods.hyper;
        key.capsLock = mods.capsLock;
        key.numLock = mods.numLock;
      }
    }
    if (eventTypeStr === "1" || !eventTypeStr) {
      key.eventType = "press";
    } else if (eventTypeStr === "2") {
      key.eventType = "press";
      key.repeated = true;
    } else if (eventTypeStr === "3") {
      key.eventType = "release";
    } else {
      key.eventType = "press";
    }
  }
  if (fields[2]) {
    const codepoints = fields[2].split(":");
    for (const cpStr of codepoints) {
      const cp = parseInt(cpStr, 10);
      if (!isNaN(cp) && cp > 0 && cp <= 1114111) {
        text += String.fromCodePoint(cp);
      }
    }
  }
  if (text === "") {
    text = getPrintableKittyKeyText(key) ?? "";
  }
  if (text === "") {
    const isPrintable = key.name.length > 0 && !kittyKeyMap[codepoint];
    if (isPrintable) {
      if (codepoint === 32) {
        text = " ";
      } else if (key.shift && shiftedCodepoint) {
        text = String.fromCodePoint(shiftedCodepoint);
      } else if (key.shift && key.name.length === 1) {
        text = key.name.toLocaleUpperCase();
      } else {
        text = key.name;
      }
    }
  }
  if (text) {
    if (codepoint === 0) {
      key.name = text;
    }
    key.sequence = text;
  }
  if (codepoint === 0 && text === "") {
    return null;
  }
  return key;
}

// src/lib/parse.keypress.ts
var metaKeyCodeRe = /^(?:\x1b)([a-zA-Z0-9])$/;
var fnKeyRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;
var keyName = {
  OP: "f1",
  OQ: "f2",
  OR: "f3",
  OS: "f4",
  "[11~": "f1",
  "[12~": "f2",
  "[13~": "f3",
  "[14~": "f4",
  "[[A": "f1",
  "[[B": "f2",
  "[[C": "f3",
  "[[D": "f4",
  "[[E": "f5",
  "[15~": "f5",
  "[17~": "f6",
  "[18~": "f7",
  "[19~": "f8",
  "[20~": "f9",
  "[21~": "f10",
  "[23~": "f11",
  "[24~": "f12",
  "[29~": "menu",
  "[57427~": "clear",
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  "[E": "clear",
  "[F": "end",
  "[H": "home",
  "[P": "f1",
  "[Q": "f2",
  "[S": "f4",
  OA: "up",
  OB: "down",
  OC: "right",
  OD: "left",
  OE: "clear",
  OF: "end",
  OH: "home",
  OM: "return",
  Oj: "*",
  Ok: "+",
  Ol: ",",
  Om: "-",
  On: ".",
  Oo: "/",
  Op: "0",
  Oq: "1",
  Or: "2",
  Os: "3",
  Ot: "4",
  Ou: "5",
  Ov: "6",
  Ow: "7",
  Ox: "8",
  Oy: "9",
  OX: "=",
  "[1~": "home",
  "[2~": "insert",
  "[3~": "delete",
  "[4~": "end",
  "[5~": "pageup",
  "[6~": "pagedown",
  "[[5~": "pageup",
  "[[6~": "pagedown",
  "[7~": "home",
  "[8~": "end",
  "[a": "up",
  "[b": "down",
  "[c": "right",
  "[d": "left",
  "[e": "clear",
  f: "right",
  b: "left",
  p: "up",
  n: "down",
  "[2$": "insert",
  "[3$": "delete",
  "[5$": "pageup",
  "[6$": "pagedown",
  "[7$": "home",
  "[8$": "end",
  Oa: "up",
  Ob: "down",
  Oc: "right",
  Od: "left",
  Oe: "clear",
  "[2^": "insert",
  "[3^": "delete",
  "[5^": "pageup",
  "[6^": "pagedown",
  "[7^": "home",
  "[8^": "end",
  "[Z": "tab"
};
var nonAlphanumericKeys = [...Object.values(keyName), "backspace"];
var terminalNamedSingleStrokeKeys = [
  ...new Set(["return", "linefeed", "tab", "escape", "space", ...nonAlphanumericKeys, ...kittyNamedSingleStrokeKeys])
];
var isShiftKey = (code) => {
  return ["[a", "[b", "[c", "[d", "[e", "[2$", "[3$", "[5$", "[6$", "[7$", "[8$", "[Z"].includes(code);
};
var isCtrlKey = (code) => {
  return ["Oa", "Ob", "Oc", "Od", "Oe", "[2^", "[3^", "[5^", "[6^", "[7^", "[8^"].includes(code);
};
var getCtrlKeyName = (charCode) => {
  if (charCode === 0) {
    return "space";
  }
  if (charCode >= 1 && charCode <= 26) {
    return String.fromCharCode(charCode + 97 - 1);
  }
  if (charCode >= 28 && charCode <= 31) {
    return String.fromCharCode(charCode + 64);
  }
  return;
};
var ss3NumpadPrintable = {
  Op: "0",
  Oq: "1",
  Or: "2",
  Os: "3",
  Ot: "4",
  Ou: "5",
  Ov: "6",
  Ow: "7",
  Ox: "8",
  Oy: "9",
  Oj: "*",
  Ok: "+",
  Ol: ",",
  Om: "-",
  On: ".",
  Oo: "/",
  OX: "="
};
var modifyOtherKeysRe = /^\x1b\[27;(\d+);(\d+)~$/;
var parseKeypress = (s = "", options = {}) => {
  let parts;
  if (Buffer2.isBuffer(s)) {
    if (s[0] > 127 && s[1] === undefined) {
      s[0] -= 128;
      s = "\x1B" + String(s);
    } else {
      s = String(s);
    }
  } else if (s !== undefined && typeof s !== "string") {
    s = String(s);
  } else if (!s) {
    s = "";
  }
  if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(s)) {
    return null;
  }
  if (/^\[<\d+;\d+;\d+[Mm]$/.test(s)) {
    return null;
  }
  if (/^\x1b\[<[\d;]*$/.test(s)) {
    return null;
  }
  if (/^\[<[\d;]*$/.test(s)) {
    return null;
  }
  if (s.startsWith("\x1B[M") && s.length >= 6) {
    return null;
  }
  if (/^\x1b\[\d+;\d+;\d+t$/.test(s)) {
    return null;
  }
  if (/^\x1b\[\d+;\d+R$/.test(s)) {
    return null;
  }
  if (/^\x1b\[\?[\d;]+c$/.test(s)) {
    return null;
  }
  if (/^\x1b\[\?[\d;]+\$y$/.test(s)) {
    return null;
  }
  if (s === "\x1B[I" || s === "\x1B[O") {
    return null;
  }
  if (/^\x1b\][\d;].*(\x1b\\|\x07)$/.test(s)) {
    return null;
  }
  if (s === "\x1B[200~" || s === "\x1B[201~") {
    return null;
  }
  const key = {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    number: false,
    sequence: s,
    raw: s,
    eventType: "press",
    source: "raw"
  };
  key.sequence = key.sequence || s || key.name;
  const ctrlKeyName = s.length === 1 ? getCtrlKeyName(s.charCodeAt(0)) : undefined;
  const metaCtrlKeyName = s.length === 2 && s[0] === "\x1B" ? getCtrlKeyName(s.charCodeAt(1)) : undefined;
  if (options.useKittyKeyboard) {
    const kittyResult = parseKittyKeyboard(s);
    if (kittyResult) {
      return kittyResult;
    }
  }
  const modifyOtherKeysMatch = modifyOtherKeysRe.exec(s);
  if (modifyOtherKeysMatch) {
    const modifier = parseInt(modifyOtherKeysMatch[1], 10) - 1;
    const charCode = parseInt(modifyOtherKeysMatch[2], 10);
    key.ctrl = !!(modifier & 4);
    key.meta = !!(modifier & 2);
    key.shift = !!(modifier & 1);
    key.option = !!(modifier & 2);
    key.super = !!(modifier & 8);
    key.hyper = !!(modifier & 16);
    if (charCode === 13) {
      key.name = "return";
    } else if (charCode === 27) {
      key.name = "escape";
    } else if (charCode === 9) {
      key.name = "tab";
    } else if (charCode === 32) {
      key.name = "space";
    } else if (charCode === 127 || charCode === 8) {
      key.name = "backspace";
    } else {
      const char = String.fromCharCode(charCode);
      key.name = char;
      key.sequence = char;
      if (charCode >= 48 && charCode <= 57) {
        key.number = true;
      }
    }
    return key;
  }
  if (s === "\r" || s === "\x1B\r") {
    key.name = "return";
    key.meta = s.length === 2;
  } else if (s === `
` || s === `\x1B
`) {
    key.name = "linefeed";
    key.meta = s.length === 2;
  } else if (s === "\t") {
    key.name = "tab";
  } else if (s === "\b" || s === "\x1B\b" || s === "\x7F" || s === "\x1B\x7F") {
    key.name = "backspace";
    key.meta = s.charAt(0) === "\x1B";
  } else if (s === "\x1B" || s === "\x1B\x1B") {
    key.name = "escape";
    key.meta = s.length === 2;
  } else if (s === " " || s === "\x1B ") {
    key.name = "space";
    key.meta = s.length === 2;
  } else if (ctrlKeyName) {
    key.name = ctrlKeyName;
    key.ctrl = true;
  } else if (s.length === 1 && s >= "0" && s <= "9") {
    key.name = s;
    key.number = true;
  } else if (s.length === 1 && s >= "a" && s <= "z") {
    key.name = s;
  } else if (s.length === 1 && s >= "A" && s <= "Z") {
    key.name = s.toLowerCase();
    key.shift = true;
  } else if (s.length === 1 || s.length === 2 && s.codePointAt(0) > 65535) {
    key.name = s;
  } else if (parts = metaKeyCodeRe.exec(s)) {
    key.meta = true;
    const char = parts[1];
    const isUpperCase = /^[A-Z]$/.test(char);
    if (char === "F") {
      key.name = "right";
    } else if (char === "B") {
      key.name = "left";
    } else if (isUpperCase) {
      key.shift = true;
      key.name = char;
    } else {
      key.name = char;
    }
  } else if (metaCtrlKeyName) {
    key.meta = true;
    key.ctrl = true;
    key.name = metaCtrlKeyName;
  } else if (parts = fnKeyRe.exec(s)) {
    const segs = [...s];
    if (segs[0] === "\x1B" && segs[1] === "\x1B") {
      key.option = true;
      key.meta = true;
    }
    const code = [parts[1], parts[2], parts[4], parts[6]].filter(Boolean).join("");
    const modifier = parseInt(parts[3] || parts[5] || "1", 10) - 1;
    key.ctrl = key.ctrl || !!(modifier & 4);
    key.meta = key.meta || !!(modifier & 2);
    key.shift = key.shift || !!(modifier & 1);
    key.option = key.option || !!(modifier & 2);
    key.super = !!(modifier & 8);
    key.hyper = !!(modifier & 16);
    key.code = code;
    const keyNameResult = keyName[code];
    if (keyNameResult) {
      key.name = keyNameResult;
      key.shift = isShiftKey(code) || key.shift;
      key.ctrl = isCtrlKey(code) || key.ctrl;
      const ss3Char = ss3NumpadPrintable[code];
      if (ss3Char !== undefined) {
        key.sequence = ss3Char;
        if (key.name >= "0" && key.name <= "9") {
          key.number = true;
        }
      }
    } else {
      key.name = "";
      key.code = undefined;
    }
  } else if (s === "\x1B[3~") {
    key.name = "delete";
    key.meta = false;
    key.code = "[3~";
  }
  return key;
};
// src/lib/scroll-acceleration.ts
class LinearScrollAccel {
  tick(_now) {
    return 1;
  }
  reset() {}
}

class MacOSScrollAccel {
  opts;
  lastTickTime = 0;
  velocityHistory = [];
  historySize = 3;
  streakTimeout = 150;
  minTickInterval = 6;
  constructor(opts = {}) {
    this.opts = opts;
  }
  tick(now = Date.now()) {
    const A = this.opts.A ?? 0.8;
    const tau = this.opts.tau ?? 3;
    const maxMultiplier = this.opts.maxMultiplier ?? 6;
    const dt = this.lastTickTime ? now - this.lastTickTime : Infinity;
    if (dt === Infinity || dt > this.streakTimeout) {
      this.lastTickTime = now;
      this.velocityHistory = [];
      return 1;
    }
    if (dt < this.minTickInterval) {
      return 1;
    }
    this.lastTickTime = now;
    this.velocityHistory.push(dt);
    if (this.velocityHistory.length > this.historySize) {
      this.velocityHistory.shift();
    }
    const avgInterval = this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length;
    const referenceInterval = 100;
    const velocity = referenceInterval / avgInterval;
    const x = velocity / tau;
    const multiplier = 1 + A * (Math.exp(x) - 1);
    return Math.min(multiplier, maxMultiplier);
  }
  reset() {
    this.lastTickTime = 0;
    this.velocityHistory = [];
  }
}
// src/lib/yoga.options.ts
function parseAlign(value) {
  if (value == null) {
    return 0 /* Auto */;
  }
  switch (value.toLowerCase()) {
    case "auto":
      return 0 /* Auto */;
    case "flex-start":
      return 1 /* FlexStart */;
    case "center":
      return 2 /* Center */;
    case "flex-end":
      return 3 /* FlexEnd */;
    case "stretch":
      return 4 /* Stretch */;
    case "baseline":
      return 5 /* Baseline */;
    case "space-between":
      return 6 /* SpaceBetween */;
    case "space-around":
      return 7 /* SpaceAround */;
    case "space-evenly":
      return 8 /* SpaceEvenly */;
    default:
      return 0 /* Auto */;
  }
}
function parseAlignItems(value) {
  if (value == null) {
    return 4 /* Stretch */;
  }
  switch (value.toLowerCase()) {
    case "auto":
      return 0 /* Auto */;
    case "flex-start":
      return 1 /* FlexStart */;
    case "center":
      return 2 /* Center */;
    case "flex-end":
      return 3 /* FlexEnd */;
    case "stretch":
      return 4 /* Stretch */;
    case "baseline":
      return 5 /* Baseline */;
    case "space-between":
      return 6 /* SpaceBetween */;
    case "space-around":
      return 7 /* SpaceAround */;
    case "space-evenly":
      return 8 /* SpaceEvenly */;
    default:
      return 4 /* Stretch */;
  }
}
function parseBoxSizing(value) {
  if (value == null) {
    return 0 /* BorderBox */;
  }
  switch (value.toLowerCase()) {
    case "border-box":
      return 0 /* BorderBox */;
    case "content-box":
      return 1 /* ContentBox */;
    default:
      return 0 /* BorderBox */;
  }
}
function parseDimension(value) {
  if (value == null) {
    return 0 /* Width */;
  }
  switch (value.toLowerCase()) {
    case "width":
      return 0 /* Width */;
    case "height":
      return 1 /* Height */;
    default:
      return 0 /* Width */;
  }
}
function parseDirection(value) {
  if (value == null) {
    return 1 /* LTR */;
  }
  switch (value.toLowerCase()) {
    case "inherit":
      return 0 /* Inherit */;
    case "ltr":
      return 1 /* LTR */;
    case "rtl":
      return 2 /* RTL */;
    default:
      return 1 /* LTR */;
  }
}
function parseDisplay(value) {
  if (value == null) {
    return 0 /* Flex */;
  }
  switch (value.toLowerCase()) {
    case "flex":
      return 0 /* Flex */;
    case "none":
      return 1 /* None */;
    case "contents":
      return 2 /* Contents */;
    default:
      return 0 /* Flex */;
  }
}
function parseEdge(value) {
  if (value == null) {
    return 8 /* All */;
  }
  switch (value.toLowerCase()) {
    case "left":
      return 0 /* Left */;
    case "top":
      return 1 /* Top */;
    case "right":
      return 2 /* Right */;
    case "bottom":
      return 3 /* Bottom */;
    case "start":
      return 4 /* Start */;
    case "end":
      return 5 /* End */;
    case "horizontal":
      return 6 /* Horizontal */;
    case "vertical":
      return 7 /* Vertical */;
    case "all":
      return 8 /* All */;
    default:
      return 8 /* All */;
  }
}
function parseFlexDirection(value) {
  if (value == null) {
    return 0 /* Column */;
  }
  switch (value.toLowerCase()) {
    case "column":
      return 0 /* Column */;
    case "column-reverse":
      return 1 /* ColumnReverse */;
    case "row":
      return 2 /* Row */;
    case "row-reverse":
      return 3 /* RowReverse */;
    default:
      return 0 /* Column */;
  }
}
function parseGutter(value) {
  if (value == null) {
    return 2 /* All */;
  }
  switch (value.toLowerCase()) {
    case "column":
      return 0 /* Column */;
    case "row":
      return 1 /* Row */;
    case "all":
      return 2 /* All */;
    default:
      return 2 /* All */;
  }
}
function parseJustify(value) {
  if (value == null) {
    return 0 /* FlexStart */;
  }
  switch (value.toLowerCase()) {
    case "flex-start":
      return 0 /* FlexStart */;
    case "center":
      return 1 /* Center */;
    case "flex-end":
      return 2 /* FlexEnd */;
    case "space-between":
      return 3 /* SpaceBetween */;
    case "space-around":
      return 4 /* SpaceAround */;
    case "space-evenly":
      return 5 /* SpaceEvenly */;
    default:
      return 0 /* FlexStart */;
  }
}
function parseLogLevel(value) {
  if (value == null) {
    return 2 /* Info */;
  }
  switch (value.toLowerCase()) {
    case "error":
      return 0 /* Error */;
    case "warn":
      return 1 /* Warn */;
    case "info":
      return 2 /* Info */;
    case "debug":
      return 3 /* Debug */;
    case "verbose":
      return 4 /* Verbose */;
    case "fatal":
      return 5 /* Fatal */;
    default:
      return 2 /* Info */;
  }
}
function parseMeasureMode(value) {
  if (value == null) {
    return 0 /* Undefined */;
  }
  switch (value.toLowerCase()) {
    case "undefined":
      return 0 /* Undefined */;
    case "exactly":
      return 1 /* Exactly */;
    case "at-most":
      return 2 /* AtMost */;
    default:
      return 0 /* Undefined */;
  }
}
function parseOverflow(value) {
  if (value == null) {
    return 0 /* Visible */;
  }
  switch (value.toLowerCase()) {
    case "visible":
      return 0 /* Visible */;
    case "hidden":
      return 1 /* Hidden */;
    case "scroll":
      return 2 /* Scroll */;
    default:
      return 0 /* Visible */;
  }
}
function parsePositionType(value) {
  if (value == null) {
    return 1 /* Relative */;
  }
  switch (value.toLowerCase()) {
    case "static":
      return 0 /* Static */;
    case "relative":
      return 1 /* Relative */;
    case "absolute":
      return 2 /* Absolute */;
    default:
      return 0 /* Static */;
  }
}
function parseUnit(value) {
  if (value == null) {
    return 1 /* Point */;
  }
  switch (value.toLowerCase()) {
    case "undefined":
      return 0 /* Undefined */;
    case "point":
      return 1 /* Point */;
    case "percent":
      return 2 /* Percent */;
    case "auto":
      return 3 /* Auto */;
    default:
      return 1 /* Point */;
  }
}
function parseWrap(value) {
  if (value == null) {
    return 0 /* NoWrap */;
  }
  switch (value.toLowerCase()) {
    case "no-wrap":
      return 0 /* NoWrap */;
    case "wrap":
      return 1 /* Wrap */;
    case "wrap-reverse":
      return 2 /* WrapReverse */;
    default:
      return 0 /* NoWrap */;
  }
}
// src/lib/parse.mouse.ts
class MouseParser {
  mouseButtonsPressed = new Set;
  static SCROLL_DIRECTIONS = {
    0: "up",
    1: "down",
    2: "left",
    3: "right"
  };
  reset() {
    this.mouseButtonsPressed.clear();
  }
  decodeInput(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return buf.toString("latin1");
  }
  parseMouseEvent(data) {
    const str = this.decodeInput(data);
    const parsed = this.parseMouseSequenceAt(str, 0);
    return parsed?.event ?? null;
  }
  parseAllMouseEvents(data) {
    const str = this.decodeInput(data);
    const events = [];
    let offset = 0;
    while (offset < str.length) {
      const parsed = this.parseMouseSequenceAt(str, offset);
      if (!parsed) {
        break;
      }
      events.push(parsed.event);
      offset += parsed.consumed;
    }
    return events;
  }
  parseMouseSequenceAt(str, offset) {
    if (!str.startsWith("\x1B[", offset))
      return null;
    const introducer = str[offset + 2];
    if (introducer === "<") {
      return this.parseSgrSequence(str, offset);
    }
    if (introducer === "M") {
      return this.parseBasicSequence(str, offset);
    }
    return null;
  }
  parseSgrSequence(str, offset) {
    let index = offset + 3;
    const values = [0, 0, 0];
    let part = 0;
    let hasDigit = false;
    while (index < str.length) {
      const char = str[index];
      const charCode = str.charCodeAt(index);
      if (charCode >= 48 && charCode <= 57) {
        hasDigit = true;
        values[part] = values[part] * 10 + (charCode - 48);
        index++;
        continue;
      }
      switch (char) {
        case ";": {
          if (!hasDigit || part >= 2)
            return null;
          part++;
          hasDigit = false;
          index++;
          break;
        }
        case "M":
        case "m": {
          if (!hasDigit || part !== 2)
            return null;
          return {
            event: this.decodeSgrEvent(values[0], values[1], values[2], char),
            consumed: index - offset + 1
          };
        }
        default:
          return null;
      }
    }
    return null;
  }
  parseBasicSequence(str, offset) {
    if (offset + 6 > str.length)
      return null;
    const buttonByte = str.charCodeAt(offset + 3) - 32;
    const x = str.charCodeAt(offset + 4) - 33;
    const y = str.charCodeAt(offset + 5) - 33;
    return {
      event: this.decodeBasicEvent(buttonByte, x, y),
      consumed: 6
    };
  }
  decodeSgrEvent(rawButtonCode, wireX, wireY, pressRelease) {
    const button = rawButtonCode & 3;
    const isScroll = (rawButtonCode & 64) !== 0;
    const scrollDirection = !isScroll ? undefined : MouseParser.SCROLL_DIRECTIONS[button];
    const isMotion = (rawButtonCode & 32) !== 0;
    const modifiers = {
      shift: (rawButtonCode & 4) !== 0,
      alt: (rawButtonCode & 8) !== 0,
      ctrl: (rawButtonCode & 16) !== 0
    };
    let type;
    let scrollInfo;
    if (isMotion) {
      const isDragging = this.mouseButtonsPressed.size > 0;
      if (button === 3) {
        type = "move";
      } else if (isDragging) {
        type = "drag";
      } else {
        type = "move";
      }
    } else if (isScroll && pressRelease === "M") {
      type = "scroll";
      scrollInfo = {
        direction: scrollDirection,
        delta: 1
      };
    } else {
      type = pressRelease === "M" ? "down" : "up";
      if (type === "down" && button !== 3) {
        this.mouseButtonsPressed.add(button);
      } else if (type === "up") {
        this.mouseButtonsPressed.clear();
      }
    }
    return {
      type,
      button: button === 3 ? 0 : button,
      x: wireX - 1,
      y: wireY - 1,
      modifiers,
      scroll: scrollInfo
    };
  }
  decodeBasicEvent(buttonByte, x, y) {
    const button = buttonByte & 3;
    const isScroll = (buttonByte & 64) !== 0;
    const isMotion = (buttonByte & 32) !== 0;
    const scrollDirection = !isScroll ? undefined : MouseParser.SCROLL_DIRECTIONS[button];
    const modifiers = {
      shift: (buttonByte & 4) !== 0,
      alt: (buttonByte & 8) !== 0,
      ctrl: (buttonByte & 16) !== 0
    };
    let type;
    let actualButton;
    let scrollInfo;
    if (isMotion) {
      type = "move";
      actualButton = button === 3 ? -1 : button;
    } else if (isScroll) {
      type = "scroll";
      actualButton = 0;
      scrollInfo = {
        direction: scrollDirection,
        delta: 1
      };
    } else {
      type = button === 3 ? "up" : "down";
      actualButton = button === 3 ? 0 : button;
    }
    return {
      type,
      button: actualButton,
      x,
      y,
      modifiers,
      scroll: scrollInfo
    };
  }
}
// src/lib/selection.ts
class SelectionAnchor {
  renderable;
  relativeX;
  relativeY;
  constructor(renderable, absoluteX, absoluteY) {
    this.renderable = renderable;
    this.relativeX = absoluteX - this.renderable.x;
    this.relativeY = absoluteY - this.renderable.y;
  }
  get x() {
    return this.renderable.x + this.relativeX;
  }
  get y() {
    return this.renderable.y + this.relativeY;
  }
}

class Selection {
  _anchor;
  _focus;
  _selectedRenderables = [];
  _touchedRenderables = [];
  _isActive = true;
  _isDragging = true;
  _isStart = false;
  constructor(anchorRenderable, anchor, focus) {
    this._anchor = new SelectionAnchor(anchorRenderable, anchor.x, anchor.y);
    this._focus = { ...focus };
  }
  get isStart() {
    return this._isStart;
  }
  set isStart(value) {
    this._isStart = value;
  }
  get anchor() {
    return { x: this._anchor.x, y: this._anchor.y };
  }
  get focus() {
    return { ...this._focus };
  }
  set focus(value) {
    this._focus = { ...value };
  }
  get isActive() {
    return this._isActive;
  }
  set isActive(value) {
    this._isActive = value;
  }
  get isDragging() {
    return this._isDragging;
  }
  set isDragging(value) {
    this._isDragging = value;
  }
  get bounds() {
    const minX = Math.min(this._anchor.x, this._focus.x);
    const maxX = Math.max(this._anchor.x, this._focus.x);
    const minY = Math.min(this._anchor.y, this._focus.y);
    const maxY = Math.max(this._anchor.y, this._focus.y);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return {
      x: minX,
      y: minY,
      width,
      height
    };
  }
  updateSelectedRenderables(selectedRenderables) {
    this._selectedRenderables = selectedRenderables;
  }
  get selectedRenderables() {
    return this._selectedRenderables;
  }
  updateTouchedRenderables(touchedRenderables) {
    this._touchedRenderables = touchedRenderables;
  }
  get touchedRenderables() {
    return this._touchedRenderables;
  }
  getSelectedText() {
    const selectedTextsByLine = new Map;
    const selectedRenderables = this._selectedRenderables.sort((a, b) => {
      const aY = a.y;
      const bY = b.y;
      if (aY !== bY) {
        return aY - bY;
      }
      return a.x - b.x;
    }).filter((renderable) => !renderable.isDestroyed);
    for (const renderable of selectedRenderables) {
      const text = renderable.getSelectedText();
      if (!text)
        continue;
      const lines = text.split(`
`);
      for (let index = 0;index < lines.length; index += 1) {
        const y = renderable.y + index;
        const line = selectedTextsByLine.get(y) ?? [];
        line.push({ x: renderable.x, text: lines[index] });
        selectedTextsByLine.set(y, line);
      }
    }
    return [...selectedTextsByLine.entries()].sort(([leftY], [rightY]) => leftY - rightY).map(([, line]) => line.sort((left, right) => left.x - right.x).map((segment) => segment.text).join("")).join(`
`);
  }
}
function convertGlobalToLocalSelection(globalSelection, localX, localY) {
  if (!globalSelection?.isActive) {
    return null;
  }
  return {
    anchorX: globalSelection.anchor.x - localX,
    anchorY: globalSelection.anchor.y - localY,
    focusX: globalSelection.focus.x - localX,
    focusY: globalSelection.focus.y - localY,
    isActive: true
  };
}

class ASCIIFontSelectionHelper {
  getText;
  getFont;
  localSelection = null;
  constructor(getText, getFont) {
    this.getText = getText;
    this.getFont = getFont;
  }
  hasSelection() {
    return this.localSelection !== null;
  }
  getSelection() {
    return this.localSelection;
  }
  shouldStartSelection(localX, localY, width, height) {
    if (localX < 0 || localX >= width || localY < 0 || localY >= height) {
      return false;
    }
    const text = this.getText();
    const font = this.getFont();
    const charIndex = coordinateToCharacterIndex(localX, text, font);
    return charIndex >= 0 && charIndex <= text.length;
  }
  onLocalSelectionChanged(localSelection, width, height) {
    const previousSelection = this.localSelection;
    if (!localSelection?.isActive) {
      this.localSelection = null;
      return previousSelection !== null;
    }
    const text = this.getText();
    const font = this.getFont();
    const selStart = { x: localSelection.anchorX, y: localSelection.anchorY };
    const selEnd = { x: localSelection.focusX, y: localSelection.focusY };
    if (height - 1 < selStart.y || 0 > selEnd.y) {
      this.localSelection = null;
      return previousSelection !== null;
    }
    let startCharIndex = 0;
    let endCharIndex = text.length;
    if (selStart.y > height - 1) {
      this.localSelection = null;
      return previousSelection !== null;
    } else if (selStart.y >= 0 && selStart.y <= height - 1) {
      if (selStart.x > 0) {
        startCharIndex = coordinateToCharacterIndex(selStart.x, text, font);
      }
    }
    if (selEnd.y < 0) {
      this.localSelection = null;
      return previousSelection !== null;
    } else if (selEnd.y >= 0 && selEnd.y <= height - 1) {
      if (selEnd.x >= 0) {
        endCharIndex = coordinateToCharacterIndex(selEnd.x, text, font);
      } else {
        endCharIndex = 0;
      }
    }
    if (startCharIndex < endCharIndex && startCharIndex >= 0 && endCharIndex <= text.length) {
      this.localSelection = { start: startCharIndex, end: endCharIndex };
    } else {
      this.localSelection = null;
    }
    return previousSelection?.start !== this.localSelection?.start || previousSelection?.end !== this.localSelection?.end;
  }
}
// src/lib/stdin-parser.ts
import { Buffer as Buffer3 } from "buffer";
var DEFAULT_TIMEOUT_MS = 20;
var DEFAULT_MAX_PENDING_BYTES = 64 * 1024;
var INITIAL_PENDING_CAPACITY = 256;
var ESC = 27;
var BEL = 7;
var BRACKETED_PASTE_START = Buffer3.from("\x1B[200~");
var BRACKETED_PASTE_END = Buffer3.from("\x1B[201~");
var EMPTY_BYTES = new Uint8Array(0);
var KEY_DECODER = new TextDecoder;
var DEFAULT_PROTOCOL_CONTEXT = {
  kittyKeyboardEnabled: false,
  privateCapabilityRepliesActive: false,
  pixelResolutionQueryActive: false,
  explicitWidthCprActive: false,
  startupCursorCprActive: false
};
var RXVT_DOLLAR_CSI_RE = /^\x1b\[\d+\$$/;
var SYSTEM_CLOCK = new SystemClock;

class ByteQueue {
  buf;
  start = 0;
  end = 0;
  constructor(capacity = INITIAL_PENDING_CAPACITY) {
    this.buf = new Uint8Array(capacity);
  }
  get length() {
    return this.end - this.start;
  }
  get capacity() {
    return this.buf.length;
  }
  view() {
    return this.buf.subarray(this.start, this.end);
  }
  take() {
    const chunk = this.view();
    this.start = 0;
    this.end = 0;
    return chunk;
  }
  append(chunk) {
    if (chunk.length === 0) {
      return;
    }
    this.ensureCapacity(this.length + chunk.length);
    this.buf.set(chunk, this.end);
    this.end += chunk.length;
  }
  consume(count) {
    if (count <= 0) {
      return;
    }
    if (count >= this.length) {
      this.start = 0;
      this.end = 0;
      return;
    }
    this.start += count;
    if (this.start >= this.buf.length / 2) {
      this.buf.copyWithin(0, this.start, this.end);
      this.end -= this.start;
      this.start = 0;
    }
  }
  clear() {
    this.start = 0;
    this.end = 0;
  }
  reset(capacity = INITIAL_PENDING_CAPACITY) {
    this.buf = new Uint8Array(capacity);
    this.start = 0;
    this.end = 0;
  }
  ensureCapacity(requiredLength) {
    const currentLength = this.length;
    if (requiredLength <= this.buf.length) {
      const availableAtEnd = this.buf.length - this.end;
      if (availableAtEnd >= requiredLength - currentLength) {
        return;
      }
      this.buf.copyWithin(0, this.start, this.end);
      this.end = currentLength;
      this.start = 0;
      if (requiredLength <= this.buf.length) {
        return;
      }
    }
    let nextCapacity = this.buf.length;
    while (nextCapacity < requiredLength) {
      nextCapacity *= 2;
    }
    const next = new Uint8Array(nextCapacity);
    next.set(this.view(), 0);
    this.buf = next;
    this.start = 0;
    this.end = currentLength;
  }
}
function normalizePositiveOption(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
function utf8SequenceLength(first) {
  if (first < 128)
    return 1;
  if (first >= 194 && first <= 223)
    return 2;
  if (first >= 224 && first <= 239)
    return 3;
  if (first >= 240 && first <= 244)
    return 4;
  return 0;
}
function bytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0;index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
function isMouseSgrSequence(sequence) {
  if (sequence.length < 7) {
    return false;
  }
  if (sequence[0] !== ESC || sequence[1] !== 91 || sequence[2] !== 60) {
    return false;
  }
  const final = sequence[sequence.length - 1];
  if (final !== 77 && final !== 109) {
    return false;
  }
  let part = 0;
  let hasDigit = false;
  for (let index = 3;index < sequence.length - 1; index += 1) {
    const byte = sequence[index];
    if (byte >= 48 && byte <= 57) {
      hasDigit = true;
      continue;
    }
    if (byte === 59 && hasDigit && part < 2) {
      part += 1;
      hasDigit = false;
      continue;
    }
    return false;
  }
  return part === 2 && hasDigit;
}
function isAsciiDigit(byte) {
  return byte >= 48 && byte <= 57;
}
function parsePositiveDecimalPrefix(sequence, start, endExclusive) {
  if (start >= endExclusive)
    return null;
  let value = 0;
  let sawDigit = false;
  for (let index = start;index < endExclusive; index += 1) {
    const byte = sequence[index];
    if (!isAsciiDigit(byte))
      return null;
    sawDigit = true;
    value = value * 10 + (byte - 48);
  }
  return sawDigit ? value : null;
}
function parseKittyFirstFieldCodepoint(sequence, start, endExclusive) {
  if (start >= endExclusive)
    return null;
  let firstColon = -1;
  for (let index = start;index < endExclusive; index += 1) {
    if (sequence[index] === 58) {
      firstColon = index;
      break;
    }
  }
  if (firstColon === -1)
    return null;
  const codepoint = parsePositiveDecimalPrefix(sequence, start, firstColon);
  if (codepoint === null)
    return null;
  for (let index = firstColon + 1;index < endExclusive; index += 1) {
    const byte = sequence[index];
    if (byte !== 58 && !isAsciiDigit(byte))
      return null;
  }
  return codepoint;
}
function canStillBeKittyU(state) {
  return state.semicolons >= 1;
}
function canStillBeKittySpecial(state) {
  return state.semicolons === 1 && state.segments > 1;
}
function canStillBeExplicitWidthCpr(state) {
  return state.firstParamValue === 1 && state.semicolons === 1;
}
function canStillBeStartupCursorCpr(state) {
  return state.semicolons === 1;
}
function canStillBeStartupCursorCprPrefix(state) {
  return state.segments === 1 && state.semicolons <= 1;
}
function canStillBePixelResolution(state) {
  return state.firstParamValue === 4 && state.semicolons === 2;
}
function canDeferParametricCsi(state, context) {
  return context.kittyKeyboardEnabled && (canStillBeKittyU(state) || canStillBeKittySpecial(state)) || context.explicitWidthCprActive && canStillBeExplicitWidthCpr(state) || context.startupCursorCprActive && canStillBeStartupCursorCpr(state) || context.pixelResolutionQueryActive && canStillBePixelResolution(state);
}
function canCompleteDeferredParametricCsi(state, byte, context) {
  if (context.kittyKeyboardEnabled) {
    if (state.hasDigit && byte === 117)
      return true;
    if (state.hasDigit && state.semicolons === 1 && state.segments > 1 && (byte === 126 || byte >= 65 && byte <= 90)) {
      return true;
    }
  }
  if (context.explicitWidthCprActive && state.hasDigit && state.firstParamValue === 1 && state.semicolons === 1 && byte === 82) {
    return true;
  }
  if (context.startupCursorCprActive && state.hasDigit && state.semicolons === 1 && byte === 82) {
    return true;
  }
  if (context.pixelResolutionQueryActive && state.hasDigit && state.firstParamValue === 4 && state.semicolons === 2 && byte === 116) {
    return true;
  }
  return false;
}
function classifyParametricCsiProtocol(state, finalByte) {
  if (finalByte === 82 && state.semicolons === 1 && state.segments === 1 && state.hasDigit) {
    return "cpr";
  }
  return "csi";
}
function canDeferPrivateReplyCsi(context) {
  return context.privateCapabilityRepliesActive;
}
function canCompleteDeferredPrivateReplyCsi(state, byte, context) {
  if (!context.privateCapabilityRepliesActive)
    return false;
  if (state.sawDollar)
    return state.hasDigit && byte === 121;
  if (byte === 99)
    return state.hasDigit || state.semicolons > 0;
  if (byte === 110)
    return state.hasDigit;
  return state.hasDigit && byte === 117;
}
function concatBytes(left, right) {
  if (left.length === 0) {
    return right;
  }
  if (right.length === 0) {
    return left;
  }
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}
function withEscPrefix(bytes) {
  const prefixed = new Uint8Array(bytes.length + 1);
  prefixed[0] = ESC;
  prefixed.set(bytes, 1);
  return prefixed;
}
function indexOfBytes(haystack, needle) {
  if (needle.length === 0) {
    return 0;
  }
  const limit = haystack.length - needle.length;
  for (let offset = 0;offset <= limit; offset += 1) {
    let matched = true;
    for (let index = 0;index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return offset;
    }
  }
  return -1;
}
function decodeLatin1(bytes) {
  return Buffer3.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}
function decodeUtf8(bytes) {
  return KEY_DECODER.decode(bytes);
}
function createPasteCollector() {
  return {
    tail: EMPTY_BYTES,
    parts: [],
    totalLength: 0
  };
}
function joinPasteBytes(parts, totalLength) {
  if (totalLength === 0) {
    return EMPTY_BYTES;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

class StdinParser {
  pending = new ByteQueue(INITIAL_PENDING_CAPACITY);
  events = [];
  timeoutMs;
  maxPendingBytes;
  armTimeouts;
  onTimeoutFlush;
  useKittyKeyboard;
  mouseParser = new MouseParser;
  clock;
  protocolContext;
  timeoutId = null;
  destroyed = false;
  pendingSinceMs = null;
  forceFlush = false;
  justFlushedEsc = false;
  state = { tag: "ground" };
  cursor = 0;
  unitStart = 0;
  paste = null;
  constructor(options = {}) {
    this.timeoutMs = normalizePositiveOption(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxPendingBytes = normalizePositiveOption(options.maxPendingBytes, DEFAULT_MAX_PENDING_BYTES);
    this.armTimeouts = options.armTimeouts ?? true;
    this.onTimeoutFlush = options.onTimeoutFlush ?? null;
    this.useKittyKeyboard = options.useKittyKeyboard ?? true;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.protocolContext = {
      ...DEFAULT_PROTOCOL_CONTEXT,
      kittyKeyboardEnabled: options.protocolContext?.kittyKeyboardEnabled ?? false,
      privateCapabilityRepliesActive: options.protocolContext?.privateCapabilityRepliesActive ?? false,
      pixelResolutionQueryActive: options.protocolContext?.pixelResolutionQueryActive ?? false,
      explicitWidthCprActive: options.protocolContext?.explicitWidthCprActive ?? false,
      startupCursorCprActive: options.protocolContext?.startupCursorCprActive ?? false
    };
  }
  get bufferCapacity() {
    return this.pending.capacity;
  }
  updateProtocolContext(patch) {
    this.ensureAlive();
    this.protocolContext = { ...this.protocolContext, ...patch };
    this.reconcileDeferredStateWithProtocolContext();
    this.reconcileTimeoutState();
  }
  getAbortableStartupCursorCprState() {
    if (this.pending.length === 0) {
      return null;
    }
    switch (this.state.tag) {
      case "csi": {
        const bytes = this.pending.view();
        const firstParamStart = this.unitStart + 2;
        if (this.cursor < firstParamStart) {
          return null;
        }
        let firstParamValue = null;
        for (let index = firstParamStart;index < this.cursor; index += 1) {
          const byte = bytes[index];
          if (!isAsciiDigit(byte)) {
            return null;
          }
          firstParamValue = (firstParamValue ?? 0) * 10 + (byte - 48);
        }
        return {
          tag: "csi_parametric_ignored",
          semicolons: 0,
          segments: 1,
          hasDigit: this.cursor > firstParamStart,
          firstParamValue
        };
      }
      case "csi_parametric":
      case "csi_parametric_deferred":
        if (!canStillBeStartupCursorCprPrefix(this.state) || this.protocolContext.explicitWidthCprActive && canStillBeExplicitWidthCpr(this.state)) {
          return null;
        }
        return {
          tag: "csi_parametric_ignored",
          semicolons: this.state.semicolons,
          segments: this.state.segments,
          hasDigit: this.state.hasDigit,
          firstParamValue: this.state.firstParamValue
        };
    }
    return null;
  }
  abortPendingStartupCursorCpr() {
    this.ensureAlive();
    const nextState = this.getAbortableStartupCursorCprState();
    if (!nextState) {
      return;
    }
    this.state = nextState;
    if (this.pendingSinceMs === null) {
      this.markPending();
    }
    this.forceFlush = false;
    this.reconcileTimeoutState();
  }
  push(data) {
    this.ensureAlive();
    if (data.length === 0) {
      this.emitKeyOrResponse("unknown", "");
      return;
    }
    let remainder = data;
    while (remainder.length > 0) {
      if (this.paste) {
        remainder = this.consumePasteBytes(remainder);
        continue;
      }
      const immediatePasteStartIndex = this.state.tag === "ground" && this.pending.length === 0 ? indexOfBytes(remainder, BRACKETED_PASTE_START) : -1;
      const appendEnd = immediatePasteStartIndex === -1 ? remainder.length : immediatePasteStartIndex + BRACKETED_PASTE_START.length;
      this.pending.append(remainder.subarray(0, appendEnd));
      remainder = remainder.subarray(appendEnd);
      this.scanPending();
      if (this.paste && this.pending.length > 0) {
        remainder = this.consumePasteBytes(this.takePendingBytes());
        continue;
      }
      if (!this.paste && this.pending.length > this.maxPendingBytes) {
        this.flushPendingOverflow();
        this.scanPending();
        if (this.paste && this.pending.length > 0) {
          remainder = this.consumePasteBytes(this.takePendingBytes());
        }
      }
    }
    this.reconcileTimeoutState();
  }
  read() {
    this.ensureAlive();
    if (this.events.length === 0 && this.forceFlush) {
      this.scanPending();
      this.reconcileTimeoutState();
    }
    return this.events.shift() ?? null;
  }
  drain(onEvent) {
    this.ensureAlive();
    while (true) {
      if (this.destroyed) {
        return;
      }
      const event = this.read();
      if (!event) {
        return;
      }
      onEvent(event);
    }
  }
  flushTimeout(nowMsValue = this.clock.now()) {
    this.ensureAlive();
    if (this.pendingSinceMs !== null && (nowMsValue < this.pendingSinceMs || nowMsValue - this.pendingSinceMs < this.timeoutMs)) {
      return;
    }
    this.tryForceFlush();
  }
  tryForceFlush() {
    if (this.paste || this.pendingSinceMs === null || this.pending.length === 0) {
      return;
    }
    this.forceFlush = true;
  }
  reset() {
    if (this.destroyed) {
      return;
    }
    this.clearTimeout();
    this.resetState();
  }
  resetMouseState() {
    this.ensureAlive();
    this.mouseParser.reset();
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.clearTimeout();
    this.destroyed = true;
    this.resetState();
  }
  ensureAlive() {
    if (this.destroyed) {
      throw new Error("StdinParser has been destroyed");
    }
  }
  scanPending() {
    while (!this.paste) {
      const bytes = this.pending.view();
      if (this.state.tag === "ground" && this.cursor >= bytes.length) {
        this.pending.clear();
        this.cursor = 0;
        this.unitStart = 0;
        this.pendingSinceMs = null;
        this.forceFlush = false;
        return;
      }
      const byte = this.cursor < bytes.length ? bytes[this.cursor] : -1;
      switch (this.state.tag) {
        case "ground": {
          this.unitStart = this.cursor;
          if (this.justFlushedEsc) {
            if (byte === 91) {
              this.justFlushedEsc = false;
              this.cursor += 1;
              this.state = { tag: "esc_recovery" };
              continue;
            }
            this.justFlushedEsc = false;
          }
          if (byte === ESC) {
            this.cursor += 1;
            this.state = { tag: "esc" };
            continue;
          }
          if (byte < 128) {
            this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.cursor, this.cursor + 1)));
            this.consumePrefix(this.cursor + 1);
            continue;
          }
          const expected = utf8SequenceLength(byte);
          if (expected === 0) {
            if (!this.forceFlush && this.cursor + 1 === bytes.length) {
              this.markPending();
              return;
            }
            this.emitLegacyHighByte(byte);
            this.consumePrefix(this.cursor + 1);
            continue;
          }
          this.cursor += 1;
          this.state = { tag: "utf8", expected, seen: 1 };
          continue;
        }
        case "utf8": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitLegacyHighByte(bytes[this.unitStart]);
            this.state = { tag: "ground" };
            this.consumePrefix(this.unitStart + 1);
            continue;
          }
          if ((byte & 192) !== 128) {
            this.emitLegacyHighByte(bytes[this.unitStart]);
            this.state = { tag: "ground" };
            this.consumePrefix(this.unitStart + 1);
            continue;
          }
          const nextSeen = this.state.seen + 1;
          this.cursor += 1;
          if (nextSeen < this.state.expected) {
            this.state = { tag: "utf8", expected: this.state.expected, seen: nextSeen };
            continue;
          }
          this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "esc": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            const flushedLoneEsc = this.cursor === this.unitStart + 1 && bytes[this.unitStart] === ESC;
            this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)));
            this.justFlushedEsc = flushedLoneEsc;
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          switch (byte) {
            case 91:
              this.cursor += 1;
              this.state = { tag: "csi" };
              continue;
            case 79:
              this.cursor += 1;
              this.state = { tag: "ss3" };
              continue;
            case 93:
              this.cursor += 1;
              this.state = { tag: "osc", sawEsc: false };
              continue;
            case 80:
              this.cursor += 1;
              this.state = { tag: "dcs", sawEsc: false };
              continue;
            case 95:
              this.cursor += 1;
              this.state = { tag: "apc", sawEsc: false };
              continue;
            case ESC:
              this.cursor += 1;
              continue;
            default:
              this.cursor += 1;
              this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)));
              this.state = { tag: "ground" };
              this.consumePrefix(this.cursor);
              continue;
          }
        }
        case "ss3": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          this.cursor += 1;
          this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "esc_recovery": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.cursor)));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === 60) {
            this.cursor += 1;
            this.state = { tag: "esc_less_mouse" };
            continue;
          }
          if (byte === 77) {
            this.cursor += 1;
            this.state = { tag: "esc_less_x10_mouse" };
            continue;
          }
          this.emitKeyOrResponse("unknown", decodeUtf8(bytes.subarray(this.unitStart, this.unitStart + 1)));
          this.state = { tag: "ground" };
          this.consumePrefix(this.unitStart + 1);
          continue;
        }
        case "csi": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === 77 && this.cursor === this.unitStart + 2) {
            const end = this.cursor + 4;
            if (bytes.length < end) {
              if (!this.forceFlush) {
                this.markPending();
                return;
              }
              this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, bytes.length));
              this.state = { tag: "ground" };
              this.consumePrefix(bytes.length);
              continue;
            }
            this.emitMouse(bytes.subarray(this.unitStart, end), "x10");
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          if (byte === 36) {
            const candidateEnd = this.cursor + 1;
            const candidate = decodeUtf8(bytes.subarray(this.unitStart, candidateEnd));
            if (RXVT_DOLLAR_CSI_RE.test(candidate)) {
              this.emitKeyOrResponse("csi", candidate);
              this.state = { tag: "ground" };
              this.consumePrefix(candidateEnd);
              continue;
            }
            if (!this.forceFlush && candidateEnd >= bytes.length) {
              this.markPending();
              return;
            }
          }
          if (byte === 60 && this.cursor === this.unitStart + 2) {
            this.cursor += 1;
            this.state = { tag: "csi_sgr_mouse", part: 0, hasDigit: false };
            continue;
          }
          if (byte === 91 && this.cursor === this.unitStart + 2) {
            this.cursor += 1;
            continue;
          }
          if (byte === 63 && this.cursor === this.unitStart + 2) {
            this.cursor += 1;
            this.state = { tag: "csi_private_reply", semicolons: 0, hasDigit: false, sawDollar: false };
            continue;
          }
          if (byte === 59) {
            const firstParamStart = this.unitStart + 2;
            const firstParamEnd = this.cursor;
            let firstParamValue = parsePositiveDecimalPrefix(bytes, firstParamStart, firstParamEnd);
            if (firstParamValue === null && this.protocolContext.kittyKeyboardEnabled) {
              firstParamValue = parseKittyFirstFieldCodepoint(bytes, firstParamStart, firstParamEnd);
            }
            if (firstParamValue !== null) {
              this.cursor += 1;
              this.state = {
                tag: "csi_parametric",
                semicolons: 1,
                segments: 1,
                hasDigit: false,
                firstParamValue
              };
              continue;
            }
          }
          if (byte >= 64 && byte <= 126) {
            const end = this.cursor + 1;
            const rawBytes = bytes.subarray(this.unitStart, end);
            if (bytesEqual(rawBytes, BRACKETED_PASTE_START)) {
              this.state = { tag: "ground" };
              this.consumePrefix(end);
              this.paste = createPasteCollector();
              continue;
            }
            if (isMouseSgrSequence(rawBytes)) {
              this.emitMouse(rawBytes, "sgr");
              this.state = { tag: "ground" };
              this.consumePrefix(end);
              continue;
            }
            this.emitKeyOrResponse("csi", decodeUtf8(rawBytes));
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          this.cursor += 1;
          continue;
        }
        case "csi_sgr_mouse": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.state = { tag: "csi_sgr_mouse_deferred", part: this.state.part, hasDigit: this.state.hasDigit };
            this.pendingSinceMs = null;
            this.forceFlush = false;
            return;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte)) {
            this.cursor += 1;
            this.state = { tag: "csi_sgr_mouse", part: this.state.part, hasDigit: true };
            continue;
          }
          if (byte === 59 && this.state.hasDigit && this.state.part < 2) {
            this.cursor += 1;
            this.state = { tag: "csi_sgr_mouse", part: this.state.part + 1, hasDigit: false };
            continue;
          }
          if (byte >= 64 && byte <= 126) {
            const end = this.cursor + 1;
            const rawBytes = bytes.subarray(this.unitStart, end);
            if (isMouseSgrSequence(rawBytes)) {
              this.emitMouse(rawBytes, "sgr");
            } else {
              this.emitKeyOrResponse("csi", decodeUtf8(rawBytes));
            }
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          this.state = { tag: "csi" };
          continue;
        }
        case "csi_sgr_mouse_deferred": {
          if (this.cursor >= bytes.length) {
            this.pendingSinceMs = null;
            this.forceFlush = false;
            return;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte) || byte === 59 || byte === 77 || byte === 109) {
            this.state = { tag: "csi_sgr_mouse", part: this.state.part, hasDigit: this.state.hasDigit };
            continue;
          }
          this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "csi_parametric": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            if (canDeferParametricCsi(this.state, this.protocolContext)) {
              this.state = {
                tag: "csi_parametric_deferred",
                semicolons: this.state.semicolons,
                segments: this.state.segments,
                hasDigit: this.state.hasDigit,
                firstParamValue: this.state.firstParamValue
              };
              this.pendingSinceMs = null;
              this.forceFlush = false;
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte)) {
            this.cursor += 1;
            this.state = {
              tag: "csi_parametric",
              semicolons: this.state.semicolons,
              segments: this.state.segments,
              hasDigit: true,
              firstParamValue: this.state.firstParamValue
            };
            continue;
          }
          if (byte === 58 && this.state.hasDigit && this.state.segments < 3) {
            this.cursor += 1;
            this.state = {
              tag: "csi_parametric",
              semicolons: this.state.semicolons,
              segments: this.state.segments + 1,
              hasDigit: false,
              firstParamValue: this.state.firstParamValue
            };
            continue;
          }
          if (byte === 59 && this.state.semicolons < 2) {
            this.cursor += 1;
            this.state = {
              tag: "csi_parametric",
              semicolons: this.state.semicolons + 1,
              segments: 1,
              hasDigit: false,
              firstParamValue: this.state.firstParamValue
            };
            continue;
          }
          if (byte >= 64 && byte <= 126) {
            const end = this.cursor + 1;
            const protocol = classifyParametricCsiProtocol(this.state, byte);
            this.emitKeyOrResponse(protocol, decodeUtf8(bytes.subarray(this.unitStart, end)));
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          this.state = { tag: "csi" };
          continue;
        }
        case "csi_parametric_deferred": {
          if (this.cursor >= bytes.length) {
            this.pendingSinceMs = null;
            this.forceFlush = false;
            return;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte) || byte === 58 || byte === 59) {
            this.state = {
              tag: "csi_parametric",
              semicolons: this.state.semicolons,
              segments: this.state.segments,
              hasDigit: this.state.hasDigit,
              firstParamValue: this.state.firstParamValue
            };
            continue;
          }
          if (canCompleteDeferredParametricCsi(this.state, byte, this.protocolContext)) {
            this.state = {
              tag: "csi_parametric",
              semicolons: this.state.semicolons,
              segments: this.state.segments,
              hasDigit: this.state.hasDigit,
              firstParamValue: this.state.firstParamValue
            };
            continue;
          }
          this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "csi_parametric_ignored": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === ESC) {
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte)) {
            this.cursor += 1;
            this.state = {
              tag: "csi_parametric_ignored",
              semicolons: this.state.semicolons,
              segments: this.state.segments,
              hasDigit: true,
              firstParamValue: this.state.semicolons === 0 ? (this.state.firstParamValue ?? 0) * 10 + (byte - 48) : this.state.firstParamValue
            };
            continue;
          }
          if (byte === 59 && this.state.semicolons === 0 && this.state.hasDigit) {
            if (this.protocolContext.explicitWidthCprActive && this.state.firstParamValue === 1) {
              this.state = { tag: "csi" };
              continue;
            }
            this.cursor += 1;
            this.state = {
              tag: "csi_parametric_ignored",
              semicolons: 1,
              segments: 1,
              hasDigit: false,
              firstParamValue: this.state.firstParamValue
            };
            continue;
          }
          if (byte === 82 && this.state.semicolons === 1 && this.state.hasDigit) {
            const end = this.cursor + 1;
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          if (this.state.semicolons === 0) {
            this.state = { tag: "csi" };
            continue;
          }
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "csi_private_reply": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            if (canDeferPrivateReplyCsi(this.protocolContext)) {
              this.state = {
                tag: "csi_private_reply_deferred",
                semicolons: this.state.semicolons,
                hasDigit: this.state.hasDigit,
                sawDollar: this.state.sawDollar
              };
              this.pendingSinceMs = null;
              this.forceFlush = false;
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte)) {
            this.cursor += 1;
            this.state = {
              tag: "csi_private_reply",
              semicolons: this.state.semicolons,
              hasDigit: true,
              sawDollar: this.state.sawDollar
            };
            continue;
          }
          if (byte === 59) {
            this.cursor += 1;
            this.state = {
              tag: "csi_private_reply",
              semicolons: this.state.semicolons + 1,
              hasDigit: false,
              sawDollar: false
            };
            continue;
          }
          if (byte === 36 && this.state.hasDigit && !this.state.sawDollar) {
            this.cursor += 1;
            this.state = {
              tag: "csi_private_reply",
              semicolons: this.state.semicolons,
              hasDigit: true,
              sawDollar: true
            };
            continue;
          }
          if (byte >= 64 && byte <= 126) {
            const end = this.cursor + 1;
            this.emitOpaqueResponse("csi", bytes.subarray(this.unitStart, end));
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          this.state = { tag: "csi" };
          continue;
        }
        case "csi_private_reply_deferred": {
          if (this.cursor >= bytes.length) {
            this.pendingSinceMs = null;
            this.forceFlush = false;
            return;
          }
          if (byte === ESC) {
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (isAsciiDigit(byte) || byte === 59 || byte === 36) {
            this.state = {
              tag: "csi_private_reply",
              semicolons: this.state.semicolons,
              hasDigit: this.state.hasDigit,
              sawDollar: this.state.sawDollar
            };
            continue;
          }
          if (canCompleteDeferredPrivateReplyCsi(this.state, byte, this.protocolContext)) {
            this.state = {
              tag: "csi_private_reply",
              semicolons: this.state.semicolons,
              hasDigit: this.state.hasDigit,
              sawDollar: this.state.sawDollar
            };
            continue;
          }
          this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "osc": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (this.state.sawEsc) {
            if (byte === 92) {
              const end = this.cursor + 1;
              this.emitOpaqueResponse("osc", bytes.subarray(this.unitStart, end));
              this.state = { tag: "ground" };
              this.consumePrefix(end);
              continue;
            }
            this.state = { tag: "osc", sawEsc: false };
            continue;
          }
          if (byte === BEL) {
            const end = this.cursor + 1;
            this.emitOpaqueResponse("osc", bytes.subarray(this.unitStart, end));
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          if (byte === ESC) {
            this.cursor += 1;
            this.state = { tag: "osc", sawEsc: true };
            continue;
          }
          this.cursor += 1;
          continue;
        }
        case "dcs": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (this.state.sawEsc) {
            if (byte === 92) {
              const end = this.cursor + 1;
              this.emitOpaqueResponse("dcs", bytes.subarray(this.unitStart, end));
              this.state = { tag: "ground" };
              this.consumePrefix(end);
              continue;
            }
            this.state = { tag: "dcs", sawEsc: false };
            continue;
          }
          if (byte === ESC) {
            this.cursor += 1;
            this.state = { tag: "dcs", sawEsc: true };
            continue;
          }
          this.cursor += 1;
          continue;
        }
        case "apc": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (this.state.sawEsc) {
            if (byte === 92) {
              const end = this.cursor + 1;
              this.emitOpaqueResponse("apc", bytes.subarray(this.unitStart, end));
              this.state = { tag: "ground" };
              this.consumePrefix(end);
              continue;
            }
            this.state = { tag: "apc", sawEsc: false };
            continue;
          }
          if (byte === ESC) {
            this.cursor += 1;
            this.state = { tag: "apc", sawEsc: true };
            continue;
          }
          this.cursor += 1;
          continue;
        }
        case "esc_less_mouse": {
          if (this.cursor >= bytes.length) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
            this.state = { tag: "ground" };
            this.consumePrefix(this.cursor);
            continue;
          }
          if (byte >= 48 && byte <= 57 || byte === 59) {
            this.cursor += 1;
            continue;
          }
          if (byte === 77 || byte === 109) {
            const end = this.cursor + 1;
            const rawBytes = bytes.subarray(this.unitStart, end);
            const prefixed = withEscPrefix(rawBytes);
            if (isMouseSgrSequence(prefixed)) {
              this.emitMouse(prefixed, "sgr");
            } else {
              this.emitOpaqueResponse("unknown", rawBytes);
            }
            this.state = { tag: "ground" };
            this.consumePrefix(end);
            continue;
          }
          this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, this.cursor));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
          continue;
        }
        case "esc_less_x10_mouse": {
          const end = this.unitStart + 5;
          if (bytes.length < end) {
            if (!this.forceFlush) {
              this.markPending();
              return;
            }
            this.emitOpaqueResponse("unknown", bytes.subarray(this.unitStart, bytes.length));
            this.state = { tag: "ground" };
            this.consumePrefix(bytes.length);
            continue;
          }
          const rawBytes = bytes.subarray(this.unitStart, end);
          this.emitMouse(withEscPrefix(rawBytes), "x10");
          this.state = { tag: "ground" };
          this.consumePrefix(end);
          continue;
        }
      }
    }
  }
  emitKeyOrResponse(protocol, raw) {
    const parsed = parseKeypress(raw, { useKittyKeyboard: this.useKittyKeyboard });
    if (parsed) {
      this.events.push({
        type: "key",
        raw: parsed.raw,
        key: parsed
      });
      return;
    }
    this.events.push({
      type: "response",
      protocol,
      sequence: raw
    });
  }
  emitMouse(rawBytes, encoding) {
    const event = this.mouseParser.parseMouseEvent(rawBytes);
    if (!event) {
      this.emitOpaqueResponse("unknown", rawBytes);
      return;
    }
    this.events.push({
      type: "mouse",
      raw: decodeLatin1(rawBytes),
      encoding,
      event
    });
  }
  emitLegacyHighByte(byte) {
    const parsed = parseKeypress(Buffer3.from([byte]), { useKittyKeyboard: this.useKittyKeyboard });
    if (parsed) {
      this.events.push({
        type: "key",
        raw: parsed.raw,
        key: parsed
      });
      return;
    }
    this.events.push({
      type: "response",
      protocol: "unknown",
      sequence: String.fromCharCode(byte)
    });
  }
  emitOpaqueResponse(protocol, rawBytes) {
    this.events.push({
      type: "response",
      protocol,
      sequence: decodeLatin1(rawBytes)
    });
  }
  consumePrefix(endExclusive) {
    this.pending.consume(endExclusive);
    this.cursor = 0;
    this.unitStart = 0;
    this.pendingSinceMs = null;
    this.forceFlush = false;
  }
  takePendingBytes() {
    const buffered = this.pending.take();
    this.cursor = 0;
    this.unitStart = 0;
    this.pendingSinceMs = null;
    this.forceFlush = false;
    return buffered;
  }
  flushPendingOverflow() {
    if (this.pending.length === 0) {
      return;
    }
    this.emitOpaqueResponse("unknown", this.pending.view());
    this.pending.clear();
    this.cursor = 0;
    this.unitStart = 0;
    this.pendingSinceMs = null;
    this.forceFlush = false;
    this.state = { tag: "ground" };
  }
  markPending() {
    this.pendingSinceMs = this.clock.now();
  }
  consumePasteBytes(chunk) {
    const paste = this.paste;
    const combined = concatBytes(paste.tail, chunk);
    const endIndex = indexOfBytes(combined, BRACKETED_PASTE_END);
    if (endIndex !== -1) {
      this.pushPasteBytes(combined.subarray(0, endIndex));
      this.events.push({
        type: "paste",
        bytes: joinPasteBytes(paste.parts, paste.totalLength)
      });
      this.paste = null;
      return combined.subarray(endIndex + BRACKETED_PASTE_END.length);
    }
    const keep = Math.min(BRACKETED_PASTE_END.length - 1, combined.length);
    const stableLength = combined.length - keep;
    if (stableLength > 0) {
      this.pushPasteBytes(combined.subarray(0, stableLength));
    }
    paste.tail = Uint8Array.from(combined.subarray(stableLength));
    return EMPTY_BYTES;
  }
  pushPasteBytes(bytes) {
    if (bytes.length === 0) {
      return;
    }
    this.paste.parts.push(Uint8Array.from(bytes));
    this.paste.totalLength += bytes.length;
  }
  reconcileDeferredStateWithProtocolContext() {
    switch (this.state.tag) {
      case "csi_parametric_deferred":
        if (!canDeferParametricCsi(this.state, this.protocolContext)) {
          this.emitOpaqueResponse("unknown", this.pending.view().subarray(this.unitStart, this.cursor));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
        }
        return;
      case "csi_private_reply_deferred":
        if (!canDeferPrivateReplyCsi(this.protocolContext)) {
          this.emitOpaqueResponse("unknown", this.pending.view().subarray(this.unitStart, this.cursor));
          this.state = { tag: "ground" };
          this.consumePrefix(this.cursor);
        }
        return;
    }
  }
  reconcileTimeoutState() {
    if (!this.armTimeouts) {
      return;
    }
    if (this.paste || this.pendingSinceMs === null || this.pending.length === 0) {
      this.clearTimeout();
      return;
    }
    this.clearTimeout();
    this.timeoutId = this.clock.setTimeout(() => {
      this.timeoutId = null;
      if (this.destroyed) {
        return;
      }
      try {
        this.tryForceFlush();
        this.onTimeoutFlush?.();
      } catch (error) {
        console.error("stdin parser timeout flush failed", error);
      }
    }, this.timeoutMs);
  }
  clearTimeout() {
    if (!this.timeoutId) {
      return;
    }
    this.clock.clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }
  resetState() {
    this.pending.reset(INITIAL_PENDING_CAPACITY);
    this.events.length = 0;
    this.pendingSinceMs = null;
    this.forceFlush = false;
    this.justFlushedEsc = false;
    this.state = { tag: "ground" };
    this.cursor = 0;
    this.unitStart = 0;
    this.paste = null;
    this.mouseParser.reset();
  }
}
// src/lib/tree-sitter-styled-text.ts
registerEnvVar({ name: "OTUI_TS_STYLE_WARN", default: false, description: "Enable warnings for missing syntax styles" });
function getSpecificity(group) {
  return group.split(".").length;
}
function shouldSuppressInInjection(group, meta) {
  if (meta?.isInjection) {
    return false;
  }
  return group === "markup.raw.block";
}
function treeSitterToTextChunks(content, highlights, syntaxStyle, options) {
  const chunks = [];
  const defaultStyle = syntaxStyle.getStyle("default");
  const concealEnabled = options?.enabled ?? true;
  const baseStyle = options?.baseHighlight ? syntaxStyle.getStyle(options.baseHighlight) : undefined;
  const injectionContainerRanges = [];
  const boundaries = [];
  for (let i = 0;i < highlights.length; i++) {
    const [start, end, , meta] = highlights[i];
    if (start === end)
      continue;
    if (meta?.containsInjection) {
      injectionContainerRanges.push({ start, end });
    }
    boundaries.push({ offset: start, type: "start", highlightIndex: i });
    boundaries.push({ offset: end, type: "end", highlightIndex: i });
  }
  boundaries.sort((a, b) => {
    if (a.offset !== b.offset)
      return a.offset - b.offset;
    if (a.type === "end" && b.type === "start")
      return -1;
    if (a.type === "start" && b.type === "end")
      return 1;
    return 0;
  });
  const activeHighlights = new Set;
  let currentOffset = 0;
  for (let i = 0;i < boundaries.length; i++) {
    const boundary = boundaries[i];
    if (currentOffset < boundary.offset && activeHighlights.size > 0) {
      const segmentText = content.slice(currentOffset, boundary.offset);
      const activeGroups = [];
      for (const idx of activeHighlights) {
        const [, , group, meta] = highlights[idx];
        activeGroups.push({ group, meta, index: idx });
      }
      const concealHighlight = concealEnabled ? activeGroups.find((h) => h.meta?.conceal !== undefined || h.group === "conceal" || h.group.startsWith("conceal.")) : undefined;
      if (concealHighlight) {
        let replacementText = "";
        if (concealHighlight.meta?.conceal !== undefined) {
          replacementText = concealHighlight.meta.conceal;
        } else if (concealHighlight.group === "conceal.with.space") {
          replacementText = " ";
        }
        if (replacementText) {
          chunks.push({
            __isChunk: true,
            text: replacementText,
            fg: defaultStyle?.fg,
            bg: defaultStyle?.bg,
            attributes: defaultStyle ? createTextAttributes({
              bold: defaultStyle.bold,
              italic: defaultStyle.italic,
              underline: defaultStyle.underline,
              dim: defaultStyle.dim
            }) : 0
          });
        }
      } else {
        const insideInjectionContainer = injectionContainerRanges.some((range) => currentOffset >= range.start && currentOffset < range.end);
        const validGroups = activeGroups.filter((h) => {
          if (insideInjectionContainer && shouldSuppressInInjection(h.group, h.meta)) {
            return false;
          }
          return true;
        });
        const sortedGroups = validGroups.sort((a, b) => {
          const aSpec = getSpecificity(a.group);
          const bSpec = getSpecificity(b.group);
          if (aSpec !== bSpec)
            return aSpec - bSpec;
          return a.index - b.index;
        });
        const mergedStyle = baseStyle ? { ...baseStyle } : {};
        for (const { group } of sortedGroups) {
          let styleForGroup = syntaxStyle.getStyle(group);
          if (!styleForGroup && group.includes(".")) {
            const baseName = group.split(".")[0];
            styleForGroup = syntaxStyle.getStyle(baseName);
          }
          if (styleForGroup) {
            if (styleForGroup.fg !== undefined)
              mergedStyle.fg = styleForGroup.fg;
            if (styleForGroup.bg !== undefined)
              mergedStyle.bg = styleForGroup.bg;
            if (styleForGroup.bold !== undefined)
              mergedStyle.bold = styleForGroup.bold;
            if (styleForGroup.italic !== undefined)
              mergedStyle.italic = styleForGroup.italic;
            if (styleForGroup.underline !== undefined)
              mergedStyle.underline = styleForGroup.underline;
            if (styleForGroup.dim !== undefined)
              mergedStyle.dim = styleForGroup.dim;
          } else {
            if (group.includes(".")) {
              const baseName = group.split(".")[0];
              if (env.OTUI_TS_STYLE_WARN) {
                console.warn(`Syntax style not found for group "${group}" or base scope "${baseName}", using default style`);
              }
            } else {
              if (env.OTUI_TS_STYLE_WARN) {
                console.warn(`Syntax style not found for group "${group}", using default style`);
              }
            }
          }
        }
        const finalStyle = Object.keys(mergedStyle).length > 0 ? mergedStyle : defaultStyle;
        chunks.push({
          __isChunk: true,
          text: segmentText,
          fg: finalStyle?.fg,
          bg: finalStyle?.bg,
          attributes: finalStyle ? createTextAttributes({
            bold: finalStyle.bold,
            italic: finalStyle.italic,
            underline: finalStyle.underline,
            dim: finalStyle.dim
          }) : 0
        });
      }
    } else if (currentOffset < boundary.offset) {
      const text = content.slice(currentOffset, boundary.offset);
      const style = baseStyle ?? defaultStyle;
      chunks.push({
        __isChunk: true,
        text,
        fg: style?.fg,
        bg: style?.bg,
        attributes: style ? createTextAttributes({
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          dim: style.dim
        }) : 0
      });
    }
    if (boundary.type === "start") {
      activeHighlights.add(boundary.highlightIndex);
    } else {
      activeHighlights.delete(boundary.highlightIndex);
      if (concealEnabled) {
        const [, , group, meta] = highlights[boundary.highlightIndex];
        if (meta?.concealLines !== undefined) {
          if (boundary.offset < content.length && content[boundary.offset] === `
`) {
            currentOffset = boundary.offset + 1;
            continue;
          }
        }
        if (meta?.conceal !== undefined) {
          if (meta.conceal === " ") {
            if (boundary.offset < content.length && content[boundary.offset] === " ") {
              currentOffset = boundary.offset + 1;
              continue;
            }
          } else if (meta.conceal === "" && group === "conceal" && !meta.isInjection) {
            if (boundary.offset < content.length && content[boundary.offset] === " ") {
              currentOffset = boundary.offset + 1;
              continue;
            }
          }
        }
      }
    }
    currentOffset = boundary.offset;
  }
  if (currentOffset < content.length) {
    const text = content.slice(currentOffset);
    const style = baseStyle ?? defaultStyle;
    chunks.push({
      __isChunk: true,
      text,
      fg: style?.fg,
      bg: style?.bg,
      attributes: style ? createTextAttributes({
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        dim: style.dim
      }) : 0
    });
  }
  return chunks;
}
async function treeSitterToStyledText(content, filetype, syntaxStyle, client, options) {
  const result = await client.highlightOnce(content, filetype);
  if (result.highlights && result.highlights.length > 0 || options?.baseHighlight) {
    const chunks = treeSitterToTextChunks(content, result.highlights ?? [], syntaxStyle, {
      enabled: options?.conceal?.enabled ?? true,
      baseHighlight: options?.baseHighlight
    });
    return new StyledText(chunks);
  } else {
    const defaultStyle = syntaxStyle.mergeStyles("default");
    const chunks = [
      {
        __isChunk: true,
        text: content,
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes
      }
    ];
    return new StyledText(chunks);
  }
}
// src/lib/tree-sitter/client.ts
import { EventEmitter as EventEmitter2 } from "events";

// src/lib/debounce.ts
var TIMERS_MAP = new Map;

class DebounceController {
  scopeId;
  constructor(scopeId) {
    this.scopeId = scopeId;
    if (!TIMERS_MAP.has(this.scopeId)) {
      TIMERS_MAP.set(this.scopeId, new Map);
    }
  }
  debounce(id, ms, fn) {
    const scopeMap = TIMERS_MAP.get(this.scopeId);
    return new Promise((resolve2, reject) => {
      if (scopeMap.has(id)) {
        clearTimeout(scopeMap.get(id));
      }
      const timerId = setTimeout(() => {
        try {
          resolve2(fn());
        } catch (error) {
          reject(error);
        }
        scopeMap.delete(id);
      }, ms);
      scopeMap.set(id, timerId);
    });
  }
  clearDebounce(id) {
    const scopeMap = TIMERS_MAP.get(this.scopeId);
    if (scopeMap && scopeMap.has(id)) {
      clearTimeout(scopeMap.get(id));
      scopeMap.delete(id);
    }
  }
  clear() {
    const scopeMap = TIMERS_MAP.get(this.scopeId);
    if (scopeMap) {
      scopeMap.forEach((timerId) => clearTimeout(timerId));
      scopeMap.clear();
    }
  }
}
function createDebounce(scopeId) {
  return new DebounceController(scopeId);
}
function clearDebounceScope(scopeId) {
  const scopeMap = TIMERS_MAP.get(scopeId);
  if (scopeMap) {
    scopeMap.forEach((timerId) => clearTimeout(timerId));
    scopeMap.clear();
  }
}

// src/lib/queue.ts
class ProcessQueue {
  processor;
  queue = [];
  processing = false;
  autoProcess = true;
  constructor(processor, autoProcess = true) {
    this.processor = processor;
    this.autoProcess = autoProcess;
  }
  enqueue(item) {
    this.queue.push(item);
    if (!this.processing && this.autoProcess) {
      this.processQueue();
    }
  }
  processQueue() {
    if (this.queue.length === 0) {
      return;
    }
    this.processing = true;
    queueMicrotask(async () => {
      if (this.queue.length === 0) {
        this.processing = false;
        return;
      }
      const item = this.queue.shift();
      try {
        await this.processor(item);
      } catch (error) {
        console.error("Error processing queue item:", error);
      }
      if (this.queue.length > 0) {
        this.processQueue();
      } else {
        this.processing = false;
      }
    });
  }
  clear() {
    this.queue = [];
  }
  isProcessing() {
    return this.processing;
  }
  size() {
    return this.queue.length;
  }
}

// src/lib/tree-sitter/default-parser-assets.bun.ts
var bundledAssetLoaders = {
  "assets/javascript/highlights.scm": () => import("./assets/javascript/highlights.scm", { with: { type: "file" } }),
  "assets/javascript/tree-sitter-javascript.wasm": () => import("./assets/javascript/tree-sitter-javascript.wasm", { with: { type: "file" } }),
  "assets/typescript/highlights.scm": () => import("./assets/typescript/highlights.scm", { with: { type: "file" } }),
  "assets/typescript/tree-sitter-typescript.wasm": () => import("./assets/typescript/tree-sitter-typescript.wasm", { with: { type: "file" } }),
  "assets/markdown/highlights.scm": () => import("./assets/markdown/highlights.scm", { with: { type: "file" } }),
  "assets/markdown/tree-sitter-markdown.wasm": () => import("./assets/markdown/tree-sitter-markdown.wasm", { with: { type: "file" } }),
  "assets/markdown/injections.scm": () => import("./assets/markdown/injections.scm", { with: { type: "file" } }),
  "assets/markdown_inline/highlights.scm": () => import("./assets/markdown_inline/highlights.scm", { with: { type: "file" } }),
  "assets/markdown_inline/tree-sitter-markdown_inline.wasm": () => import("./assets/markdown_inline/tree-sitter-markdown_inline.wasm", { with: { type: "file" } }),
  "assets/zig/highlights.scm": () => import("./assets/zig/highlights.scm", { with: { type: "file" } }),
  "assets/zig/tree-sitter-zig.wasm": () => import("./assets/zig/tree-sitter-zig.wasm", { with: { type: "file" } })
};
function resolveBundledDefaultParserAsset(relativePath, fallbackPath) {
  const loadBundledFile = bundledAssetLoaders[relativePath];
  if (!loadBundledFile) {
    throw new Error(`Unknown OpenTUI default parser asset: ${JSON.stringify(relativePath)}`);
  }
  return resolveBundledFilePath(`@opentui/core/${relativePath}`, loadBundledFile, fallbackPath, import.meta.url);
}

// src/node-asset-target.ts
var NATIVE_FILE_NAMES = {
  darwin: "libopentui.dylib",
  linux: "libopentui.so",
  win32: "opentui.dll"
};
function getNativeAssetDescriptor(target) {
  if (!Object.hasOwn(NATIVE_FILE_NAMES, target.platform) || target.arch !== "arm64" && target.arch !== "x64") {
    throw new Error(`Unsupported OpenTUI Node asset target: ${String(target.platform)}-${String(target.arch)}`);
  }
  if (target.libc !== undefined && target.libc !== "glibc" && target.libc !== "musl") {
    throw new Error(`Unsupported libc for OpenTUI Node assets: ${String(target.libc)}`);
  }
  if (target.platform !== "linux" && target.libc !== undefined) {
    throw new Error(`OpenTUI Node asset target libc is only supported on Linux, got ${target.platform}`);
  }
  const libcSuffix = target.platform === "linux" && target.libc === "musl" ? "-musl" : "";
  const packageName = `@opentui/core-${target.platform}-${target.arch}${libcSuffix}`;
  const fileName = NATIVE_FILE_NAMES[target.platform];
  return {
    key: `${packageName}/${fileName}`,
    packageName,
    fileName
  };
}
function getCurrentNodeAssetTarget() {
  const libc = process.env.OPENTUI_LIBC;
  if (process.platform === "linux" && libc !== undefined && libc !== "" && libc !== "glibc" && libc !== "musl") {
    throw new Error(`On Linux, OPENTUI_LIBC must be unset, empty, "glibc", or "musl", got ${JSON.stringify(libc)}`);
  }
  return {
    platform: process.platform,
    arch: process.arch,
    ...process.platform === "linux" && libc === "musl" ? { libc } : {}
  };
}

// src/platform/runtime-assets.bun.ts
var CORE_ASSET_PREFIX = "@opentui/core/";
var PARSER_WORKER_ASSET_KEY = `${CORE_ASSET_PREFIX}parser.worker.js`;
var TREE_SITTER_WASM_ASSET_KEY = "web-tree-sitter/tree-sitter.wasm";
var bundledTreeSitterWorkerPath = await resolveBundledFilePath(PARSER_WORKER_ASSET_KEY, () => import("@opentui/core/parser.worker", { with: { type: "file" } }), new URL("../lib/tree-sitter/parser.worker.js", import.meta.url), import.meta.url, { useAssetRoot: false });
function resolveDefaultParserAsset(relativePath, fallbackPath) {
  return resolveBundledDefaultParserAsset(relativePath, fallbackPath);
}
function resolveDefaultTreeSitterWorkerPath(_fallbackPath) {
  return resolveAssetPath(PARSER_WORKER_ASSET_KEY, bundledTreeSitterWorkerPath);
}
function resolveTreeSitterWasm() {
  return resolveBundledFilePath(TREE_SITTER_WASM_ASSET_KEY, () => import("web-tree-sitter/tree-sitter.wasm", { with: { type: "wasm" } }), () => import.meta.resolve(TREE_SITTER_WASM_ASSET_KEY), import.meta.url);
}
async function resolveNativeLibraryPath() {
  const asset = getNativeAssetDescriptor(getCurrentNodeAssetTarget());
  const configuredPath = resolveAssetRootPath(asset.key);
  if (configuredPath !== undefined) {
    return configuredPath;
  }
  if (process.platform === "darwin") {
    if (process.arch === "x64") {
      return (await import("@opentui/core-darwin-x64")).default;
    }
    if (process.arch === "arm64") {
      return (await import("@opentui/core-darwin-arm64")).default;
    }
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") {
      if (process.env.OPENTUI_LIBC === "musl") {
        return (await import("@opentui/core-linux-x64-musl")).default;
      }
      return (await import("@opentui/core-linux-x64")).default;
    }
    if (process.arch === "arm64") {
      if (process.env.OPENTUI_LIBC === "musl") {
        return (await import("@opentui/core-linux-arm64-musl")).default;
      }
      return (await import("@opentui/core-linux-arm64")).default;
    }
  }
  if (process.platform === "win32") {
    if (process.arch === "x64") {
      return (await import("@opentui/core-win32-x64")).default;
    }
    if (process.arch === "arm64") {
      return (await import("@opentui/core-win32-arm64")).default;
    }
  }
  throw new Error(`OpenTUI is not supported on the current platform: ${asset.packageName}`);
}

// src/lib/tree-sitter/default-parsers.ts
var defaultParserDescriptors = [
  {
    filetype: "javascript",
    aliases: ["javascriptreact"],
    queries: { highlights: ["assets/javascript/highlights.scm"] },
    wasm: "assets/javascript/tree-sitter-javascript.wasm"
  },
  {
    filetype: "typescript",
    aliases: ["typescriptreact"],
    queries: { highlights: ["assets/typescript/highlights.scm"] },
    wasm: "assets/typescript/tree-sitter-typescript.wasm"
  },
  {
    filetype: "markdown",
    queries: {
      highlights: ["assets/markdown/highlights.scm"],
      injections: ["assets/markdown/injections.scm"]
    },
    wasm: "assets/markdown/tree-sitter-markdown.wasm",
    injectionMapping: {
      nodeTypes: { inline: "markdown_inline", pipe_table_cell: "markdown_inline" },
      infoStringMap: {
        javascript: "javascript",
        js: "javascript",
        jsx: "javascriptreact",
        javascriptreact: "javascriptreact",
        typescript: "typescript",
        ts: "typescript",
        tsx: "typescriptreact",
        typescriptreact: "typescriptreact",
        markdown: "markdown",
        md: "markdown"
      }
    }
  },
  {
    filetype: "markdown_inline",
    queries: { highlights: ["assets/markdown_inline/highlights.scm"] },
    wasm: "assets/markdown_inline/tree-sitter-markdown_inline.wasm"
  },
  {
    filetype: "zig",
    queries: { highlights: ["assets/zig/highlights.scm"] },
    wasm: "assets/zig/tree-sitter-zig.wasm"
  }
];
var defaultParserAssetPaths = [
  ...new Set(defaultParserDescriptors.flatMap((parser) => [
    ...parser.queries.highlights,
    parser.wasm,
    ...parser.queries.injections ?? []
  ]))
];
var cachedParsers;
function getParsers() {
  cachedParsers ??= Promise.all(defaultParserDescriptors.map(resolveDefaultParser));
  return cachedParsers;
}
async function resolveDefaultParser(parser) {
  const queries = {
    highlights: await Promise.all(parser.queries.highlights.map(resolveParserAsset))
  };
  if (parser.queries.injections) {
    queries.injections = await Promise.all(parser.queries.injections.map(resolveParserAsset));
  }
  return {
    filetype: parser.filetype,
    ...parser.aliases ? { aliases: [...parser.aliases] } : {},
    queries,
    wasm: await resolveParserAsset(parser.wasm),
    ...parser.injectionMapping ? { injectionMapping: parser.injectionMapping } : {}
  };
}
function resolveParserAsset(relativePath) {
  return resolveDefaultParserAsset(relativePath, new URL(`./${relativePath}`, import.meta.url));
}

// src/lib/tree-sitter/client.ts
import { resolve as resolve2, isAbsolute as isAbsolute3, parse } from "path";
import { existsSync as existsSync2 } from "fs";

// src/lib/bunfs.ts
import { basename, join as join2 } from "path";
function isBunfsPath(path) {
  return path.includes("$bunfs") || /^B:[\\/]~BUN/i.test(path);
}
function getBunfsRootPath() {
  return process.platform === "win32" ? "B:\\~BUN\\root" : "/$bunfs/root";
}
function normalizeBunfsPath(fileName) {
  return join2(getBunfsRootPath(), basename(fileName));
}

// src/platform/worker.ts
var WORKER_UNAVAILABLE = "OpenTUI tree-sitter workers are not available for this runtime yet.";
var globalWithWorker = globalThis;
var nodeWorkerThreads = getBuiltinModule("node:worker_threads");
var runtimeBridge = loadWorkerRuntime(nodeWorkerThreads);

class UnsupportedWorker {
  onmessage = null;
  onerror = null;
  constructor() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  postMessage() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  terminate() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  addEventListener() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  removeEventListener() {
    throw new Error(WORKER_UNAVAILABLE);
  }
}
var Worker = loadWorkerConstructor();
function getBuiltinModule(id) {
  if (typeof process === "undefined") {
    return;
  }
  const loader = process.getBuiltinModule;
  if (typeof loader !== "function") {
    return;
  }
  try {
    return loader(id);
  } catch {
    return;
  }
}
function loadWorkerConstructor() {
  if (typeof globalWithWorker.Worker === "function") {
    return globalWithWorker.Worker;
  }
  if (nodeWorkerThreads) {
    return createNodeWorkerConstructor(nodeWorkerThreads);
  }
  return UnsupportedWorker;
}
function createNodeWorkerConstructor(node) {
  return class NodeWorkerShim {
    onmessage = null;
    onerror = null;
    errorListeners = new Set;
    messageListeners = new Set;
    worker;
    terminationPromise;
    constructor(specifier, options = {}) {
      const resolvedSpecifier = resolveWorkerImportSpecifier(specifier);
      this.worker = new node.Worker(createWorkerBootstrapSource(resolvedSpecifier), {
        eval: true,
        type: "module",
        name: options.name
      });
      this.worker.on("message", this.handleMessage);
      this.worker.on("error", this.handleError);
    }
    postMessage(value) {
      this.worker.postMessage(value);
    }
    terminate() {
      if (this.terminationPromise) {
        return this.terminationPromise;
      }
      this.worker.off("message", this.handleMessage);
      this.worker.off("error", this.handleError);
      const termination = this.worker.terminate().catch((error) => {
        this.terminationPromise = undefined;
        this.worker.on("message", this.handleMessage);
        this.worker.on("error", this.handleError);
        throw error;
      });
      this.terminationPromise = termination;
      return termination;
    }
    addEventListener(type, listener) {
      if (type === "message") {
        this.messageListeners.add(listener);
        return;
      }
      this.errorListeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === "message") {
        this.messageListeners.delete(listener);
        return;
      }
      this.errorListeners.delete(listener);
    }
    handleMessage = (data) => {
      const event = { data };
      this.onmessage?.(event);
      for (const listener of this.messageListeners) {
        listener(event);
      }
    };
    handleError = (error) => {
      const event = {
        error,
        message: error.message
      };
      this.onerror?.(event);
      for (const listener of this.errorListeners) {
        listener(event);
      }
    };
  };
}
function createWorkerBootstrapSource(specifier) {
  return `
    import { parentPort } from "node:worker_threads"

    const pendingMessages = []
    let messageHandler = null

    globalThis.self ??= globalThis
    globalThis.postMessage ??= (value) => parentPort?.postMessage(value)
    globalThis.__opentuiWorkerMessageBridge = true
    Object.defineProperty(globalThis, "onmessage", {
      configurable: true,
      get: () => messageHandler,
      set: (handler) => {
        messageHandler = typeof handler === "function" ? handler : null
        if (!messageHandler) return

        const messages = pendingMessages.splice(0)
        for (const data of messages) {
          messageHandler({ data })
        }
      },
    })
    parentPort?.on("message", (data) => {
      if (messageHandler) {
        messageHandler({ data })
      } else {
        pendingMessages.push(data)
      }
    })

    await import(${JSON.stringify(specifier)})
  `;
}
function resolveWorkerImportSpecifier(specifier) {
  if (specifier instanceof URL) {
    return specifier.href;
  }
  if (isRuntimeSpecifier(specifier)) {
    return specifier;
  }
  const nodePath = getBuiltinModule("node:path");
  const nodeUrl = getBuiltinModule("node:url");
  if (!nodePath || !nodeUrl) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  const absolutePath = nodePath.isAbsolute(specifier) ? specifier : nodePath.resolve(specifier);
  return nodeUrl.pathToFileURL(absolutePath).href;
}
function isRuntimeSpecifier(specifier) {
  return specifier.startsWith("file:") || specifier.startsWith("data:") || specifier.startsWith("node:") || specifier.startsWith("http:") || specifier.startsWith("https:");
}
function loadWorkerRuntime(node) {
  if (node?.parentPort && node.isMainThread === false) {
    if (globalWithWorker.__opentuiWorkerMessageBridge) {
      return createGlobalWorkerRuntimeBridge();
    }
    return {
      postMessage(value) {
        node.parentPort?.postMessage(value);
      },
      setMessageHandler(handler) {
        const listener = (data) => {
          handler({ data });
        };
        node.parentPort?.on("message", listener);
        return () => {
          node.parentPort?.off("message", listener);
        };
      }
    };
  }
  if (!isGlobalWorkerRuntime()) {
    return;
  }
  return createGlobalWorkerRuntimeBridge();
}
function createGlobalWorkerRuntimeBridge() {
  let currentRegistration;
  return {
    postMessage(value) {
      globalWithWorker.postMessage?.(value);
    },
    setMessageHandler(handler) {
      const previousHandler = getGlobalWorkerMessageHandler();
      if (currentRegistration && previousHandler !== currentRegistration.listener) {
        currentRegistration = undefined;
      }
      const listener = (event) => {
        const normalizedEvent = normalizeWorkerMessageEvent(event);
        handler(normalizedEvent);
      };
      const registration = {
        active: true,
        fallbackHandler: currentRegistration ? currentRegistration.fallbackHandler : previousHandler,
        listener,
        previous: currentRegistration
      };
      currentRegistration = registration;
      setGlobalWorkerMessageHandler(listener);
      return () => {
        registration.active = false;
        if (currentRegistration !== registration || getGlobalWorkerMessageHandler() !== listener) {
          return;
        }
        let previous = registration.previous;
        while (previous && !previous.active) {
          previous = previous.previous;
        }
        currentRegistration = previous;
        setGlobalWorkerMessageHandler(previous?.listener ?? registration.fallbackHandler);
      };
    }
  };
}
function isGlobalWorkerRuntime() {
  if (typeof globalWithWorker.postMessage !== "function") {
    return false;
  }
  return typeof document === "undefined" && typeof globalWithWorker.close === "function" && "onmessage" in globalThis;
}
function normalizeWorkerMessageEvent(event) {
  if (event && typeof event === "object" && "data" in event) {
    return event;
  }
  return { data: event };
}
function getGlobalWorkerMessageHandler() {
  return globalThis.onmessage ?? null;
}
function setGlobalWorkerMessageHandler(handler) {
  globalThis.onmessage = handler;
}

// src/lib/tree-sitter/client.ts
registerEnvVar({
  name: "OTUI_TREE_SITTER_WORKER_PATH",
  description: "Path to the TreeSitter worker entry script",
  type: "string",
  default: ""
});
var DEFAULT_PARSER_OVERRIDES = [];
function addDefaultParsers(parsers) {
  for (const parser of parsers) {
    DEFAULT_PARSER_OVERRIDES = [
      ...DEFAULT_PARSER_OVERRIDES.filter((existingParser) => existingParser.filetype !== parser.filetype),
      parser
    ];
  }
}
var isUrl = (path) => path.startsWith("http://") || path.startsWith("https://");

class TreeSitterClient extends EventEmitter2 {
  initialized = false;
  worker;
  buffers = new Map;
  initializePromise;
  initializeResolvers;
  messageCallbacks = new Map;
  messageIdCounter = 0;
  editQueues = new Map;
  debouncer;
  options;
  destroyCallbacks = new Set;
  lifecycleGeneration = 0;
  rejectInitialization;
  destroyPromise;
  workerTerminationFailed = false;
  constructor(options, internalOptions = {}) {
    super();
    this.options = options;
    this.debouncer = createDebounce("tree-sitter-client");
    if (internalOptions.autoStartWorker ?? true) {
      this.startWorker();
    }
  }
  onDestroy(callback) {
    this.destroyCallbacks.add(callback);
    return () => {
      this.destroyCallbacks.delete(callback);
    };
  }
  emitError(error, bufferId) {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error, bufferId);
    }
  }
  emitWarning(warning, bufferId) {
    if (this.listenerCount("warning") > 0) {
      this.emit("warning", warning, bufferId);
    }
  }
  startWorker() {
    if (this.worker) {
      return;
    }
    const workerPath = this.resolveWorkerPath();
    const worker = new Worker(workerPath);
    this.worker = worker;
    worker.onmessage = (event) => {
      if (this.worker !== worker) {
        return;
      }
      this.handleWorkerMessage(event);
    };
    worker.onerror = (error) => {
      if (this.worker !== worker) {
        return;
      }
      console.error("TreeSitter worker error:", error.message);
      const workerError = new Error(`Worker error: ${error.message}`, { cause: error.error });
      this.handleWorkerFailure(worker, workerError);
      this.emitError(`Worker error: ${error.message}`);
    };
  }
  sendWorkerMessage(message) {
    if (!this.worker) {
      throw new Error("TreeSitter worker is not available");
    }
    this.worker.postMessage(message);
  }
  rejectPendingRequests(error) {
    const requests = Array.from(this.messageCallbacks.values());
    this.messageCallbacks.clear();
    for (const request of requests) {
      request.reject(error);
    }
  }
  rejectActiveInitialization(error) {
    if (this.initializeResolvers) {
      clearTimeout(this.initializeResolvers.timeoutId);
      this.initializeResolvers.reject(error);
      this.initializeResolvers = undefined;
    }
    this.rejectInitialization?.(error);
    this.rejectInitialization = undefined;
  }
  handleWorkerFailure(worker, error) {
    if (this.worker !== worker) {
      return;
    }
    worker.onmessage = null;
    worker.onerror = null;
    this.worker = undefined;
    this.lifecycleGeneration++;
    this.initialized = false;
    this.initializePromise = undefined;
    this.rejectActiveInitialization(error);
    this.rejectPendingRequests(error);
    this.editQueues.clear();
    this.buffers.clear();
    this.debouncer.clear();
    try {
      Promise.resolve(worker.terminate()).catch(() => {});
    } catch {}
  }
  resolveWorkerPath() {
    if (this.options.workerPath) {
      return this.options.workerPath;
    }
    if (env.OTUI_TREE_SITTER_WORKER_PATH) {
      return env.OTUI_TREE_SITTER_WORKER_PATH;
    }
    if (typeof OTUI_TREE_SITTER_WORKER_PATH !== "undefined") {
      return OTUI_TREE_SITTER_WORKER_PATH;
    }
    let workerPath = resolveDefaultTreeSitterWorkerPath(new URL("./parser.worker.js", import.meta.url));
    if (!process.env.OTUI_ASSET_ROOT && !existsSync2(workerPath)) {
      workerPath = new URL("./parser.worker.ts", import.meta.url).href;
    }
    return workerPath;
  }
  async stopWorker() {
    const worker = this.worker;
    if (!worker) {
      return;
    }
    const onmessage = worker.onmessage;
    const onerror = worker.onerror;
    worker.onmessage = null;
    worker.onerror = null;
    this.worker = undefined;
    try {
      const termination = worker.terminate();
      if (termination && typeof termination.then === "function") {
        await termination;
      }
    } catch (error) {
      if (!this.worker) {
        worker.onmessage = onmessage;
        worker.onerror = onerror;
        this.worker = worker;
      }
      throw error;
    }
  }
  async handleReset() {
    this.buffers.clear();
    await this.stopWorker();
    this.startWorker();
    this.initialized = false;
    this.initializePromise = undefined;
    this.initializeResolvers = undefined;
    return this.initialize();
  }
  async initialize() {
    if (this.destroyPromise) {
      throw new Error("Cannot initialize while client is being destroyed");
    }
    if (this.workerTerminationFailed) {
      throw new Error("Cannot initialize after worker termination failed; retry destroy()");
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }
    if (!this.worker) {
      this.startWorker();
    }
    const worker = this.worker;
    const generation = this.lifecycleGeneration;
    let rejectCancellation;
    const cancellation = new Promise((_, reject) => {
      rejectCancellation = reject;
    });
    const initialization = Promise.race([this.initializeClient(generation, worker), cancellation]);
    this.rejectInitialization = rejectCancellation;
    this.initializePromise = initialization;
    initialization.then(() => {
      if (this.initializePromise === initialization) {
        this.rejectInitialization = undefined;
      }
    }, () => {
      if (this.initializePromise === initialization) {
        this.rejectInitialization = undefined;
      }
    });
    return this.initializePromise;
  }
  assertCurrentInitialization(generation, worker) {
    if (this.lifecycleGeneration !== generation || this.worker !== worker || this.destroyPromise) {
      throw new Error("TreeSitter initialization was invalidated");
    }
  }
  async initializeClient(generation, worker) {
    const treeSitterWasmPath = await resolveTreeSitterWasm();
    this.assertCurrentInitialization(generation, worker);
    await new Promise((resolve3, reject) => {
      const timeoutMs = this.options.initTimeout ?? 1e4;
      const timeoutId = setTimeout(() => {
        const error = new Error("Worker initialization timed out");
        console.error("TreeSitter client:", error.message);
        this.initializeResolvers = undefined;
        reject(error);
      }, timeoutMs);
      this.initializeResolvers = { resolve: resolve3, reject, timeoutId };
      this.sendWorkerMessage({
        type: "INIT",
        dataPath: this.options.dataPath,
        treeSitterWasmPath
      });
    });
    this.assertCurrentInitialization(generation, worker);
    await this.registerDefaultParsers(generation, worker);
    this.assertCurrentInitialization(generation, worker);
    this.initialized = true;
  }
  async registerDefaultParsers(generation = this.lifecycleGeneration, worker = this.worker) {
    const defaultParsers = await getParsers();
    this.assertCurrentInitialization(generation, worker);
    const overriddenFiletypes = new Set(DEFAULT_PARSER_OVERRIDES.map((parser) => parser.filetype));
    for (const parser of [
      ...defaultParsers.filter((parser2) => !overriddenFiletypes.has(parser2.filetype)),
      ...DEFAULT_PARSER_OVERRIDES
    ]) {
      worker.postMessage({ type: "ADD_FILETYPE_PARSER", filetypeParser: this.resolveFiletypeParser(parser) });
    }
  }
  resolvePath(path) {
    if (isUrl(path)) {
      return path;
    }
    if (isBunfsPath(path)) {
      return normalizeBunfsPath(parse(path).base);
    }
    if (!isAbsolute3(path)) {
      return resolve2(path);
    }
    return path;
  }
  addFiletypeParser(filetypeParser) {
    this.sendWorkerMessage({ type: "ADD_FILETYPE_PARSER", filetypeParser: this.resolveFiletypeParser(filetypeParser) });
  }
  resolveFiletypeParser(filetypeParser) {
    return {
      ...filetypeParser,
      aliases: filetypeParser.aliases ? [...new Set(filetypeParser.aliases.filter((alias) => alias !== filetypeParser.filetype))] : undefined,
      wasm: this.resolvePath(filetypeParser.wasm),
      queries: {
        highlights: filetypeParser.queries.highlights.map((path) => this.resolvePath(path)),
        injections: filetypeParser.queries.injections?.map((path) => this.resolvePath(path))
      }
    };
  }
  async getPerformance() {
    const messageId = `performance_${this.messageIdCounter++}`;
    return new Promise((resolve3, reject) => {
      this.messageCallbacks.set(messageId, { resolve: resolve3, reject });
      try {
        this.sendWorkerMessage({ type: "GET_PERFORMANCE", messageId });
      } catch (error) {
        this.messageCallbacks.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async highlightOnce(content, filetype) {
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        return { error: "Could not highlight because of initialization error" };
      }
    }
    const messageId = `oneshot_${this.messageIdCounter++}`;
    return new Promise((resolve3, reject) => {
      this.messageCallbacks.set(messageId, { resolve: resolve3, reject });
      try {
        this.sendWorkerMessage({
          type: "ONESHOT_HIGHLIGHT",
          content,
          filetype,
          messageId
        });
      } catch (error) {
        this.messageCallbacks.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  handleWorkerMessage(event) {
    const message = event.data;
    switch (message.type) {
      case "HIGHLIGHT_RESPONSE": {
        const buffer = this.buffers.get(message.bufferId);
        if (!buffer || !buffer.hasParser) {
          return;
        }
        if (buffer.version !== message.version) {
          this.resetBuffer(message.bufferId, buffer.version, buffer.content);
          return;
        }
        this.emit("highlights:response", message.bufferId, message.version, message.highlights);
        return;
      }
      case "INIT_RESPONSE": {
        if (!this.initializeResolvers) {
          return;
        }
        clearTimeout(this.initializeResolvers.timeoutId);
        if (message.error) {
          console.error("TreeSitter client initialization failed:", message.error);
          this.initializeResolvers.reject(new Error(message.error));
        } else {
          this.initializeResolvers.resolve();
        }
        this.initializeResolvers = undefined;
        return;
      }
      case "PARSER_INIT_RESPONSE": {
        const callback = this.messageCallbacks.get(message.messageId);
        if (callback) {
          this.messageCallbacks.delete(message.messageId);
          callback.resolve({ hasParser: message.hasParser, warning: message.warning, error: message.error });
        }
        return;
      }
      case "PRELOAD_PARSER_RESPONSE": {
        const callback = this.messageCallbacks.get(message.messageId);
        if (callback) {
          this.messageCallbacks.delete(message.messageId);
          callback.resolve({ hasParser: message.hasParser });
        }
        return;
      }
      case "BUFFER_DISPOSED": {
        const callback = this.messageCallbacks.get(`dispose_${message.bufferId}`);
        if (callback) {
          this.messageCallbacks.delete(`dispose_${message.bufferId}`);
          callback.resolve(true);
        }
        this.emit("buffer:disposed", message.bufferId);
        return;
      }
      case "PERFORMANCE_RESPONSE": {
        const callback = this.messageCallbacks.get(message.messageId);
        if (callback) {
          this.messageCallbacks.delete(message.messageId);
          callback.resolve(message.performance);
        }
        return;
      }
      case "ONESHOT_HIGHLIGHT_RESPONSE": {
        const callback = this.messageCallbacks.get(message.messageId);
        if (callback) {
          this.messageCallbacks.delete(message.messageId);
          callback.resolve({ highlights: message.highlights, warning: message.warning, error: message.error });
        }
        return;
      }
      case "UPDATE_DATA_PATH_RESPONSE": {
        const callback = this.messageCallbacks.get(message.messageId);
        if (callback) {
          this.messageCallbacks.delete(message.messageId);
          callback.resolve({ error: message.error });
        }
        return;
      }
      case "CLEAR_CACHE_RESPONSE": {
        const callback = this.messageCallbacks.get(message.messageId);
        if (callback) {
          this.messageCallbacks.delete(message.messageId);
          callback.resolve({ error: message.error });
        }
        return;
      }
      case "WARNING": {
        this.emitWarning(message.warning, message.bufferId);
        return;
      }
      case "ERROR": {
        this.emitError(message.error, message.bufferId);
        return;
      }
      case "WORKER_LOG": {
        this.emit("worker:log", message.logType, message.data.join(" "));
        return;
      }
    }
  }
  async preloadParser(filetype) {
    const messageId = `has_parser_${this.messageIdCounter++}`;
    const response = await new Promise((resolve3, reject) => {
      this.messageCallbacks.set(messageId, { resolve: resolve3, reject });
      try {
        this.sendWorkerMessage({
          type: "PRELOAD_PARSER",
          filetype,
          messageId
        });
      } catch (error) {
        this.messageCallbacks.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return response.hasParser;
  }
  async createBuffer(id, content, filetype, version = 1, autoInitialize = true) {
    if (!this.initialized) {
      if (!autoInitialize) {
        this.emitError("Could not create buffer because client is not initialized");
        return false;
      }
      try {
        await this.initialize();
      } catch (error) {
        this.emitError("Could not create buffer because of initialization error");
        return false;
      }
    }
    if (this.buffers.has(id)) {
      throw new Error(`Buffer with id ${id} already exists`);
    }
    this.buffers.set(id, { id, content, filetype, version, hasParser: false });
    const messageId = `init_${this.messageIdCounter++}`;
    const response = await new Promise((resolve3, reject) => {
      this.messageCallbacks.set(messageId, { resolve: resolve3, reject });
      try {
        this.sendWorkerMessage({
          type: "INITIALIZE_PARSER",
          bufferId: id,
          version,
          content,
          filetype,
          messageId
        });
      } catch (error) {
        this.messageCallbacks.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    if (!response.hasParser) {
      this.emit("buffer:initialized", id, false);
      if (filetype !== "plaintext") {
        this.emitWarning(response.warning || response.error || "Buffer has no parser", id);
      }
      return false;
    }
    const bufferState = { id, content, filetype, version, hasParser: true };
    this.buffers.set(id, bufferState);
    this.emit("buffer:initialized", id, true);
    return true;
  }
  async updateBuffer(id, edits, newContent, version) {
    if (!this.initialized) {
      return;
    }
    const buffer = this.buffers.get(id);
    if (!buffer || !buffer.hasParser) {
      return;
    }
    this.buffers.set(id, { ...buffer, content: newContent, version });
    if (!this.editQueues.has(id)) {
      this.editQueues.set(id, new ProcessQueue((item) => this.processEdit(id, item.edits, item.newContent, item.version, item.isReset)));
    }
    const bufferQueue = this.editQueues.get(id);
    bufferQueue.enqueue({ edits, newContent, version });
  }
  async processEdit(bufferId, edits, newContent, version, isReset = false) {
    this.sendWorkerMessage({
      type: isReset ? "RESET_BUFFER" : "HANDLE_EDITS",
      bufferId,
      version,
      content: newContent,
      edits
    });
  }
  async removeBuffer(bufferId) {
    if (!this.initialized) {
      return;
    }
    this.buffers.delete(bufferId);
    if (this.editQueues.has(bufferId)) {
      this.editQueues.get(bufferId)?.clear();
      this.editQueues.delete(bufferId);
    }
    if (this.worker) {
      await new Promise((resolve3, reject) => {
        const messageId = `dispose_${bufferId}`;
        this.messageCallbacks.set(messageId, { resolve: resolve3, reject });
        try {
          this.sendWorkerMessage({
            type: "DISPOSE_BUFFER",
            bufferId
          });
        } catch (error) {
          console.error("Error disposing buffer", error);
          this.messageCallbacks.delete(messageId);
          resolve3(false);
        }
        setTimeout(() => {
          if (this.messageCallbacks.has(messageId)) {
            this.messageCallbacks.delete(messageId);
            console.warn({ bufferId }, "Timed out waiting for buffer to be disposed");
            resolve3(false);
          }
        }, 3000);
      });
    }
    this.debouncer.clearDebounce(`reset-${bufferId}`);
  }
  destroy() {
    if (this.destroyPromise) {
      return this.destroyPromise;
    }
    let resolveDestroy;
    let rejectDestroy;
    const destroyPromise = new Promise((resolve3, reject) => {
      resolveDestroy = resolve3;
      rejectDestroy = reject;
    });
    this.destroyPromise = destroyPromise;
    const destroyError = new Error("Client destroyed during initialization");
    this.lifecycleGeneration++;
    this.initialized = false;
    this.initializePromise = undefined;
    this.rejectActiveInitialization(destroyError);
    this.rejectPendingRequests(new Error("TreeSitter client destroyed"));
    for (const callback of this.destroyCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error("TreeSitter client destroy callback failed:", error);
      }
    }
    this.destroyCallbacks.clear();
    clearDebounceScope("tree-sitter-client");
    this.debouncer.clear();
    this.editQueues.clear();
    this.buffers.clear();
    this.stopWorker().then(() => {
      this.workerTerminationFailed = false;
      if (this.destroyPromise === destroyPromise) {
        this.destroyPromise = undefined;
      }
      resolveDestroy();
    }, (error) => {
      this.workerTerminationFailed = true;
      if (this.destroyPromise === destroyPromise) {
        this.destroyPromise = undefined;
      }
      rejectDestroy(error);
    });
    return destroyPromise;
  }
  async resetBuffer(bufferId, version, content) {
    if (!this.initialized) {
      return;
    }
    const buffer = this.buffers.get(bufferId);
    if (!buffer || !buffer.hasParser) {
      this.emitError("Cannot reset buffer with no parser", bufferId);
      return;
    }
    this.buffers.set(bufferId, { ...buffer, content, version });
    this.debouncer.debounce(`reset-${bufferId}`, 10, () => this.processEdit(bufferId, [], content, version, true));
  }
  getBuffer(bufferId) {
    return this.buffers.get(bufferId);
  }
  getAllBuffers() {
    return Array.from(this.buffers.values());
  }
  isInitialized() {
    return this.initialized;
  }
  async setDataPath(dataPath) {
    if (this.options.dataPath === dataPath) {
      return;
    }
    this.options.dataPath = dataPath;
    if (this.initialized && this.worker) {
      const messageId = `update_datapath_${this.messageIdCounter++}`;
      return new Promise((resolve3, reject) => {
        this.messageCallbacks.set(messageId, {
          resolve: (response) => {
            if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve3();
            }
          },
          reject
        });
        try {
          this.sendWorkerMessage({
            type: "UPDATE_DATA_PATH",
            dataPath,
            messageId
          });
        } catch (error) {
          this.messageCallbacks.delete(messageId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
  }
  async clearCache() {
    if (!this.initialized || !this.worker) {
      throw new Error("Cannot clear cache: client is not initialized");
    }
    const messageId = `clear_cache_${this.messageIdCounter++}`;
    return new Promise((resolve3, reject) => {
      this.messageCallbacks.set(messageId, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve3();
          }
        },
        reject
      });
      try {
        this.sendWorkerMessage({
          type: "CLEAR_CACHE",
          messageId
        });
      } catch (error) {
        this.messageCallbacks.delete(messageId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

// src/lib/data-paths.ts
import os from "os";
import path from "path";
import { EventEmitter as EventEmitter3 } from "events";

// src/lib/validate-dir-name.ts
function isValidDirectoryName(name) {
  if (!name || typeof name !== "string") {
    return false;
  }
  if (name.trim().length === 0) {
    return false;
  }
  const reservedNames = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9"
  ];
  if (reservedNames.includes(name.toUpperCase())) {
    return false;
  }
  const invalidChars = /[<>:"|?*/\\\x00-\x1f]/;
  if (invalidChars.test(name)) {
    return false;
  }
  if (name.endsWith(".") || name.endsWith(" ")) {
    return false;
  }
  if (name === "." || name === "..") {
    return false;
  }
  return true;
}

// src/lib/data-paths.ts
registerEnvVar({
  name: "XDG_CONFIG_HOME",
  description: "Base directory for user-specific configuration files",
  type: "string",
  default: ""
});
registerEnvVar({
  name: "XDG_DATA_HOME",
  description: "Base directory for user-specific data files",
  type: "string",
  default: ""
});

class DataPathsManager extends EventEmitter3 {
  _appName;
  _globalConfigPath;
  _globalConfigFile;
  _localConfigFile;
  _globalDataPath;
  constructor() {
    super();
    this._appName = "opentui";
  }
  get appName() {
    return this._appName;
  }
  set appName(value) {
    if (!isValidDirectoryName(value)) {
      throw new Error(`Invalid app name "${value}": must be a valid directory name`);
    }
    if (this._appName !== value) {
      this._appName = value;
      this._globalConfigPath = undefined;
      this._globalConfigFile = undefined;
      this._localConfigFile = undefined;
      this._globalDataPath = undefined;
      this.emit("paths:changed", this.toObject());
    }
  }
  get globalConfigPath() {
    if (this._globalConfigPath === undefined) {
      const homeDir = os.homedir();
      const xdgConfigHome = env.XDG_CONFIG_HOME;
      const baseConfigDir = xdgConfigHome || path.join(homeDir, ".config");
      this._globalConfigPath = path.join(baseConfigDir, this._appName);
    }
    return this._globalConfigPath;
  }
  get globalConfigFile() {
    if (this._globalConfigFile === undefined) {
      this._globalConfigFile = path.join(this.globalConfigPath, "init.ts");
    }
    return this._globalConfigFile;
  }
  get localConfigFile() {
    if (this._localConfigFile === undefined) {
      this._localConfigFile = path.join(process.cwd(), `.${this._appName}.ts`);
    }
    return this._localConfigFile;
  }
  get globalDataPath() {
    if (this._globalDataPath === undefined) {
      const homeDir = os.homedir();
      const xdgDataHome = env.XDG_DATA_HOME;
      const baseDataDir = xdgDataHome || path.join(homeDir, ".local/share");
      this._globalDataPath = path.join(baseDataDir, this._appName);
    }
    return this._globalDataPath;
  }
  toObject() {
    return {
      globalConfigPath: this.globalConfigPath,
      globalConfigFile: this.globalConfigFile,
      localConfigFile: this.localConfigFile,
      globalDataPath: this.globalDataPath
    };
  }
}
function getDataPaths() {
  return singleton("data-paths-opentui", () => new DataPathsManager);
}
// src/lib/tree-sitter/resolve-ft.ts
import path2 from "path";
var extensionToFiletype = new Map([
  ["astro", "astro"],
  ["bash", "bash"],
  ["c", "c"],
  ["cc", "cpp"],
  ["cjs", "javascript"],
  ["clj", "clojure"],
  ["cljs", "clojure"],
  ["cljc", "clojure"],
  ["cpp", "cpp"],
  ["cxx", "cpp"],
  ["cs", "csharp"],
  ["cts", "typescript"],
  ["ctsx", "typescriptreact"],
  ["dart", "dart"],
  ["diff", "diff"],
  ["edn", "clojure"],
  ["go", "go"],
  ["gemspec", "ruby"],
  ["groovy", "groovy"],
  ["h", "c"],
  ["handlebars", "handlebars"],
  ["hbs", "handlebars"],
  ["hpp", "cpp"],
  ["hxx", "cpp"],
  ["h++", "cpp"],
  ["hh", "cpp"],
  ["hrl", "erlang"],
  ["hs", "haskell"],
  ["htm", "html"],
  ["html", "html"],
  ["ini", "ini"],
  ["js", "javascript"],
  ["jsx", "javascriptreact"],
  ["jl", "julia"],
  ["json", "json"],
  ["ksh", "bash"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["latex", "latex"],
  ["less", "less"],
  ["lua", "lua"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["mdown", "markdown"],
  ["mkd", "markdown"],
  ["mjs", "javascript"],
  ["ml", "ocaml"],
  ["mli", "ocaml"],
  ["mts", "typescript"],
  ["mtsx", "typescriptreact"],
  ["patch", "diff"],
  ["php", "php"],
  ["pl", "perl"],
  ["pm", "perl"],
  ["ps1", "powershell"],
  ["psm1", "powershell"],
  ["py", "python"],
  ["pyi", "python"],
  ["r", "r"],
  ["rb", "ruby"],
  ["rake", "ruby"],
  ["rs", "rust"],
  ["ru", "ruby"],
  ["sass", "sass"],
  ["sc", "scala"],
  ["scala", "scala"],
  ["scss", "scss"],
  ["sh", "bash"],
  ["sql", "sql"],
  ["svelte", "svelte"],
  ["swift", "swift"],
  ["ts", "typescript"],
  ["tsx", "typescriptreact"],
  ["tex", "latex"],
  ["toml", "toml"],
  ["vue", "vue"],
  ["vim", "vim"],
  ["xml", "xml"],
  ["xsl", "xsl"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["zig", "zig"],
  ["zon", "zig"],
  ["zsh", "bash"],
  ["c++", "cpp"],
  ["erl", "erlang"],
  ["exs", "elixir"],
  ["ex", "elixir"],
  ["elm", "elm"],
  ["fsharp", "fsharp"],
  ["fs", "fsharp"],
  ["fsx", "fsharp"],
  ["fsscript", "fsharp"],
  ["fsi", "fsharp"],
  ["java", "java"],
  ["css", "css"]
]);
var basenameToFiletype = new Map([
  [".bash_aliases", "bash"],
  [".bash_logout", "bash"],
  [".bash_profile", "bash"],
  [".bashrc", "bash"],
  [".kshrc", "bash"],
  [".profile", "bash"],
  [".vimrc", "vim"],
  [".zlogin", "bash"],
  [".zlogout", "bash"],
  [".zprofile", "bash"],
  [".zshenv", "bash"],
  [".zshrc", "bash"],
  ["appfile", "ruby"],
  ["berksfile", "ruby"],
  ["brewfile", "ruby"],
  ["cheffile", "ruby"],
  ["containerfile", "dockerfile"],
  ["dockerfile", "dockerfile"],
  ["fastfile", "ruby"],
  ["gemfile", "ruby"],
  ["gnumakefile", "make"],
  ["gvimrc", "vim"],
  ["guardfile", "ruby"],
  ["makefile", "make"],
  ["podfile", "ruby"],
  ["rakefile", "ruby"],
  ["thorfile", "ruby"],
  ["vagrantfile", "ruby"]
]);
function normalizeFiletypeToken(value) {
  const normalizedValue = value.trim().replace(/^\./, "").toLowerCase();
  return normalizedValue || undefined;
}
function getBasename(value) {
  const normalizedValue = value.trim().replaceAll("\\", "/");
  if (!normalizedValue)
    return;
  const basename2 = path2.posix.basename(normalizedValue).toLowerCase();
  return basename2 || undefined;
}
function extToFiletype(extension) {
  const normalizedExtension = normalizeFiletypeToken(extension);
  if (!normalizedExtension)
    return;
  return extensionToFiletype.get(normalizedExtension);
}
function pathToFiletype(path3) {
  if (typeof path3 !== "string")
    return;
  const basename2 = getBasename(path3);
  if (!basename2)
    return;
  const basenameFiletype = basenameToFiletype.get(basename2);
  if (basenameFiletype) {
    return basenameFiletype;
  }
  const lastDot = basename2.lastIndexOf(".");
  if (lastDot === -1 || lastDot === basename2.length - 1) {
    return;
  }
  const extension = basename2.substring(lastDot + 1);
  return extToFiletype(extension);
}
function infoStringToFiletype(infoString) {
  if (typeof infoString !== "string")
    return;
  const token = infoString.trim().split(/\s+/, 1)[0];
  const directBasenameMatch = basenameToFiletype.get(token.toLowerCase());
  if (directBasenameMatch)
    return directBasenameMatch;
  const normalizedToken = normalizeFiletypeToken(token);
  if (!normalizedToken)
    return;
  return basenameToFiletype.get(normalizedToken) ?? pathToFiletype(normalizedToken) ?? extToFiletype(normalizedToken) ?? normalizedToken;
}

// src/lib/tree-sitter/index.ts
var TREE_SITTER_CLIENT_KEY = "tree-sitter-client";
var TREE_SITTER_CLIENT_LISTENER_STATE_KEY = "tree-sitter-client-listener-state";
function getTreeSitterClientListenerState() {
  return singleton(TREE_SITTER_CLIENT_LISTENER_STATE_KEY, () => ({}));
}
function getTreeSitterClient() {
  const existingClient = getSingleton(TREE_SITTER_CLIENT_KEY);
  if (existingClient) {
    return existingClient;
  }
  const dataPathsManager = getDataPaths();
  const defaultOptions = {
    dataPath: dataPathsManager.globalDataPath
  };
  return singleton(TREE_SITTER_CLIENT_KEY, () => {
    const client2 = new TreeSitterClient(defaultOptions);
    const listenerState = getTreeSitterClientListenerState();
    const handlePathsChanged = (paths) => {
      client2.setDataPath(paths.globalDataPath).catch((error) => {
        console.warn("Failed to update tree-sitter data path:", error);
      });
    };
    const removeListener = () => {
      dataPathsManager.off("paths:changed", handlePathsChanged);
      if (listenerState.removeListener === removeListener) {
        listenerState.removeListener = undefined;
      }
      if (getSingleton(TREE_SITTER_CLIENT_KEY) === client2) {
        destroySingleton(TREE_SITTER_CLIENT_KEY);
      }
    };
    listenerState.removeListener = removeListener;
    client2.onDestroy(removeListener);
    dataPathsManager.on("paths:changed", handlePathsChanged);
    return client2;
  });
}
async function destroyTreeSitterClient() {
  const client2 = getSingleton(TREE_SITTER_CLIENT_KEY);
  if (!client2) {
    const listenerState = getSingleton(TREE_SITTER_CLIENT_LISTENER_STATE_KEY);
    listenerState?.removeListener?.();
    if (listenerState) {
      listenerState.removeListener = undefined;
    }
    return;
  }
  destroySingleton(TREE_SITTER_CLIENT_KEY);
  await client2.destroy();
}
// src/lib/extmarks-history.ts
class ExtmarksHistory {
  undoStack = [];
  redoStack = [];
  saveSnapshot(extmarks, nextId) {
    const snapshot = {
      extmarks: new Map(Array.from(extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }])),
      nextId
    };
    this.undoStack.push(snapshot);
    this.redoStack = [];
  }
  undo() {
    if (this.undoStack.length === 0)
      return null;
    return this.undoStack.pop();
  }
  redo() {
    if (this.redoStack.length === 0)
      return null;
    return this.redoStack.pop();
  }
  pushRedo(snapshot) {
    this.redoStack.push(snapshot);
  }
  pushUndo(snapshot) {
    this.undoStack.push(snapshot);
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
}

// src/lib/extmarks.ts
class ExtmarksController {
  editBuffer;
  editorView;
  extmarks = new Map;
  extmarksByTypeId = new Map;
  metadata = new Map;
  nextId = 1;
  destroyed = false;
  history = new ExtmarksHistory;
  typeNameToId = new Map;
  typeIdToName = new Map;
  nextTypeId = 1;
  originalMoveCursorLeft;
  originalMoveCursorRight;
  originalSetCursorByOffset;
  originalMoveUpVisual;
  originalMoveDownVisual;
  originalDeleteCharBackward;
  originalDeleteChar;
  originalInsertText;
  originalInsertChar;
  originalDeleteRange;
  originalSetText;
  originalReplaceText;
  originalClear;
  originalNewLine;
  originalDeleteLine;
  originalEditorViewDeleteSelectedText;
  originalUndo;
  originalRedo;
  constructor(editBuffer, editorView) {
    this.editBuffer = editBuffer;
    this.editorView = editorView;
    this.originalMoveCursorLeft = editBuffer.moveCursorLeft.bind(editBuffer);
    this.originalMoveCursorRight = editBuffer.moveCursorRight.bind(editBuffer);
    this.originalSetCursorByOffset = editBuffer.setCursorByOffset.bind(editBuffer);
    this.originalMoveUpVisual = editorView.moveUpVisual.bind(editorView);
    this.originalMoveDownVisual = editorView.moveDownVisual.bind(editorView);
    this.originalDeleteCharBackward = editBuffer.deleteCharBackward.bind(editBuffer);
    this.originalDeleteChar = editBuffer.deleteChar.bind(editBuffer);
    this.originalInsertText = editBuffer.insertText.bind(editBuffer);
    this.originalInsertChar = editBuffer.insertChar.bind(editBuffer);
    this.originalDeleteRange = editBuffer.deleteRange.bind(editBuffer);
    this.originalSetText = editBuffer.setText.bind(editBuffer);
    this.originalReplaceText = editBuffer.replaceText.bind(editBuffer);
    this.originalClear = editBuffer.clear.bind(editBuffer);
    this.originalNewLine = editBuffer.newLine.bind(editBuffer);
    this.originalDeleteLine = editBuffer.deleteLine.bind(editBuffer);
    this.originalEditorViewDeleteSelectedText = editorView.deleteSelectedText.bind(editorView);
    this.originalUndo = editBuffer.undo.bind(editBuffer);
    this.originalRedo = editBuffer.redo.bind(editBuffer);
    this.wrapCursorMovement();
    this.wrapDeletion();
    this.wrapInsertion();
    this.wrapEditorViewDeleteSelectedText();
    this.wrapUndoRedo();
    this.setupContentChangeListener();
  }
  wrapCursorMovement() {
    this.editBuffer.moveCursorLeft = () => {
      if (this.destroyed) {
        this.originalMoveCursorLeft();
        return;
      }
      const currentOffset = this.editorView.getVisualCursor().offset;
      const hasSelection = this.editorView.hasSelection();
      if (hasSelection) {
        this.originalMoveCursorLeft();
        return;
      }
      const targetOffset = currentOffset - 1;
      if (targetOffset < 0) {
        this.originalMoveCursorLeft();
        return;
      }
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset);
      if (virtualExtmark && currentOffset >= virtualExtmark.end) {
        this.editBuffer.setCursorByOffset(virtualExtmark.start - 1);
        return;
      }
      this.originalMoveCursorLeft();
    };
    this.editBuffer.moveCursorRight = () => {
      if (this.destroyed) {
        this.originalMoveCursorRight();
        return;
      }
      const currentOffset = this.editorView.getVisualCursor().offset;
      const hasSelection = this.editorView.hasSelection();
      if (hasSelection) {
        this.originalMoveCursorRight();
        return;
      }
      const targetOffset = currentOffset + 1;
      const textLength = this.editBuffer.getText().length;
      if (targetOffset > textLength) {
        this.originalMoveCursorRight();
        return;
      }
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset);
      if (virtualExtmark && currentOffset <= virtualExtmark.start) {
        this.editBuffer.setCursorByOffset(virtualExtmark.end);
        return;
      }
      this.originalMoveCursorRight();
    };
    this.editorView.moveUpVisual = () => {
      if (this.destroyed) {
        this.originalMoveUpVisual();
        return;
      }
      const hasSelection = this.editorView.hasSelection();
      if (hasSelection) {
        this.originalMoveUpVisual();
        return;
      }
      const currentOffset = this.editorView.getVisualCursor().offset;
      this.originalMoveUpVisual();
      const newOffset = this.editorView.getVisualCursor().offset;
      const virtualExtmark = this.findVirtualExtmarkContaining(newOffset);
      if (virtualExtmark) {
        const distanceToStart = newOffset - virtualExtmark.start;
        const distanceToEnd = virtualExtmark.end - newOffset;
        if (distanceToStart < distanceToEnd) {
          this.editorView.setCursorByOffset(virtualExtmark.start - 1);
        } else {
          this.editorView.setCursorByOffset(virtualExtmark.end);
        }
      }
    };
    this.editorView.moveDownVisual = () => {
      if (this.destroyed) {
        this.originalMoveDownVisual();
        return;
      }
      const hasSelection = this.editorView.hasSelection();
      if (hasSelection) {
        this.originalMoveDownVisual();
        return;
      }
      const currentOffset = this.editorView.getVisualCursor().offset;
      this.originalMoveDownVisual();
      const newOffset = this.editorView.getVisualCursor().offset;
      const virtualExtmark = this.findVirtualExtmarkContaining(newOffset);
      if (virtualExtmark) {
        const distanceToStart = newOffset - virtualExtmark.start;
        const distanceToEnd = virtualExtmark.end - newOffset;
        if (distanceToStart < distanceToEnd) {
          const adjustedOffset = virtualExtmark.start - 1;
          const targetOffset = adjustedOffset <= currentOffset ? virtualExtmark.end : adjustedOffset;
          this.editorView.setCursorByOffset(targetOffset);
        } else {
          this.editorView.setCursorByOffset(virtualExtmark.end);
        }
      }
    };
    this.editBuffer.setCursorByOffset = (offset) => {
      if (this.destroyed) {
        this.originalSetCursorByOffset(offset);
        return;
      }
      const currentOffset = this.editorView.getVisualCursor().offset;
      const hasSelection = this.editorView.hasSelection();
      if (hasSelection) {
        this.originalSetCursorByOffset(offset);
        return;
      }
      const movingForward = offset > currentOffset;
      if (movingForward) {
        const virtualExtmark = this.findVirtualExtmarkContaining(offset);
        if (virtualExtmark && currentOffset <= virtualExtmark.start) {
          this.originalSetCursorByOffset(virtualExtmark.end);
          return;
        }
      } else {
        for (const extmark of this.extmarks.values()) {
          if (extmark.virtual && currentOffset >= extmark.end && offset < extmark.end && offset >= extmark.start) {
            this.originalSetCursorByOffset(extmark.start - 1);
            return;
          }
        }
      }
      this.originalSetCursorByOffset(offset);
    };
  }
  wrapDeletion() {
    this.editBuffer.deleteCharBackward = () => {
      if (this.destroyed) {
        this.originalDeleteCharBackward();
        return;
      }
      this.saveSnapshot();
      const currentOffset = this.editorView.getVisualCursor().offset;
      const hadSelection = this.editorView.hasSelection();
      if (currentOffset === 0) {
        this.originalDeleteCharBackward();
        return;
      }
      if (hadSelection) {
        this.originalDeleteCharBackward();
        return;
      }
      const targetOffset = currentOffset - 1;
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset);
      if (virtualExtmark && currentOffset === virtualExtmark.end) {
        const startCursor = this.offsetToPosition(virtualExtmark.start);
        const endCursor = this.offsetToPosition(virtualExtmark.end);
        const deleteOffset2 = virtualExtmark.start;
        const deleteLength2 = virtualExtmark.end - virtualExtmark.start;
        this.deleteExtmarkById(virtualExtmark.id);
        this.originalDeleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col);
        this.adjustExtmarksAfterDeletion(deleteOffset2, deleteLength2);
        this.updateHighlights();
        return;
      }
      this.originalDeleteCharBackward();
      const deleteOffset = this.editorView.getVisualCursor().offset;
      const deleteLength = currentOffset - deleteOffset;
      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength);
      }
    };
    this.editBuffer.deleteChar = () => {
      if (this.destroyed) {
        this.originalDeleteChar();
        return;
      }
      this.saveSnapshot();
      const currentOffset = this.editorView.getVisualCursor().offset;
      const hadSelection = this.editorView.hasSelection();
      if (hadSelection) {
        this.originalDeleteChar();
        return;
      }
      const targetOffset = currentOffset;
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset);
      if (virtualExtmark && currentOffset === virtualExtmark.start) {
        const startCursor = this.offsetToPosition(virtualExtmark.start);
        const endCursor = this.offsetToPosition(virtualExtmark.end);
        const deleteOffset = virtualExtmark.start;
        const deleteLength2 = virtualExtmark.end - virtualExtmark.start;
        this.deleteExtmarkById(virtualExtmark.id);
        this.originalDeleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col);
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength2);
        this.updateHighlights();
        return;
      }
      const deleteEndOffset = this.getNextCursorOffset(currentOffset);
      const deleteLength = deleteEndOffset - currentOffset;
      this.originalDeleteChar();
      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(currentOffset, deleteLength);
      }
    };
    this.editBuffer.deleteRange = (startLine, startCol, endLine, endCol) => {
      if (this.destroyed) {
        this.originalDeleteRange(startLine, startCol, endLine, endCol);
        return;
      }
      this.saveSnapshot();
      const startOffset = this.positionToOffset(startLine, startCol);
      const endOffset = this.positionToOffset(endLine, endCol);
      const length = endOffset - startOffset;
      this.originalDeleteRange(startLine, startCol, endLine, endCol);
      this.adjustExtmarksAfterDeletion(startOffset, length);
    };
    this.editBuffer.deleteLine = () => {
      if (this.destroyed) {
        this.originalDeleteLine();
        return;
      }
      this.saveSnapshot();
      const text = this.editBuffer.getText();
      const currentOffset = this.editorView.getVisualCursor().offset;
      let lineStart = 0;
      for (let i = currentOffset - 1;i >= 0; i--) {
        if (text[i] === `
`) {
          lineStart = i + 1;
          break;
        }
      }
      let lineEnd = text.length;
      for (let i = currentOffset;i < text.length; i++) {
        if (text[i] === `
`) {
          lineEnd = i + 1;
          break;
        }
      }
      const deleteLength = lineEnd - lineStart;
      this.originalDeleteLine();
      this.adjustExtmarksAfterDeletion(lineStart, deleteLength);
    };
  }
  wrapInsertion() {
    this.editBuffer.insertText = (text) => {
      if (this.destroyed) {
        this.originalInsertText(text);
        return;
      }
      this.saveSnapshot();
      const currentOffset = this.editorView.getVisualCursor().offset;
      this.originalInsertText(text);
      const insertLength = this.editorView.getVisualCursor().offset - currentOffset;
      if (insertLength > 0) {
        this.adjustExtmarksAfterInsertion(currentOffset, insertLength);
      }
    };
    this.editBuffer.insertChar = (char) => {
      if (this.destroyed) {
        this.originalInsertChar(char);
        return;
      }
      this.saveSnapshot();
      const currentOffset = this.editorView.getVisualCursor().offset;
      this.originalInsertChar(char);
      const insertLength = this.editorView.getVisualCursor().offset - currentOffset;
      if (insertLength > 0) {
        this.adjustExtmarksAfterInsertion(currentOffset, insertLength);
      }
    };
    this.editBuffer.setText = (text) => {
      if (this.destroyed) {
        this.originalSetText(text);
        return;
      }
      this.clear();
      this.originalSetText(text);
    };
    this.editBuffer.replaceText = (text) => {
      if (this.destroyed) {
        this.originalReplaceText(text);
        return;
      }
      this.saveSnapshot();
      this.clear();
      this.originalReplaceText(text);
    };
    this.editBuffer.clear = () => {
      if (this.destroyed) {
        this.originalClear();
        return;
      }
      this.saveSnapshot();
      this.clear();
      this.originalClear();
    };
    this.editBuffer.newLine = () => {
      if (this.destroyed) {
        this.originalNewLine();
        return;
      }
      this.saveSnapshot();
      const currentOffset = this.editorView.getVisualCursor().offset;
      this.originalNewLine();
      this.adjustExtmarksAfterInsertion(currentOffset, 1);
    };
  }
  wrapEditorViewDeleteSelectedText() {
    this.editorView.deleteSelectedText = () => {
      if (this.destroyed) {
        this.originalEditorViewDeleteSelectedText();
        return;
      }
      this.saveSnapshot();
      const selection = this.editorView.getSelection();
      if (!selection) {
        this.originalEditorViewDeleteSelectedText();
        return;
      }
      const deleteOffset = Math.min(selection.start, selection.end);
      const deleteLength = Math.abs(selection.end - selection.start);
      this.originalEditorViewDeleteSelectedText();
      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength);
      }
    };
  }
  setupContentChangeListener() {
    this.editBuffer.on("content-changed", () => {
      if (this.destroyed)
        return;
      this.updateHighlights();
    });
  }
  deleteExtmarkById(id) {
    const extmark = this.extmarks.get(id);
    if (extmark) {
      this.extmarks.delete(id);
      this.extmarksByTypeId.get(extmark.typeId)?.delete(id);
      this.metadata.delete(id);
    }
  }
  findVirtualExtmarkContaining(offset) {
    for (const extmark of this.extmarks.values()) {
      if (extmark.virtual && offset >= extmark.start && offset < extmark.end) {
        return extmark;
      }
    }
    return null;
  }
  adjustExtmarksAfterInsertion(insertOffset, length) {
    for (const extmark of this.extmarks.values()) {
      if (extmark.start >= insertOffset) {
        extmark.start += length;
        extmark.end += length;
      } else if (extmark.end > insertOffset) {
        extmark.end += length;
      }
    }
    this.updateHighlights();
  }
  adjustExtmarksAfterDeletion(deleteOffset, length) {
    const toDelete = [];
    for (const extmark of this.extmarks.values()) {
      if (extmark.end <= deleteOffset) {
        continue;
      }
      if (extmark.start >= deleteOffset + length) {
        extmark.start -= length;
        extmark.end -= length;
      } else if (extmark.start >= deleteOffset && extmark.end <= deleteOffset + length) {
        toDelete.push(extmark.id);
      } else if (extmark.start < deleteOffset && extmark.end > deleteOffset + length) {
        extmark.end -= length;
      } else if (extmark.start < deleteOffset && extmark.end > deleteOffset) {
        extmark.end -= Math.min(extmark.end, deleteOffset + length) - deleteOffset;
      } else if (extmark.start < deleteOffset + length && extmark.end > deleteOffset + length) {
        const overlap = deleteOffset + length - extmark.start;
        extmark.start = deleteOffset;
        extmark.end -= length;
      }
    }
    for (const id of toDelete) {
      this.deleteExtmarkById(id);
    }
    this.updateHighlights();
  }
  offsetToPosition(offset) {
    const result = this.editBuffer.offsetToPosition(offset);
    if (!result) {
      return { row: 0, col: 0 };
    }
    return result;
  }
  positionToOffset(row, col) {
    return this.editBuffer.positionToOffset(row, col);
  }
  getNextCursorOffset(currentOffset) {
    this.originalMoveCursorRight();
    const nextOffset = this.editorView.getVisualCursor().offset;
    this.originalSetCursorByOffset(currentOffset);
    return nextOffset;
  }
  updateHighlights() {
    this.editBuffer.clearAllHighlights();
    for (const extmark of this.extmarks.values()) {
      if (extmark.styleId !== undefined) {
        const startWithoutNewlines = this.offsetExcludingNewlines(extmark.start);
        const endWithoutNewlines = this.offsetExcludingNewlines(extmark.end);
        this.editBuffer.addHighlightByCharRange({
          start: startWithoutNewlines,
          end: endWithoutNewlines,
          styleId: extmark.styleId,
          priority: extmark.priority ?? 0,
          hlRef: extmark.id
        });
      }
    }
  }
  offsetExcludingNewlines(offset) {
    const text = this.editBuffer.getText();
    let displayWidthSoFar = 0;
    let newlineCount = 0;
    let i = 0;
    while (i < text.length && displayWidthSoFar < offset) {
      if (text[i] === `
`) {
        displayWidthSoFar++;
        newlineCount++;
        i++;
      } else {
        let j = i;
        while (j < text.length && text[j] !== `
`) {
          j++;
        }
        const chunk = text.substring(i, j);
        const chunkWidth = stringWidth2(chunk);
        if (displayWidthSoFar + chunkWidth < offset) {
          displayWidthSoFar += chunkWidth;
          i = j;
        } else {
          for (let k = i;k < j && displayWidthSoFar < offset; k++) {
            const charWidth = stringWidth2(text[k]);
            displayWidthSoFar += charWidth;
          }
          break;
        }
      }
    }
    return offset - newlineCount;
  }
  create(options) {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed");
    }
    const id = this.nextId++;
    const typeId = options.typeId ?? 0;
    const extmark = {
      id,
      start: options.start,
      end: options.end,
      virtual: options.virtual ?? false,
      styleId: options.styleId,
      priority: options.priority,
      data: options.data,
      typeId
    };
    this.extmarks.set(id, extmark);
    if (!this.extmarksByTypeId.has(typeId)) {
      this.extmarksByTypeId.set(typeId, new Set);
    }
    this.extmarksByTypeId.get(typeId).add(id);
    if (options.metadata !== undefined) {
      this.metadata.set(id, options.metadata);
    }
    this.updateHighlights();
    return id;
  }
  delete(id) {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed");
    }
    const extmark = this.extmarks.get(id);
    if (!extmark)
      return false;
    this.deleteExtmarkById(id);
    this.updateHighlights();
    return true;
  }
  get(id) {
    if (this.destroyed)
      return null;
    return this.extmarks.get(id) ?? null;
  }
  getAll() {
    if (this.destroyed)
      return [];
    return Array.from(this.extmarks.values());
  }
  getVirtual() {
    if (this.destroyed)
      return [];
    return Array.from(this.extmarks.values()).filter((e) => e.virtual);
  }
  getAtOffset(offset) {
    if (this.destroyed)
      return [];
    return Array.from(this.extmarks.values()).filter((e) => offset >= e.start && offset < e.end);
  }
  getAllForTypeId(typeId) {
    if (this.destroyed)
      return [];
    const ids = this.extmarksByTypeId.get(typeId);
    if (!ids)
      return [];
    return Array.from(ids).map((id) => this.extmarks.get(id)).filter((e) => e !== undefined);
  }
  clear() {
    if (this.destroyed)
      return;
    this.extmarks.clear();
    this.extmarksByTypeId.clear();
    this.metadata.clear();
    this.updateHighlights();
  }
  saveSnapshot() {
    this.history.saveSnapshot(this.extmarks, this.nextId);
  }
  restoreSnapshot(snapshot) {
    this.extmarks = new Map(Array.from(snapshot.extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }]));
    this.nextId = snapshot.nextId;
    this.updateHighlights();
  }
  wrapUndoRedo() {
    this.editBuffer.undo = () => {
      if (this.destroyed) {
        return this.originalUndo();
      }
      if (!this.history.canUndo()) {
        return this.originalUndo();
      }
      const currentSnapshot = {
        extmarks: new Map(Array.from(this.extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }])),
        nextId: this.nextId
      };
      this.history.pushRedo(currentSnapshot);
      const snapshot = this.history.undo();
      this.restoreSnapshot(snapshot);
      return this.originalUndo();
    };
    this.editBuffer.redo = () => {
      if (this.destroyed) {
        return this.originalRedo();
      }
      if (!this.history.canRedo()) {
        return this.originalRedo();
      }
      const currentSnapshot = {
        extmarks: new Map(Array.from(this.extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }])),
        nextId: this.nextId
      };
      this.history.pushUndo(currentSnapshot);
      const snapshot = this.history.redo();
      this.restoreSnapshot(snapshot);
      return this.originalRedo();
    };
  }
  registerType(typeName) {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed");
    }
    const existing = this.typeNameToId.get(typeName);
    if (existing !== undefined) {
      return existing;
    }
    const typeId = this.nextTypeId++;
    this.typeNameToId.set(typeName, typeId);
    this.typeIdToName.set(typeId, typeName);
    return typeId;
  }
  getTypeId(typeName) {
    if (this.destroyed)
      return null;
    return this.typeNameToId.get(typeName) ?? null;
  }
  getTypeName(typeId) {
    if (this.destroyed)
      return null;
    return this.typeIdToName.get(typeId) ?? null;
  }
  getMetadataFor(extmarkId) {
    if (this.destroyed)
      return;
    return this.metadata.get(extmarkId);
  }
  destroy() {
    if (this.destroyed)
      return;
    this.editBuffer.moveCursorLeft = this.originalMoveCursorLeft;
    this.editBuffer.moveCursorRight = this.originalMoveCursorRight;
    this.editBuffer.setCursorByOffset = this.originalSetCursorByOffset;
    this.editorView.moveUpVisual = this.originalMoveUpVisual;
    this.editorView.moveDownVisual = this.originalMoveDownVisual;
    this.editBuffer.deleteCharBackward = this.originalDeleteCharBackward;
    this.editBuffer.deleteChar = this.originalDeleteChar;
    this.editBuffer.insertText = this.originalInsertText;
    this.editBuffer.insertChar = this.originalInsertChar;
    this.editBuffer.deleteRange = this.originalDeleteRange;
    this.editBuffer.setText = this.originalSetText;
    this.editBuffer.replaceText = this.originalReplaceText;
    this.editBuffer.clear = this.originalClear;
    this.editBuffer.newLine = this.originalNewLine;
    this.editBuffer.deleteLine = this.originalDeleteLine;
    this.editorView.deleteSelectedText = this.originalEditorViewDeleteSelectedText;
    this.editBuffer.undo = this.originalUndo;
    this.editBuffer.redo = this.originalRedo;
    this.extmarks.clear();
    this.extmarksByTypeId.clear();
    this.metadata.clear();
    this.typeNameToId.clear();
    this.typeIdToName.clear();
    this.history.clear();
    this.destroyed = true;
  }
}
function createExtmarksController(editBuffer, editorView) {
  return new ExtmarksController(editBuffer, editorView);
}
// src/lib/terminal-palette.ts
var SYSTEM_CLOCK2 = new SystemClock;
registerEnvVar({
  name: "OTUI_PALETTE_IDLE_TIMEOUT_MS",
  description: "Milliseconds of silence after palette queries before using fallback colors.",
  type: "number",
  default: 300
});
var OSC4_RESPONSE = /\x1b]4;(\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g;
var OSC_SPECIAL_RESPONSE = /\x1b](\d+);(?:(?:rgb:)([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)|#([0-9a-fA-F]{6}))(?:\x07|\x1b\\)/g;
function scaleComponent(comp) {
  const val = parseInt(comp, 16);
  const maxIn = (1 << 4 * comp.length) - 1;
  return Math.round(val / maxIn * 255).toString(16).padStart(2, "0");
}
function toHex(r, g, b, hex6) {
  if (hex6)
    return `#${hex6.toLowerCase()}`;
  if (r && g && b)
    return `#${scaleComponent(r)}${scaleComponent(g)}${scaleComponent(b)}`;
  return "#000000";
}
function wrapForTmux(osc) {
  const escaped = osc.replace(/\x1b/g, "\x1B\x1B");
  return `\x1BPtmux;${escaped}\x1B\\`;
}

class TerminalPalette {
  stdin;
  stdout;
  writeFn;
  activeQuerySessions = [];
  inLegacyTmux;
  inTmux;
  oscSource;
  clock;
  constructor(options) {
    const { stdin, stdout, writeFn, isLegacyTmux, isTmux, oscSource, clock } = options;
    this.stdin = stdin;
    this.stdout = stdout;
    this.writeFn = writeFn || ((data) => stdout.write(data));
    this.inLegacyTmux = isLegacyTmux ?? false;
    this.inTmux = isTmux ?? this.inLegacyTmux;
    this.oscSource = oscSource;
    this.clock = clock ?? SYSTEM_CLOCK2;
  }
  writeOsc(osc, wrapForLegacyTmux = false) {
    const data = wrapForLegacyTmux && this.inLegacyTmux ? wrapForTmux(osc) : osc;
    return this.writeFn(data);
  }
  cleanup() {
    for (const cleanupSession of [...this.activeQuerySessions]) {
      cleanupSession();
    }
    this.activeQuerySessions = [];
  }
  subscribeInput(handler) {
    if (this.oscSource) {
      return this.oscSource.subscribeOsc((sequence) => {
        handler(sequence);
      });
    }
    this.stdin.on("data", handler);
    return () => {
      this.stdin.removeListener("data", handler);
    };
  }
  createQuerySession() {
    const timers = new Set;
    const subscriptions = new Set;
    let closed = false;
    const cleanup = () => {
      if (closed)
        return;
      closed = true;
      for (const timer of timers) {
        this.clock.clearTimeout(timer);
      }
      timers.clear();
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      subscriptions.clear();
      const idx = this.activeQuerySessions.indexOf(cleanup);
      if (idx !== -1)
        this.activeQuerySessions.splice(idx, 1);
    };
    this.activeQuerySessions.push(cleanup);
    return {
      setTimer: (fn, ms) => {
        const timer = this.clock.setTimeout(fn, ms);
        timers.add(timer);
        return timer;
      },
      resetTimer: (existing, fn, ms) => {
        if (existing) {
          this.clock.clearTimeout(existing);
          timers.delete(existing);
        }
        const timer = this.clock.setTimeout(fn, ms);
        timers.add(timer);
        return timer;
      },
      subscribeInput: (handler) => {
        const unsubscribe = this.subscribeInput(handler);
        subscriptions.add(unsubscribe);
        return () => {
          if (!subscriptions.has(unsubscribe))
            return;
          subscriptions.delete(unsubscribe);
          unsubscribe();
        };
      },
      cleanup
    };
  }
  async detectOSCSupport(timeoutMs = 300) {
    const out = this.stdout;
    if (!out.isTTY || !this.stdin.isTTY)
      return false;
    return new Promise((resolve3) => {
      const session = this.createQuerySession();
      let buffer = "";
      let settled = false;
      const finish = (supported) => {
        if (settled)
          return;
        settled = true;
        session.cleanup();
        resolve3(supported);
      };
      const onData = (chunk) => {
        buffer += chunk.toString();
        OSC4_RESPONSE.lastIndex = 0;
        if (OSC4_RESPONSE.test(buffer)) {
          finish(true);
        }
      };
      session.setTimer(() => {
        finish(false);
      }, timeoutMs);
      session.subscribeInput(onData);
      this.writeOsc("\x1B]4;0;?\x07", true);
    });
  }
  async queryPalette(indices, timeoutMs = 1200, idleTimeoutMs = env.OTUI_PALETTE_IDLE_TIMEOUT_MS) {
    const out = this.stdout;
    const results = new Map;
    indices.forEach((i) => results.set(i, null));
    if (!out.isTTY || !this.stdin.isTTY) {
      return results;
    }
    return new Promise((resolve3) => {
      const session = this.createQuerySession();
      let buffer = "";
      let idleTimer = null;
      let settled = false;
      const finish = () => {
        if (settled)
          return;
        settled = true;
        session.cleanup();
        resolve3(results);
      };
      const onData = (chunk) => {
        buffer += chunk.toString();
        let m;
        OSC4_RESPONSE.lastIndex = 0;
        while (m = OSC4_RESPONSE.exec(buffer)) {
          const idx = parseInt(m[1], 10);
          if (results.has(idx))
            results.set(idx, toHex(m[2], m[3], m[4], m[5]));
        }
        if (buffer.length > 8192)
          buffer = buffer.slice(-4096);
        const done = [...results.values()].filter((v) => v !== null).length;
        if (done === results.size) {
          finish();
          return;
        }
        idleTimer = session.resetTimer(idleTimer, finish, idleTimeoutMs);
      };
      session.setTimer(finish, timeoutMs);
      session.subscribeInput(onData);
      this.writeOsc(indices.map((i) => `\x1B]4;${i};?\x07`).join(""), true);
      idleTimer = session.resetTimer(idleTimer, finish, idleTimeoutMs);
    });
  }
  async querySpecialColors(timeoutMs = 1200, idleTimeoutMs = env.OTUI_PALETTE_IDLE_TIMEOUT_MS) {
    const out = this.stdout;
    const results = {
      10: null,
      11: null,
      12: null,
      13: null,
      14: null,
      15: null,
      16: null,
      17: null,
      19: null
    };
    const queries = this.inTmux ? [10, 11, 12] : [10, 11, 12, 13, 14, 15, 16, 17, 19];
    if (!out.isTTY || !this.stdin.isTTY) {
      return results;
    }
    return new Promise((resolve3) => {
      const session = this.createQuerySession();
      let buffer = "";
      let idleTimer = null;
      let settled = false;
      const finish = () => {
        if (settled)
          return;
        settled = true;
        session.cleanup();
        resolve3(results);
      };
      const onData = (chunk) => {
        buffer += chunk.toString();
        let updated = false;
        let m;
        OSC_SPECIAL_RESPONSE.lastIndex = 0;
        while (m = OSC_SPECIAL_RESPONSE.exec(buffer)) {
          const idx = parseInt(m[1], 10);
          if (idx in results) {
            results[idx] = toHex(m[2], m[3], m[4], m[5]);
            updated = true;
          }
        }
        if (buffer.length > 8192)
          buffer = buffer.slice(-4096);
        if (queries.every((idx) => results[idx] !== null)) {
          finish();
          return;
        }
        if (!updated)
          return;
        idleTimer = session.resetTimer(idleTimer, finish, idleTimeoutMs);
      };
      session.setTimer(finish, timeoutMs);
      session.subscribeInput(onData);
      this.writeOsc(queries.map((idx) => `\x1B]${idx};?\x07`).join(""));
      idleTimer = session.resetTimer(idleTimer, finish, idleTimeoutMs);
    });
  }
  async detect(options) {
    const { timeout = 5000, size = 16 } = options || {};
    const supported = await this.detectOSCSupport();
    if (!supported) {
      return {
        palette: Array(size).fill(null),
        defaultForeground: null,
        defaultBackground: null,
        cursorColor: null,
        mouseForeground: null,
        mouseBackground: null,
        tekForeground: null,
        tekBackground: null,
        highlightBackground: null,
        highlightForeground: null
      };
    }
    const indicesToQuery = [...Array(size).keys()];
    const idleTimeout = env.OTUI_PALETTE_IDLE_TIMEOUT_MS;
    const [paletteResults, specialColors] = await Promise.all([
      this.queryPalette(indicesToQuery, timeout, idleTimeout),
      this.querySpecialColors(timeout, idleTimeout)
    ]);
    return {
      palette: [...Array(size).keys()].map((i) => paletteResults.get(i) ?? null),
      defaultForeground: specialColors[10],
      defaultBackground: specialColors[11],
      cursorColor: specialColors[12],
      mouseForeground: specialColors[13],
      mouseBackground: specialColors[14],
      tekForeground: specialColors[15],
      tekBackground: specialColors[16],
      highlightBackground: specialColors[17],
      highlightForeground: specialColors[19]
    };
  }
}
function createTerminalPalette(options) {
  return new TerminalPalette(options);
}
var DEFAULT_FOREGROUND_FALLBACK = RGBA.fromInts(...DEFAULT_FOREGROUND_RGB);
var DEFAULT_BACKGROUND_FALLBACK = RGBA.fromInts(...DEFAULT_BACKGROUND_RGB);
var fallbackAnsi256Palette = null;
function getFallbackAnsi256Palette() {
  if (!fallbackAnsi256Palette) {
    fallbackAnsi256Palette = Array.from({ length: 256 }, (_, index) => {
      const [r, g, b] = ansi256IndexToRgb(index);
      return RGBA.fromInts(r, g, b);
    });
  }
  return fallbackAnsi256Palette;
}
function normalizeTerminalPalette(colors) {
  const fallbackPalette = getFallbackAnsi256Palette();
  return {
    palette: Array.from({ length: 256 }, (_, index) => {
      const detected = colors?.palette[index];
      return detected ? RGBA.fromHex(detected) : RGBA.clone(fallbackPalette[index]);
    }),
    defaultForeground: colors?.defaultForeground ? RGBA.fromHex(colors.defaultForeground) : RGBA.clone(DEFAULT_FOREGROUND_FALLBACK),
    defaultBackground: colors?.defaultBackground ? RGBA.fromHex(colors.defaultBackground) : RGBA.clone(DEFAULT_BACKGROUND_FALLBACK)
  };
}
function buildTerminalPaletteSignature(colors) {
  const normalized = normalizeTerminalPalette(colors);
  const paletteSignature = normalized.palette.map((color) => color.toInts().join(",")).join(";");
  return [
    paletteSignature,
    normalized.defaultForeground.toInts().join(","),
    normalized.defaultBackground.toInts().join(",")
  ].join("|");
}
// src/lib/paste.ts
var PASTE_TEXT_DECODER = new TextDecoder;
function decodePasteBytes(bytes) {
  return PASTE_TEXT_DECODER.decode(bytes);
}
function stripAnsiSequences(text) {
  return stripANSI(text);
}
// src/lib/clipboard.ts
var ClipboardTarget;
((ClipboardTarget2) => {
  ClipboardTarget2[ClipboardTarget2["Clipboard"] = 0] = "Clipboard";
  ClipboardTarget2[ClipboardTarget2["Primary"] = 1] = "Primary";
  ClipboardTarget2[ClipboardTarget2["Select"] = 2] = "Select";
  ClipboardTarget2[ClipboardTarget2["Secondary"] = 3] = "Secondary";
})(ClipboardTarget ||= {});

class Clipboard {
  lib;
  rendererPtr;
  constructor(lib, rendererPtr) {
    this.lib = lib;
    this.rendererPtr = rendererPtr;
  }
  copyToClipboardOSC52(text, target = 0 /* Clipboard */) {
    if (!this.isOsc52Supported()) {
      return false;
    }
    const textUtf8 = this.lib.encoder.encode(text);
    return this.lib.copyToClipboardOSC52(this.rendererPtr, target, textUtf8);
  }
  clearClipboardOSC52(target = 0 /* Clipboard */) {
    if (!this.isOsc52Supported()) {
      return false;
    }
    return this.lib.clearClipboardOSC52(this.rendererPtr, target);
  }
  isOsc52Supported() {
    const caps = this.lib.getTerminalCapabilities(this.rendererPtr);
    return caps?.osc52_support !== "unsupported";
  }
}
// src/lib/detect-links.ts
var URL_SCOPES = ["markup.link.url", "string.special.url"];
function detectLinks(chunks, context) {
  const content = context.content;
  const highlights = context.highlights;
  const ranges = [];
  for (let i = 0;i < highlights.length; i++) {
    const [start, end, group] = highlights[i];
    if (!URL_SCOPES.includes(group))
      continue;
    const url = content.slice(start, end);
    ranges.push({ start, end, url });
    for (let j = i - 1;j >= 0; j--) {
      const [labelStart, labelEnd, prev] = highlights[j];
      if (prev === "markup.link.label") {
        ranges.push({ start: labelStart, end: labelEnd, url });
        break;
      }
      if (!prev.startsWith("markup.link"))
        break;
    }
  }
  if (ranges.length === 0)
    return chunks;
  let contentPos = 0;
  for (const chunk of chunks) {
    if (chunk.text.length <= 1)
      continue;
    const idx = content.indexOf(chunk.text, contentPos);
    if (idx < 0)
      continue;
    for (const range of ranges) {
      if (idx < range.end && idx + chunk.text.length > range.start) {
        chunk.link = { url: range.url };
        break;
      }
    }
    contentPos = idx + chunk.text.length;
  }
  return chunks;
}
// src/buffer.ts
function packDrawOptions(border2, shouldFill, titleAlignment, bottomTitleAlignment) {
  let packed = 0;
  if (border2 === true) {
    packed |= 15;
  } else if (Array.isArray(border2)) {
    if (border2.includes("top"))
      packed |= 8;
    if (border2.includes("right"))
      packed |= 4;
    if (border2.includes("bottom"))
      packed |= 2;
    if (border2.includes("left"))
      packed |= 1;
  }
  if (shouldFill) {
    packed |= 1 << 4;
  }
  const alignmentMap = {
    left: 0,
    center: 1,
    right: 2
  };
  const alignment = alignmentMap[titleAlignment];
  const bottomAlignment = alignmentMap[bottomTitleAlignment];
  packed |= alignment << 5;
  packed |= bottomAlignment << 7;
  return packed;
}

class OptimizedBuffer {
  static fbIdCounter = 0;
  id;
  lib;
  bufferPtr;
  _width;
  _height;
  _widthMethod;
  respectAlpha = false;
  _rawBuffers = null;
  _destroyed = false;
  get ptr() {
    return this.bufferPtr;
  }
  guard() {
    if (this._destroyed)
      throw new Error(`Buffer ${this.id} is destroyed`);
  }
  ensureRawBufferViews() {
    if (this._rawBuffers !== null) {
      return;
    }
    const size = this._width * this._height;
    const charPtr = this.lib.bufferGetCharPtr(this.bufferPtr);
    const fgPtr = this.lib.bufferGetFgPtr(this.bufferPtr);
    const bgPtr = this.lib.bufferGetBgPtr(this.bufferPtr);
    const attributesPtr = this.lib.bufferGetAttributesPtr(this.bufferPtr);
    this._rawBuffers = {
      char: new Uint32Array(toArrayBuffer(charPtr, 0, size * 4)),
      fg: new Uint16Array(toArrayBuffer(fgPtr, 0, size * 4 * 2)),
      bg: new Uint16Array(toArrayBuffer(bgPtr, 0, size * 4 * 2)),
      attributes: new Uint32Array(toArrayBuffer(attributesPtr, 0, size * 4))
    };
  }
  get buffers() {
    this.guard();
    this.ensureRawBufferViews();
    return this._rawBuffers;
  }
  constructor(lib, ptr2, width, height, options) {
    this.id = options.id || `fb_${OptimizedBuffer.fbIdCounter++}`;
    this.lib = lib;
    this.respectAlpha = options.respectAlpha || false;
    this._width = width;
    this._height = height;
    this._widthMethod = options.widthMethod || "unicode";
    this.bufferPtr = ptr2;
  }
  static create(width, height, widthMethod, options = {}) {
    const lib = resolveRenderLib();
    const respectAlpha = options.respectAlpha || false;
    const id = options.id && options.id.trim() !== "" ? options.id : "unnamed buffer";
    const buffer = lib.createOptimizedBuffer(width, height, widthMethod, respectAlpha, id);
    return buffer;
  }
  get widthMethod() {
    return this._widthMethod;
  }
  get width() {
    return this._width;
  }
  get height() {
    return this._height;
  }
  setRespectAlpha(respectAlpha) {
    this.guard();
    this.lib.bufferSetRespectAlpha(this.bufferPtr, respectAlpha);
    this.respectAlpha = respectAlpha;
  }
  getNativeId() {
    this.guard();
    return this.lib.bufferGetId(this.bufferPtr);
  }
  getRealCharBytes(addLineBreaks = false) {
    this.guard();
    const realSize = this.lib.bufferGetRealCharSize(this.bufferPtr);
    const outputBuffer = new Uint8Array(realSize);
    const bytesWritten = this.lib.bufferWriteResolvedChars(this.bufferPtr, outputBuffer, addLineBreaks);
    return outputBuffer.slice(0, bytesWritten);
  }
  getSpanLines() {
    this.guard();
    const { char, fg: fg2, bg: bg2, attributes } = this.buffers;
    const lines = [];
    const CHAR_FLAG_CONTINUATION = 3221225472 | 0;
    const CHAR_FLAG_MASK = 3221225472 | 0;
    const realTextBytes = this.getRealCharBytes(true);
    const realTextLines = new TextDecoder().decode(realTextBytes).split(`
`);
    for (let y = 0;y < this._height; y++) {
      const spans = [];
      let currentSpan = null;
      const lineChars = [...realTextLines[y] || ""];
      let charIdx = 0;
      for (let x = 0;x < this._width; x++) {
        const i = y * this._width + x;
        const cp = char[i];
        const cellFg = RGBA.fromArray(fg2.slice(i * 4, i * 4 + 4));
        const cellBg = RGBA.fromArray(bg2.slice(i * 4, i * 4 + 4));
        const cellAttrs = attributes[i] & 255;
        const isContinuation = (cp & CHAR_FLAG_MASK) === CHAR_FLAG_CONTINUATION;
        const cellChar = isContinuation ? "" : lineChars[charIdx++] ?? " ";
        if (currentSpan && currentSpan.fg.equals(cellFg) && currentSpan.bg.equals(cellBg) && currentSpan.attributes === cellAttrs) {
          currentSpan.text += cellChar;
          currentSpan.width += 1;
        } else {
          if (currentSpan) {
            spans.push(currentSpan);
          }
          currentSpan = {
            text: cellChar,
            fg: cellFg,
            bg: cellBg,
            attributes: cellAttrs,
            width: 1
          };
        }
      }
      if (currentSpan) {
        spans.push(currentSpan);
      }
      lines.push({ spans });
    }
    return lines;
  }
  clear(bg2 = RGBA.fromValues(0, 0, 0, 1)) {
    this.guard();
    this.lib.bufferClear(this.bufferPtr, bg2);
  }
  setCell(x, y, char, fg2, bg2, attributes = 0) {
    this.guard();
    this.lib.bufferSetCell(this.bufferPtr, x, y, char, fg2, bg2, attributes);
  }
  setCellWithAlphaBlending(x, y, char, fg2, bg2, attributes = 0) {
    this.guard();
    this.lib.bufferSetCellWithAlphaBlending(this.bufferPtr, x, y, char, fg2, bg2, attributes);
  }
  drawText(text, x, y, fg2, bg2, attributes = 0, selection2) {
    this.guard();
    if (!selection2) {
      this.lib.bufferDrawText(this.bufferPtr, text, x, y, fg2, bg2, attributes);
      return;
    }
    const { start, end } = selection2;
    let selectionBg;
    let selectionFg;
    if (selection2.bgColor) {
      selectionBg = selection2.bgColor;
      selectionFg = selection2.fgColor || fg2;
    } else {
      const defaultBg = bg2 || RGBA.fromValues(0, 0, 0, 0);
      selectionFg = defaultBg.a > 0 ? defaultBg : RGBA.fromValues(0, 0, 0, 1);
      selectionBg = fg2;
    }
    if (start > 0) {
      const beforeText = text.slice(0, start);
      this.lib.bufferDrawText(this.bufferPtr, beforeText, x, y, fg2, bg2, attributes);
    }
    if (end > start) {
      const selectedText = text.slice(start, end);
      this.lib.bufferDrawText(this.bufferPtr, selectedText, x + start, y, selectionFg, selectionBg, attributes);
    }
    if (end < text.length) {
      const afterText = text.slice(end);
      this.lib.bufferDrawText(this.bufferPtr, afterText, x + end, y, fg2, bg2, attributes);
    }
  }
  fillRect(x, y, width, height, bg2) {
    this.guard();
    this.lib.bufferFillRect(this.bufferPtr, x, y, width, height, bg2);
  }
  colorMatrix(matrix, cellMask, strength = 1, target = 3 /* Both */) {
    this.guard();
    if (matrix.length !== 16)
      throw new RangeError(`colorMatrix matrix must have length 16, got ${matrix.length}`);
    const cellMaskCount = Math.floor(cellMask.length / 3);
    this.lib.bufferColorMatrix(this.bufferPtr, ptr(matrix), ptr(cellMask), cellMaskCount, strength, target);
  }
  colorMatrixUniform(matrix, strength = 1, target = 3 /* Both */) {
    this.guard();
    if (matrix.length !== 16)
      throw new RangeError(`colorMatrixUniform matrix must have length 16, got ${matrix.length}`);
    if (strength === 0)
      return;
    this.lib.bufferColorMatrixUniform(this.bufferPtr, ptr(matrix), strength, target);
  }
  drawFrameBuffer(destX, destY, frameBuffer, sourceX, sourceY, sourceWidth, sourceHeight) {
    this.guard();
    this.lib.drawFrameBuffer(this.bufferPtr, destX, destY, frameBuffer.ptr, sourceX, sourceY, sourceWidth, sourceHeight);
  }
  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this._rawBuffers = null;
    this.lib.destroyOptimizedBuffer(this.bufferPtr);
  }
  drawTextBuffer(textBufferView, x, y) {
    this.guard();
    this.lib.bufferDrawTextBufferView(this.bufferPtr, textBufferView.ptr, x, y);
  }
  drawEditorView(editorView, x, y) {
    this.guard();
    this.lib.bufferDrawEditorView(this.bufferPtr, editorView.ptr, x, y);
  }
  drawSuperSampleBuffer(x, y, pixelDataPtr, pixelDataLength, format, alignedBytesPerRow) {
    this.guard();
    this.lib.bufferDrawSuperSampleBuffer(this.bufferPtr, x, y, toPointer(pixelDataPtr), pixelDataLength, format, alignedBytesPerRow);
  }
  drawPackedBuffer(dataPtr, dataLen, posX, posY, terminalWidthCells, terminalHeightCells) {
    this.guard();
    this.lib.bufferDrawPackedBuffer(this.bufferPtr, toPointer(dataPtr), dataLen, posX, posY, terminalWidthCells, terminalHeightCells);
  }
  drawGrayscaleBuffer(posX, posY, intensities, srcWidth, srcHeight, fg2 = null, bg2 = null) {
    this.guard();
    this.lib.bufferDrawGrayscaleBuffer(this.bufferPtr, posX, posY, ptr(intensities), srcWidth, srcHeight, fg2, bg2);
  }
  drawGrayscaleBufferSupersampled(posX, posY, intensities, srcWidth, srcHeight, fg2 = null, bg2 = null) {
    this.guard();
    this.lib.bufferDrawGrayscaleBufferSupersampled(this.bufferPtr, posX, posY, ptr(intensities), srcWidth, srcHeight, fg2, bg2);
  }
  resize(width, height) {
    this.guard();
    if (this._width === width && this._height === height)
      return;
    this._width = width;
    this._height = height;
    this._rawBuffers = null;
    this.lib.bufferResize(this.bufferPtr, width, height);
  }
  drawBox(options) {
    this.guard();
    const style = parseBorderStyle(options.borderStyle, "single");
    const borderChars = options.customBorderChars ?? BorderCharArrays[style];
    const packedOptions = packDrawOptions(options.border, options.shouldFill ?? false, options.titleAlignment || "left", options.bottomTitleAlignment || "left");
    this.lib.bufferDrawBox(this.bufferPtr, options.x, options.y, options.width, options.height, borderChars, packedOptions, options.borderColor, options.backgroundColor, options.titleColor ?? options.borderColor, options.title ?? null, options.bottomTitle ?? null);
  }
  pushScissorRect(x, y, width, height) {
    this.guard();
    this.lib.bufferPushScissorRect(this.bufferPtr, x, y, width, height);
  }
  popScissorRect() {
    this.guard();
    this.lib.bufferPopScissorRect(this.bufferPtr);
  }
  clearScissorRects() {
    this.guard();
    this.lib.bufferClearScissorRects(this.bufferPtr);
  }
  pushOpacity(opacity) {
    this.guard();
    this.lib.bufferPushOpacity(this.bufferPtr, Math.max(0, Math.min(1, opacity)));
  }
  popOpacity() {
    this.guard();
    this.lib.bufferPopOpacity(this.bufferPtr);
  }
  getCurrentOpacity() {
    this.guard();
    return this.lib.bufferGetCurrentOpacity(this.bufferPtr);
  }
  clearOpacity() {
    this.guard();
    this.lib.bufferClearOpacity(this.bufferPtr);
  }
  encodeUnicode(text) {
    this.guard();
    return this.lib.encodeUnicode(text, this._widthMethod);
  }
  freeUnicode(encoded) {
    this.guard();
    this.lib.freeUnicode(encoded);
  }
  drawGrid(options) {
    this.guard();
    const columnCount = Math.max(0, options.columnOffsets.length - 1);
    const rowCount = Math.max(0, options.rowOffsets.length - 1);
    this.lib.bufferDrawGrid(this.bufferPtr, options.borderChars, options.borderFg, options.borderBg, options.columnOffsets, columnCount, options.rowOffsets, rowCount, {
      drawInner: options.drawInner,
      drawOuter: options.drawOuter
    });
  }
  drawChar(char, x, y, fg2, bg2, attributes = 0) {
    this.guard();
    this.lib.bufferDrawChar(this.bufferPtr, char, x, y, fg2, bg2, attributes);
  }
}

// src/text-buffer.ts
class TextBuffer {
  lib;
  bufferPtr;
  _length = 0;
  _byteSize = 0;
  _lineInfo;
  _destroyed = false;
  _syntaxStyle;
  _textBytes;
  _memId;
  _appendedChunks = [];
  constructor(lib, ptr2) {
    this.lib = lib;
    this.bufferPtr = ptr2;
  }
  static create(widthMethod) {
    const lib = resolveRenderLib();
    return lib.createTextBuffer(widthMethod);
  }
  guard() {
    if (this._destroyed)
      throw new Error("TextBuffer is destroyed");
  }
  setText(text) {
    this.guard();
    this._textBytes = this.lib.encoder.encode(text);
    if (this._memId === undefined) {
      this._memId = this.lib.textBufferRegisterMemBuffer(this.bufferPtr, this._textBytes, false);
    } else if (!this.lib.textBufferReplaceMemBuffer(this.bufferPtr, this._memId, this._textBytes, false)) {
      this._memId = this.lib.textBufferRegisterMemBuffer(this.bufferPtr, this._textBytes, false);
    }
    this.lib.textBufferSetTextFromMem(this.bufferPtr, this._memId);
    this._length = this.lib.textBufferGetLength(this.bufferPtr);
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr);
    this._lineInfo = undefined;
    this._appendedChunks = [];
  }
  append(text) {
    this.guard();
    const textBytes = this.lib.encoder.encode(text);
    this._appendedChunks.push(textBytes);
    this.lib.textBufferAppend(this.bufferPtr, textBytes);
    this._length = this.lib.textBufferGetLength(this.bufferPtr);
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr);
    this._lineInfo = undefined;
  }
  loadFile(path3) {
    this.guard();
    const success = this.lib.textBufferLoadFile(this.bufferPtr, path3);
    if (!success) {
      throw new Error(`Failed to load file: ${path3}`);
    }
    this._length = this.lib.textBufferGetLength(this.bufferPtr);
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr);
    this._lineInfo = undefined;
    this._textBytes = undefined;
  }
  setStyledText(text) {
    this.guard();
    this.lib.textBufferSetStyledText(this.bufferPtr, text.chunks);
    this._length = this.lib.textBufferGetLength(this.bufferPtr);
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr);
    this._lineInfo = undefined;
  }
  setDefaultFg(fg2) {
    this.guard();
    this.lib.textBufferSetDefaultFg(this.bufferPtr, fg2);
  }
  setDefaultBg(bg2) {
    this.guard();
    this.lib.textBufferSetDefaultBg(this.bufferPtr, bg2);
  }
  setDefaultAttributes(attributes) {
    this.guard();
    this.lib.textBufferSetDefaultAttributes(this.bufferPtr, attributes);
  }
  resetDefaults() {
    this.guard();
    this.lib.textBufferResetDefaults(this.bufferPtr);
  }
  getLineCount() {
    this.guard();
    return this.lib.textBufferGetLineCount(this.bufferPtr);
  }
  get length() {
    this.guard();
    return this._length;
  }
  get byteSize() {
    this.guard();
    return this._byteSize;
  }
  get ptr() {
    this.guard();
    return this.bufferPtr;
  }
  getPlainText() {
    this.guard();
    if (this._byteSize === 0)
      return "";
    const plainBytes = this.lib.getPlainTextBytes(this.bufferPtr, this._byteSize);
    if (!plainBytes)
      return "";
    return this.lib.decoder.decode(plainBytes);
  }
  getTextRange(startOffset, endOffset) {
    this.guard();
    if (startOffset >= endOffset)
      return "";
    if (this._byteSize === 0)
      return "";
    const rangeBytes = this.lib.textBufferGetTextRange(this.bufferPtr, startOffset, endOffset, this._byteSize);
    if (!rangeBytes)
      return "";
    return this.lib.decoder.decode(rangeBytes);
  }
  addHighlightByCharRange(highlight) {
    this.guard();
    this.lib.textBufferAddHighlightByCharRange(this.bufferPtr, highlight);
  }
  addHighlight(lineIdx, highlight) {
    this.guard();
    this.lib.textBufferAddHighlight(this.bufferPtr, lineIdx, highlight);
  }
  removeHighlightsByRef(hlRef) {
    this.guard();
    this.lib.textBufferRemoveHighlightsByRef(this.bufferPtr, hlRef);
  }
  clearLineHighlights(lineIdx) {
    this.guard();
    this.lib.textBufferClearLineHighlights(this.bufferPtr, lineIdx);
  }
  clearAllHighlights() {
    this.guard();
    this.lib.textBufferClearAllHighlights(this.bufferPtr);
  }
  getLineHighlights(lineIdx) {
    this.guard();
    return this.lib.textBufferGetLineHighlights(this.bufferPtr, lineIdx);
  }
  getHighlightCount() {
    this.guard();
    return this.lib.textBufferGetHighlightCount(this.bufferPtr);
  }
  setSyntaxStyle(style) {
    this.guard();
    if (this.lib.textBufferSetSyntaxStyle(this.bufferPtr, style?.ptr ?? null)) {
      this._syntaxStyle = style ?? undefined;
    }
  }
  getSyntaxStyle() {
    this.guard();
    return this._syntaxStyle ?? null;
  }
  setTabWidth(width) {
    this.guard();
    this.lib.textBufferSetTabWidth(this.bufferPtr, width);
  }
  getTabWidth() {
    this.guard();
    return this.lib.textBufferGetTabWidth(this.bufferPtr);
  }
  clear() {
    this.guard();
    this.lib.textBufferClear(this.bufferPtr);
    this._length = 0;
    this._byteSize = 0;
    this._lineInfo = undefined;
    this._textBytes = undefined;
    this._appendedChunks = [];
  }
  reset() {
    this.guard();
    this.lib.textBufferReset(this.bufferPtr);
    this._length = 0;
    this._byteSize = 0;
    this._lineInfo = undefined;
    this._textBytes = undefined;
    this._memId = undefined;
    this._appendedChunks = [];
  }
  destroy() {
    if (this._destroyed)
      return;
    this._destroyed = true;
    this.lib.destroyTextBuffer(this.bufferPtr);
  }
}

// ../../node_modules/.bun/bun-ffi-structs@0.2.4+1fb4c65d43e298b9/node_modules/bun-ffi-structs/dist/index.js
var FFI_LOAD_ERROR = "bun-ffi-structs requires Bun or Node.js with node:ffi enabled (--experimental-ffi --allow-ffi).";
var backend2 = await loadBackend2();
function unavailable2(cause) {
  throw new Error(FFI_LOAD_ERROR, {
    cause: cause instanceof Error ? cause : undefined
  });
}
function createUnsupportedBackend2(cause) {
  return {
    ptr() {
      return unavailable2(cause);
    },
    toArrayBuffer() {
      return unavailable2(cause);
    }
  };
}
async function loadBackend2() {
  if (typeof process !== "undefined" && "bun" in process.versions) {
    return createBunBackend2(await importModule("bun:ffi"));
  }
  try {
    return createNodeBackend2(await importModule("node:ffi"));
  } catch (error) {
    return createUnsupportedBackend2(error);
  }
}
function importModule(specifier) {
  return import(specifier).then((module) => module.default ?? module);
}
function createBunBackend2(bun2) {
  return {
    ptr: bun2.ptr,
    toArrayBuffer(pointer, offset, length) {
      return bun2.toArrayBuffer(toBunPointer2(pointer), offset, length);
    }
  };
}
function createNodeBackend2(nodeFfi) {
  return {
    ptr(value) {
      if (ArrayBuffer.isView(value)) {
        return nodeFfi.getRawPointer(value.buffer) + BigInt(value.byteOffset);
      }
      if (value instanceof ArrayBuffer) {
        return nodeFfi.getRawPointer(value);
      }
      throw new TypeError("node:ffi ptr() only supports ArrayBuffer and ArrayBufferView values.");
    },
    toArrayBuffer(pointer, offset, length) {
      return nodeFfi.toArrayBuffer(toBigIntPointer2(pointer) + BigInt(offset ?? 0), length, false);
    }
  };
}
function toBigIntPointer2(pointer) {
  return typeof pointer === "bigint" ? pointer : BigInt(pointer);
}
function toBunPointer2(pointer) {
  return typeof pointer === "bigint" ? Number(pointer) : pointer;
}
var ptr2 = backend2.ptr;
var toArrayBuffer2 = backend2.toArrayBuffer;
function fatalError(...args) {
  const message = args.join(" ");
  console.error("FATAL ERROR:", message);
  throw new Error(message);
}
var pointerSize = process.arch === "x64" || process.arch === "arm64" ? 8 : 4;
var isBun2 = typeof process !== "undefined" && "bun" in process.versions;
var typeSizes = {
  u8: 1,
  bool_u8: 1,
  bool_u32: 4,
  u16: 2,
  i16: 2,
  u32: 4,
  u64: 8,
  f32: 4,
  f64: 8,
  pointer: pointerSize,
  i32: 4,
  i64: 8
};
var primitiveKeys = Object.keys(typeSizes);
function isPrimitiveType(type) {
  return typeof type === "string" && primitiveKeys.includes(type);
}
var typeAlignments = { ...typeSizes };
var typeGetters = {
  u8: (view, offset) => view.getUint8(offset),
  bool_u8: (view, offset) => Boolean(view.getUint8(offset)),
  bool_u32: (view, offset) => Boolean(view.getUint32(offset, true)),
  u16: (view, offset) => view.getUint16(offset, true),
  i16: (view, offset) => view.getInt16(offset, true),
  u32: (view, offset) => view.getUint32(offset, true),
  u64: (view, offset) => view.getBigUint64(offset, true),
  f32: (view, offset) => view.getFloat32(offset, true),
  f64: (view, offset) => view.getFloat64(offset, true),
  i32: (view, offset) => view.getInt32(offset, true),
  i64: (view, offset) => view.getBigInt64(offset, true),
  pointer: (view, offset) => pointerSize === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true))
};
function isObjectPointerDef(type) {
  return typeof type === "object" && type !== null && type.__type === "objectPointer";
}
function alignOffset(offset, align) {
  return offset + (align - 1) & ~(align - 1);
}
function enumTypeError(value) {
  throw new TypeError(`Invalid enum value: ${value}`);
}
function defineEnum(mapping, base = "u32") {
  const reverse2 = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]));
  return {
    __type: "enum",
    type: base,
    to(value) {
      return typeof value === "number" ? value : mapping[value] ?? enumTypeError(String(value));
    },
    from(value) {
      return reverse2[value] ?? enumTypeError(String(value));
    },
    enum: mapping
  };
}
function isEnum(type) {
  return typeof type === "object" && type.__type === "enum";
}
function isStruct(type) {
  return typeof type === "object" && type.__type === "struct";
}
function primitivePackers(type) {
  let pack;
  let unpack;
  switch (type) {
    case "u8":
      pack = (view, off, val) => view.setUint8(off, val);
      unpack = (view, off) => view.getUint8(off);
      break;
    case "bool_u8":
      pack = (view, off, val) => view.setUint8(off, val ? 1 : 0);
      unpack = (view, off) => Boolean(view.getUint8(off));
      break;
    case "bool_u32":
      pack = (view, off, val) => view.setUint32(off, val ? 1 : 0, true);
      unpack = (view, off) => Boolean(view.getUint32(off, true));
      break;
    case "u16":
      pack = (view, off, val) => view.setUint16(off, val, true);
      unpack = (view, off) => view.getUint16(off, true);
      break;
    case "i16":
      pack = (view, off, val) => view.setInt16(off, val, true);
      unpack = (view, off) => view.getInt16(off, true);
      break;
    case "u32":
      pack = (view, off, val) => view.setUint32(off, val, true);
      unpack = (view, off) => view.getUint32(off, true);
      break;
    case "i32":
      pack = (view, off, val) => view.setInt32(off, val, true);
      unpack = (view, off) => view.getInt32(off, true);
      break;
    case "i64":
      pack = (view, off, val) => view.setBigInt64(off, BigInt(val), true);
      unpack = (view, off) => view.getBigInt64(off, true);
      break;
    case "u64":
      pack = (view, off, val) => view.setBigUint64(off, BigInt(val), true);
      unpack = (view, off) => view.getBigUint64(off, true);
      break;
    case "f32":
      pack = (view, off, val) => view.setFloat32(off, val, true);
      unpack = (view, off) => view.getFloat32(off, true);
      break;
    case "f64":
      pack = (view, off, val) => view.setFloat64(off, val, true);
      unpack = (view, off) => view.getFloat64(off, true);
      break;
    case "pointer":
      pack = (view, off, val) => {
        pointerSize === 8 ? view.setBigUint64(off, val ? BigInt(val) : 0n, true) : view.setUint32(off, val ? Number(val) : 0, true);
      };
      unpack = (view, off) => {
        if (pointerSize === 8) {
          const value = view.getBigUint64(off, true);
          return isBun2 ? Number(value) : value;
        }
        return view.getUint32(off, true);
      };
      break;
    default:
      fatalError(`Unsupported primitive type: ${type}`);
  }
  return { pack, unpack };
}
var { pack: pointerPacker, unpack: pointerUnpacker } = primitivePackers("pointer");
var retainedPointerTargets = new WeakMap;
function retainPointerTarget(owner, target) {
  const retained = retainedPointerTargets.get(owner);
  if (retained) {
    retained.push(target);
  } else {
    retainedPointerTargets.set(owner, [target]);
  }
}
function retainIfPointerTargets(owner, target) {
  if (retainedPointerTargets.has(target)) {
    retainPointerTarget(owner, target);
  }
}
function isNullPointer(pointer) {
  return pointer == null || pointer === 0 || pointer === 0n;
}
function toItemCount(length) {
  return typeof length === "bigint" ? Number(length) : length;
}
function packObjectArray(val) {
  const buffer = new ArrayBuffer(val.length * pointerSize);
  const bufferView = new DataView(buffer);
  for (let i = 0;i < val.length; i++) {
    const instance = val[i];
    const ptrValue = instance?.ptr ?? null;
    pointerPacker(bufferView, i * pointerSize, ptrValue);
  }
  return bufferView;
}
var encoder = new TextEncoder;
var decoder = new TextDecoder;
function defineStruct(fields, structDefOptions) {
  let offset = 0;
  let maxAlign = 1;
  const layout = [];
  const lengthOfFields = {};
  const lengthOfRequested = [];
  const arrayFieldsMetadata = {};
  for (const [name, typeOrStruct, options = {}] of fields) {
    if (options.condition && !options.condition()) {
      continue;
    }
    let size = 0, align = 0;
    let pack;
    let unpack;
    let needsLengthOf = false;
    let lengthOfDef = null;
    if (isPrimitiveType(typeOrStruct)) {
      size = typeSizes[typeOrStruct];
      align = typeAlignments[typeOrStruct];
      ({ pack, unpack } = primitivePackers(typeOrStruct));
      if (typeOrStruct === "pointer") {
        pack = (view, off, val) => {
          if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
            if (val.byteLength === 0) {
              pointerPacker(view, off, null);
              return;
            }
            pointerPacker(view, off, ptr2(val));
            retainPointerTarget(view.buffer, val);
            return;
          }
          pointerPacker(view, off, val);
        };
      }
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "cstring") {
      size = pointerSize;
      align = pointerSize;
      pack = (view, off, val) => {
        if (!val) {
          pointerPacker(view, off, null);
          return;
        }
        const bytes = encoder.encode(val + "\x00");
        const bufPtr = ptr2(bytes);
        pointerPacker(view, off, bufPtr);
        retainPointerTarget(view.buffer, bytes);
      };
      unpack = (view, off) => {
        const ptrVal = pointerUnpacker(view, off);
        return ptrVal;
      };
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "char*") {
      size = pointerSize;
      align = pointerSize;
      pack = (view, off, val) => {
        if (!val) {
          pointerPacker(view, off, null);
          return;
        }
        const bytes = encoder.encode(val);
        const bufPtr = ptr2(bytes);
        pointerPacker(view, off, bufPtr);
        retainPointerTarget(view.buffer, bytes);
      };
      unpack = (view, off) => {
        const ptrVal = pointerUnpacker(view, off);
        return ptrVal;
      };
      needsLengthOf = true;
    } else if (isEnum(typeOrStruct)) {
      const base = typeOrStruct.type;
      size = typeSizes[base];
      align = typeAlignments[base];
      const { pack: packEnum } = primitivePackers(base);
      pack = (view, off, val) => {
        const num = typeOrStruct.to(val);
        packEnum(view, off, num);
      };
      unpack = (view, off) => {
        const raw = typeGetters[base](view, off);
        return typeOrStruct.from(raw);
      };
    } else if (isStruct(typeOrStruct)) {
      if (options.asPointer === true) {
        size = pointerSize;
        align = pointerSize;
        pack = (view, off, val, obj, options2) => {
          if (!val) {
            pointerPacker(view, off, null);
            return;
          }
          const nestedBuf = typeOrStruct.pack(val, options2);
          pointerPacker(view, off, ptr2(nestedBuf));
          retainPointerTarget(view.buffer, nestedBuf);
        };
        unpack = (view, off) => {
          throw new Error("Not implemented yet");
        };
      } else {
        size = typeOrStruct.size;
        align = typeOrStruct.align;
        pack = (view, off, val, obj, options2) => {
          const nestedBuf = typeOrStruct.pack(val, options2);
          const nestedView = new Uint8Array(nestedBuf);
          const dView = new Uint8Array(view.buffer);
          dView.set(nestedView, off);
          retainIfPointerTargets(view.buffer, nestedBuf);
        };
        unpack = (view, off) => {
          const slice = view.buffer.slice(off, off + size);
          return typeOrStruct.unpack(slice);
        };
      }
    } else if (isObjectPointerDef(typeOrStruct)) {
      size = pointerSize;
      align = pointerSize;
      pack = (view, off, value) => {
        const ptrValue = value?.ptr ?? null;
        if (ptrValue === undefined) {
          console.warn(`Field '${name}' expected object with '.ptr' property, but got undefined pointer value from:`, value);
          pointerPacker(view, off, null);
        } else {
          pointerPacker(view, off, ptrValue);
        }
      };
      unpack = (view, off) => {
        return pointerUnpacker(view, off);
      };
    } else if (Array.isArray(typeOrStruct) && typeOrStruct.length === 1 && typeOrStruct[0] !== undefined) {
      const [def] = typeOrStruct;
      size = pointerSize;
      align = pointerSize;
      let arrayElementSize;
      if (isEnum(def)) {
        arrayElementSize = typeSizes[def.type];
        pack = (view, off, val, obj) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize);
          const bufferView = new DataView(buffer);
          for (let i = 0;i < val.length; i++) {
            const num = def.to(val[i]);
            bufferView.setUint32(i * arrayElementSize, num, true);
          }
          pointerPacker(view, off, ptr2(buffer));
          retainPointerTarget(view.buffer, buffer);
        };
        unpack = null;
        needsLengthOf = true;
        lengthOfDef = def;
      } else if (isStruct(def)) {
        arrayElementSize = def.size;
        pack = (view, off, val, obj, options2) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize);
          const bufferView = new DataView(buffer);
          for (let i = 0;i < val.length; i++) {
            def.packInto(val[i], bufferView, i * arrayElementSize, options2);
          }
          pointerPacker(view, off, ptr2(buffer));
          retainPointerTarget(view.buffer, buffer);
        };
        unpack = (view, off) => {
          throw new Error("Not implemented yet");
        };
      } else if (isPrimitiveType(def)) {
        arrayElementSize = typeSizes[def];
        const { pack: primitivePack } = primitivePackers(def);
        pack = (view, off, val) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize);
          const bufferView = new DataView(buffer);
          for (let i = 0;i < val.length; i++) {
            primitivePack(bufferView, i * arrayElementSize, val[i]);
          }
          pointerPacker(view, off, ptr2(buffer));
          retainPointerTarget(view.buffer, buffer);
        };
        unpack = null;
        needsLengthOf = true;
        lengthOfDef = def;
      } else if (isObjectPointerDef(def)) {
        arrayElementSize = pointerSize;
        pack = (view, off, val) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const packedView = packObjectArray(val);
          pointerPacker(view, off, ptr2(packedView.buffer));
          retainPointerTarget(view.buffer, packedView.buffer);
        };
        unpack = () => {
          throw new Error("not implemented yet");
        };
      } else {
        throw new Error(`Unsupported array element type for ${name}: ${JSON.stringify(def)}`);
      }
      const lengthOfField = Object.values(lengthOfFields).find((f) => f.lengthOf === name);
      if (lengthOfField && isPrimitiveType(lengthOfField.type)) {
        const { pack: lengthPack } = primitivePackers(lengthOfField.type);
        arrayFieldsMetadata[name] = {
          elementSize: arrayElementSize,
          arrayOffset: offset,
          lengthOffset: lengthOfField.offset,
          lengthPack
        };
      }
    } else {
      throw new Error(`Unsupported field type for ${name}: ${JSON.stringify(typeOrStruct)}`);
    }
    offset = alignOffset(offset, align);
    if (options.unpackTransform) {
      const originalUnpack = unpack;
      unpack = (view, off) => options.unpackTransform(originalUnpack(view, off));
    }
    if (options.packTransform) {
      const originalPack = pack;
      pack = (view, off, val, obj, packOptions) => originalPack(view, off, options.packTransform(val), obj, packOptions);
    }
    if (options.optional) {
      const originalPack = pack;
      if (isStruct(typeOrStruct) && !options.asPointer) {
        pack = (view, off, val, obj, packOptions) => {
          if (val || options.mapOptionalInline) {
            originalPack(view, off, val, obj, packOptions);
          }
        };
      } else {
        pack = (view, off, val, obj, packOptions) => originalPack(view, off, val ?? 0, obj, packOptions);
      }
    }
    if (options.lengthOf) {
      const originalPack = pack;
      pack = (view, off, val, obj, packOptions) => {
        const targetValue = obj[options.lengthOf];
        let length = 0;
        if (targetValue) {
          if (typeof targetValue === "string") {
            length = Buffer.byteLength(targetValue);
          } else {
            length = targetValue.length;
          }
        }
        return originalPack(view, off, length, obj, packOptions);
      };
    }
    let validateFunctions;
    if (options.validate) {
      validateFunctions = Array.isArray(options.validate) ? options.validate : [options.validate];
    }
    const layoutField = {
      name,
      offset,
      size,
      align,
      validate: validateFunctions,
      optional: !!options.optional || !!options.lengthOf || options.default !== undefined,
      default: options.default,
      pack,
      unpack,
      type: typeOrStruct,
      lengthOf: options.lengthOf
    };
    layout.push(layoutField);
    if (options.lengthOf) {
      lengthOfFields[options.lengthOf] = layoutField;
    }
    if (needsLengthOf) {
      const def = typeof typeOrStruct === "string" && typeOrStruct === "char*" ? "char*" : lengthOfDef;
      if (!def)
        fatalError(`Internal error: needsLengthOf=true but def is null for ${name}`);
      lengthOfRequested.push({ requester: layoutField, def });
    }
    offset += size;
    maxAlign = Math.max(maxAlign, align);
  }
  for (const { requester, def } of lengthOfRequested) {
    const lengthOfField = lengthOfFields[requester.name];
    if (!lengthOfField) {
      if (def === "char*") {
        continue;
      }
      throw new Error(`lengthOf field not found for array field ${requester.name}`);
    }
    if (def === "char*") {
      const relativeOffset = lengthOfField.offset - requester.offset;
      requester.unpack = (view, off) => {
        const ptrAddress = pointerUnpacker(view, off);
        const length = lengthOfField.unpack(view, off + relativeOffset);
        if (isNullPointer(ptrAddress)) {
          return null;
        }
        const byteLength = toItemCount(length);
        if (byteLength === 0) {
          return "";
        }
        const buffer = toArrayBuffer2(ptrAddress, 0, byteLength);
        return decoder.decode(buffer);
      };
    } else if (isPrimitiveType(def)) {
      const elemSize = typeSizes[def];
      const { unpack: primitiveUnpack } = primitivePackers(def);
      const relativeOffset = lengthOfField.offset - requester.offset;
      requester.unpack = (view, off) => {
        const result = [];
        const length = lengthOfField.unpack(view, off + relativeOffset);
        const itemCount = toItemCount(length);
        const ptrAddress = pointerUnpacker(view, off);
        if (isNullPointer(ptrAddress) && itemCount > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`);
        }
        if (isNullPointer(ptrAddress) || itemCount === 0) {
          return [];
        }
        const buffer = toArrayBuffer2(ptrAddress, 0, itemCount * elemSize);
        const bufferView = new DataView(buffer);
        for (let i = 0;i < itemCount; i++) {
          result.push(primitiveUnpack(bufferView, i * elemSize));
        }
        return result;
      };
    } else {
      const elemSize = def.type === "u32" ? 4 : 8;
      const relativeOffset = lengthOfField.offset - requester.offset;
      requester.unpack = (view, off) => {
        const result = [];
        const length = lengthOfField.unpack(view, off + relativeOffset);
        const itemCount = toItemCount(length);
        const ptrAddress = pointerUnpacker(view, off);
        if (isNullPointer(ptrAddress) && itemCount > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`);
        }
        if (isNullPointer(ptrAddress) || itemCount === 0) {
          return [];
        }
        const buffer = toArrayBuffer2(ptrAddress, 0, itemCount * elemSize);
        const bufferView = new DataView(buffer);
        for (let i = 0;i < itemCount; i++) {
          result.push(def.from(bufferView.getUint32(i * elemSize, true)));
        }
        return result;
      };
    }
  }
  const totalSize = alignOffset(offset, maxAlign);
  const description = layout.map((f) => ({
    name: f.name,
    offset: f.offset,
    size: f.size,
    align: f.align,
    optional: f.optional,
    type: f.type,
    lengthOf: f.lengthOf
  }));
  const layoutByName = new Map(description.map((f) => [f.name, f]));
  const arrayFields = new Map(Object.entries(arrayFieldsMetadata));
  return {
    __type: "struct",
    size: totalSize,
    align: maxAlign,
    hasMapValue: !!structDefOptions?.mapValue,
    layoutByName,
    arrayFields,
    pack(obj, options) {
      const buf = new ArrayBuffer(totalSize);
      const view = new DataView(buf);
      let mappedObj = obj;
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj);
      }
      for (const field of layout) {
        const value = mappedObj[field.name] ?? field.default;
        if (!field.optional && value === undefined) {
          fatalError(`Packing non-optional field '${field.name}' but value is undefined (and no default provided)`);
        }
        if (field.validate) {
          for (const validateFn of field.validate) {
            validateFn(value, field.name, {
              hints: options?.validationHints,
              input: mappedObj
            });
          }
        }
        field.pack(view, field.offset, value, mappedObj, options);
      }
      return view.buffer;
    },
    packInto(obj, view, offset2, options) {
      let mappedObj = obj;
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj);
      }
      for (const field of layout) {
        const value = mappedObj[field.name] ?? field.default;
        if (!field.optional && value === undefined) {
          console.warn(`packInto missing value for non-optional field '${field.name}' at offset ${offset2 + field.offset}. Writing default or zero.`);
        }
        if (field.validate) {
          for (const validateFn of field.validate) {
            validateFn(value, field.name, {
              hints: options?.validationHints,
              input: mappedObj
            });
          }
        }
        field.pack(view, offset2 + field.offset, value, mappedObj, options);
      }
    },
    unpack(buf) {
      if (buf.byteLength < totalSize) {
        fatalError(`Buffer size (${buf.byteLength}) is smaller than struct size (${totalSize}) for unpacking.`);
      }
      const view = new DataView(buf);
      const result = structDefOptions?.default ? { ...structDefOptions.default } : {};
      for (const field of layout) {
        if (!field.unpack) {
          continue;
        }
        try {
          result[field.name] = field.unpack(view, field.offset);
        } catch (e) {
          console.error(`Error unpacking field '${field.name}' at offset ${field.offset}:`, e);
          throw e;
        }
      }
      if (structDefOptions?.reduceValue) {
        return structDefOptions.reduceValue(result);
      }
      return result;
    },
    packList(objects, options) {
      if (objects.length === 0) {
        return new ArrayBuffer(0);
      }
      const buffer = new ArrayBuffer(totalSize * objects.length);
      const view = new DataView(buffer);
      for (let i = 0;i < objects.length; i++) {
        let mappedObj = objects[i];
        if (structDefOptions?.mapValue) {
          mappedObj = structDefOptions.mapValue(objects[i]);
        }
        for (const field of layout) {
          const value = mappedObj[field.name] ?? field.default;
          if (!field.optional && value === undefined) {
            fatalError(`Packing non-optional field '${field.name}' at index ${i} but value is undefined (and no default provided)`);
          }
          if (field.validate) {
            for (const validateFn of field.validate) {
              validateFn(value, field.name, {
                hints: options?.validationHints,
                input: mappedObj
              });
            }
          }
          field.pack(view, i * totalSize + field.offset, value, mappedObj, options);
        }
      }
      return buffer;
    },
    unpackList(buf, count) {
      if (count === 0) {
        return [];
      }
      const expectedSize = totalSize * count;
      if (buf.byteLength < expectedSize) {
        fatalError(`Buffer size (${buf.byteLength}) is smaller than expected size (${expectedSize}) for unpacking ${count} structs.`);
      }
      const view = new DataView(buf);
      const results = [];
      for (let i = 0;i < count; i++) {
        const offset2 = i * totalSize;
        const result = structDefOptions?.default ? { ...structDefOptions.default } : {};
        for (const field of layout) {
          if (!field.unpack) {
            continue;
          }
          try {
            result[field.name] = field.unpack(view, offset2 + field.offset);
          } catch (e) {
            console.error(`Error unpacking field '${field.name}' at index ${i}, offset ${offset2 + field.offset}:`, e);
            throw e;
          }
        }
        if (structDefOptions?.reduceValue) {
          results.push(structDefOptions.reduceValue(result));
        } else {
          results.push(result);
        }
      }
      return results;
    },
    describe() {
      return description;
    }
  };
}

// src/zig-structs.ts
var rgbaPackTransform = (rgba) => rgba?.buffer ?? null;
var rgbaUnpackTransform = (ptr3) => ptr3 ? RGBA.fromArray(new Uint16Array(toArrayBuffer(ptr3, 0, 8))) : undefined;
var StyledChunkStruct = defineStruct([
  ["text", "char*"],
  ["text_len", "u64", { lengthOf: "text" }],
  [
    "fg",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform
    }
  ],
  [
    "bg",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform
    }
  ],
  ["attributes", "u32", { default: 0 }],
  ["link", "char*", { default: "" }],
  ["link_len", "u64", { lengthOf: "link" }]
], {
  mapValue: (chunk) => {
    const normalizedFg = normalizeColorValue(chunk.fg ?? null);
    const normalizedBg = normalizeColorValue(chunk.bg ?? null);
    if (!chunk.link || typeof chunk.link === "string") {
      return {
        ...chunk,
        fg: normalizedFg?.rgba ?? null,
        bg: normalizedBg?.rgba ?? null
      };
    }
    return {
      ...chunk,
      fg: normalizedFg?.rgba ?? null,
      bg: normalizedBg?.rgba ?? null,
      link: chunk.link.url
    };
  }
});
var HighlightStruct = defineStruct([
  ["start", "u32"],
  ["end", "u32"],
  ["styleId", "u32"],
  ["priority", "u8", { default: 0 }],
  ["hlRef", "u16", { default: 0 }]
]);
var LogicalCursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
  ["offset", "u32"]
]);
var VisualCursorStruct = defineStruct([
  ["visualRow", "u32"],
  ["visualCol", "u32"],
  ["logicalRow", "u32"],
  ["logicalCol", "u32"],
  ["offset", "u32"]
]);
var UnicodeMethodEnum = defineEnum({ wcwidth: 0, unicode: 1 }, "u8");
var TerminalMultiplexerEnum = defineEnum({ none: 0, tmux: 1, zellij: 2, screen: 3, unknown: 4 }, "u8");
var Osc52SupportEnum = defineEnum({ unknown: 0, supported: 1, unsupported: 2 }, "u8");
var TerminalCapabilitiesStruct = defineStruct([
  ["kitty_keyboard", "bool_u8"],
  ["kitty_graphics", "bool_u8"],
  ["rgb", "bool_u8"],
  ["ansi256", "bool_u8"],
  ["unicode", UnicodeMethodEnum],
  ["sgr_pixels", "bool_u8"],
  ["color_scheme_updates", "bool_u8"],
  ["explicit_width", "bool_u8"],
  ["scaled_text", "bool_u8"],
  ["sixel", "bool_u8"],
  ["focus_tracking", "bool_u8"],
  ["sync", "bool_u8"],
  ["bracketed_paste", "bool_u8"],
  ["hyperlinks", "bool_u8"],
  ["osc52", "bool_u8"],
  ["notifications", "bool_u8"],
  ["explicit_cursor_positioning", "bool_u8"],
  ["remote", "bool_u8"],
  ["multiplexer", TerminalMultiplexerEnum],
  ["term_name", "char*"],
  ["term_name_len", "u64", { lengthOf: "term_name" }],
  ["term_version", "char*"],
  ["term_version_len", "u64", { lengthOf: "term_version" }],
  ["term_from_xtversion", "bool_u8"],
  ["osc52_support", Osc52SupportEnum]
]);
var EncodedCharStruct = defineStruct([
  ["width", "u8"],
  ["char", "u32"]
]);
var LineInfoStruct = defineStruct([
  ["startCols", ["u32"]],
  ["startColsLen", "u32", { lengthOf: "startCols" }],
  ["widthCols", ["u32"]],
  ["widthColsLen", "u32", { lengthOf: "widthCols" }],
  ["sources", ["u32"]],
  ["sourcesLen", "u32", { lengthOf: "sources" }],
  ["wraps", ["u32"]],
  ["wrapsLen", "u32", { lengthOf: "wraps" }],
  ["widthColsMax", "u32"]
]);
var MeasureResultStruct = defineStruct([
  ["lineCount", "u32"],
  ["widthColsMax", "u32"]
]);
var CursorStateStruct = defineStruct([
  ["x", "u32"],
  ["y", "u32"],
  ["visible", "bool_u8"],
  ["style", "u8"],
  ["blinking", "bool_u8"],
  ["r", "f32"],
  ["g", "f32"],
  ["b", "f32"],
  ["a", "f32"]
]);
var CursorStyleOptionsStruct = defineStruct([
  ["style", "u8", { default: 255 }],
  ["blinking", "u8", { default: 255 }],
  [
    "color",
    "pointer",
    {
      optional: true,
      packTransform: rgbaPackTransform,
      unpackTransform: rgbaUnpackTransform
    }
  ],
  ["cursor", "u8", { default: 255 }]
]);
var GridDrawOptionsStruct = defineStruct([
  ["drawInner", "bool_u8", { default: true }],
  ["drawOuter", "bool_u8", { default: true }]
]);
var BuildOptionsStruct = defineStruct([
  ["gpaSafeStats", "bool_u8"],
  ["gpaMemoryLimitTracking", "bool_u8"]
]);
var AllocatorStatsStruct = defineStruct([
  ["totalRequestedBytes", "u64"],
  ["activeAllocations", "u64"],
  ["smallAllocations", "u64"],
  ["largeAllocations", "u64"],
  ["requestedBytesValid", "bool_u8"]
]);
var NativeRenderStatsStruct = defineStruct([
  ["lastFrameTime", "f64"],
  ["averageFrameTime", "f64"],
  ["renderTime", "f64"],
  ["stdoutWriteTime", "f64"],
  ["frameCount", "u64"],
  ["cellsUpdated", "u32"],
  ["averageCellsUpdated", "u32"],
  ["renderTimeValid", "bool_u8"],
  ["stdoutWriteTimeValid", "bool_u8"]
]);
var GrowthPolicyEnum = defineEnum({ grow: 0, block: 1 }, "u8");
var NativeSpanFeedOptionsStruct = defineStruct([
  ["chunkSize", "u32", { default: 64 * 1024 }],
  ["initialChunks", "u32", { default: 2 }],
  ["maxBytes", "u64", { default: 0n }],
  ["growthPolicy", GrowthPolicyEnum, { default: "grow" }],
  ["autoCommitOnFull", "bool_u8", { default: true }],
  ["spanQueueCapacity", "u32", { default: 0 }]
]);
var NativeSpanFeedStatsStruct = defineStruct([
  ["bytesWritten", "u64"],
  ["spansCommitted", "u64"],
  ["chunks", "u32"],
  ["pendingSpans", "u32"]
]);
var SpanInfoStruct = defineStruct([
  ["chunkPtr", "pointer"],
  ["offset", "u32"],
  ["len", "u32"],
  ["chunkIndex", "u32"],
  ["reserved", "u32", { default: 0 }]
], {
  reduceValue: (value) => ({
    chunkPtr: value.chunkPtr,
    offset: value.offset,
    len: value.len,
    chunkIndex: value.chunkIndex
  })
});
var ReserveInfoStruct = defineStruct([
  ["ptr", "pointer"],
  ["len", "u32"],
  ["reserved", "u32", { default: 0 }]
], {
  reduceValue: (value) => ({
    ptr: value.ptr,
    len: value.len
  })
});
var NativeAudioStreamFormat = {
  Mp3: 1,
  Flac: 2
};
var NativeAudioStreamState = {
  Initializing: 0,
  Buffering: 1,
  Playing: 2,
  Ended: 3,
  Failed: 4,
  Cancelled: 5,
  Reconnecting: 6
};
var NativeAudioStreamStateNames = [
  "initializing",
  "buffering",
  "playing",
  "ended",
  "errored",
  "disposed",
  "reconnecting"
];
var NativeAudioStreamCloseReason = {
  PreserveNativeTerminal: 0,
  TransportError: 1,
  Disposed: 2
};
var AudioCreateOptionsStruct = defineStruct([
  ["sampleRate", "u32", { default: 48000 }],
  ["playbackChannels", "u32", { default: 2 }]
]);
var AudioStartOptionsStruct = defineStruct([
  ["periodSizeInFrames", "u32", { default: 0 }],
  ["periodSizeInMilliseconds", "u32", { default: 0 }],
  ["periods", "u32", { default: 0 }],
  ["performanceProfile", "u8", { default: 0 }],
  ["shareMode", "u8", { default: 0 }],
  ["noPreSilencedOutputBuffer", "bool_u8", { default: false }],
  ["noClip", "bool_u8", { default: false }],
  ["noDisableDenormals", "bool_u8", { default: false }],
  ["noFixedSizedCallback", "bool_u8", { default: false }],
  ["wasapiNoAutoConvertSrc", "bool_u8", { default: false }],
  ["wasapiNoDefaultQualitySrc", "bool_u8", { default: false }],
  ["alsaNoMMap", "bool_u8", { default: false }],
  ["alsaNoAutoFormat", "bool_u8", { default: false }],
  ["alsaNoAutoChannels", "bool_u8", { default: false }],
  ["alsaNoAutoResample", "bool_u8", { default: false }]
]);
var AudioVoiceOptionsStruct = defineStruct([
  ["volume", "f32", { default: 1 }],
  ["pan", "f32", { default: 0 }],
  ["loop", "bool_u8", { default: false }],
  ["groupId", "u32", { default: 0 }]
]);
var AudioStreamCreateOptionsStruct = defineStruct([
  ["capacityMs", "u32"],
  ["startupMs", "u32"],
  ["resumeMs", "u32"],
  ["volume", "f32"],
  ["pan", "f32"],
  ["groupId", "u32"],
  ["maxProbeBytes", "u32"],
  ["format", "u32"]
]);
var AudioStreamStatsStruct = defineStruct([
  ["bytesReceived", "u64"],
  ["framesDecoded", "u64"],
  ["framesPlayed", "u64"],
  ["state", "u32"],
  ["sampleRate", "u32"],
  ["channels", "u32"],
  ["bufferedFrames", "u32"],
  ["capacityFrames", "u32"],
  ["underruns", "u32"],
  ["errorCode", "i32"],
  ["readyGeneration", "u32"]
]);
var AudioStatsStruct = defineStruct([
  ["soundsLoaded", "u32"],
  ["voicesActive", "u32"],
  ["framesMixed", "u64"],
  ["lockMisses", "u32"],
  ["lastPeak", "f32"],
  ["lastRms", "f32"]
]);

// src/zig.ts
var NativeAudioStreamState2 = NativeAudioStreamState;
var NativeAudioStreamCloseReason2 = NativeAudioStreamCloseReason;
var NativeAudioStreamFormat2 = NativeAudioStreamFormat;
registerEnvVar({
  name: "OPENTUI_LIBC",
  description: "Select Linux native libc package. Supported values: glibc, musl.",
  type: "string",
  default: ""
});
var targetLibPath;
var targetLibError;
try {
  targetLibPath = await resolveNativeLibraryPath();
  if (isBunfsPath(targetLibPath)) {
    targetLibPath = targetLibPath.replace("../", "");
  }
  if (!existsSync3(targetLibPath)) {
    throw new Error(`OpenTUI native library does not exist at ${JSON.stringify(targetLibPath)}`);
  }
} catch (error) {
  targetLibError = error instanceof Error ? error : new Error(String(error));
}
registerEnvVar({
  name: "OTUI_DEBUG_FFI",
  description: "Enable debug logging for the FFI bindings.",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OTUI_TRACE_FFI",
  description: "Enable tracing for the FFI bindings.",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OPENTUI_FORCE_WCWIDTH",
  description: "Use wcwidth for character width calculations",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OPENTUI_FORCE_UNICODE",
  description: "Force Mode 2026 Unicode support in terminal capabilities",
  type: "boolean",
  default: false
});
registerEnvVar({
  name: "OPENTUI_GRAPHICS",
  description: "Enable Kitty graphics protocol detection",
  type: "boolean",
  default: true
});
registerEnvVar({
  name: "OPENTUI_FORCE_NOZWJ",
  description: "Use no_zwj width method (Unicode without ZWJ joining)",
  type: "boolean",
  default: false
});
var CURSOR_STYLE_TO_ID = { block: 0, line: 1, underline: 2, default: 3 };
var CURSOR_ID_TO_STYLE = ["block", "line", "underline", "default"];
var MOUSE_STYLE_TO_ID = { default: 0, pointer: 1, text: 2, crosshair: 3, move: 4, "not-allowed": 5 };
var MAX_FFI_U32 = 4294967295;
var globalTraceSymbols = null;
var globalFFILogPath = null;
var exitHandlerRegistered = false;
function toNumber(value) {
  return typeof value === "bigint" ? Number(value) : value;
}
function toSafeByteCount(value, label) {
  if (typeof value !== "bigint") {
    return value;
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds JavaScript safe integer range`);
  }
  return Number(value);
}
function toSafeFFIU32Length(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_FFI_U32) {
    throw new RangeError(`${label} exceeds native u32 length limit`);
  }
  return value;
}
function isFFIU32(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_FFI_U32;
}
function ptrOrNull(value) {
  return value.byteLength === 0 ? null : ptr(value);
}
function rgbaPtr(value) {
  return ptr(value.buffer);
}
function optionalRgbaPtr(value) {
  return value ? rgbaPtr(value) : null;
}
function getOpenTUILib(libPath) {
  const resolvedLibPath = libPath || targetLibPath;
  if (!resolvedLibPath) {
    throw targetLibError ?? new Error(`OpenTUI is not supported on the current platform: ${process.platform}-${process.arch}`);
  }
  const rawSymbols = dlopen(resolvedLibPath, {
    setLogCallback: {
      args: ["ptr"],
      returns: "void"
    },
    createEventSink: {
      args: ["ptr"],
      returns: "u32"
    },
    destroyEventSink: {
      args: ["u32"],
      returns: "void"
    },
    createNativeRenderable: {
      args: [],
      returns: "u32"
    },
    destroyNativeRenderable: {
      args: ["u32"],
      returns: "void"
    },
    nativeRenderableAttachYogaNode: {
      args: ["u32", "ptr"],
      returns: "bool"
    },
    nativeRenderableSetMeasureTarget: {
      args: ["u32", "u32", "u32"],
      returns: "bool"
    },
    createRenderer: {
      args: ["u32", "u32", "u8", "u8", "ptr"],
      returns: "u32"
    },
    setTerminalEnvVar: {
      args: ["u32", "ptr", "u32", "ptr", "u32"],
      returns: "bool"
    },
    destroyRenderer: {
      args: ["u32"],
      returns: "void"
    },
    setUseThread: {
      args: ["u32", "bool"],
      returns: "void"
    },
    setClearOnShutdown: {
      args: ["u32", "bool"],
      returns: "void"
    },
    setBackgroundColor: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    setRenderOffset: {
      args: ["u32", "u32"],
      returns: "void"
    },
    resetSplitScrollback: {
      args: ["u32", "u32", "u32"],
      returns: "u32"
    },
    syncSplitScrollback: {
      args: ["u32", "u32"],
      returns: "u32"
    },
    getSplitOutputOffset: {
      args: ["u32", "u32"],
      returns: "u32"
    },
    setPendingSplitFooterTransition: {
      args: ["u32", "u8", "u32", "u32", "u32", "u32", "u32"],
      returns: "void"
    },
    clearPendingSplitFooterTransition: {
      args: ["u32"],
      returns: "void"
    },
    updateStats: {
      args: ["u32", "f64", "u32", "f64"],
      returns: "void"
    },
    updateMemoryStats: {
      args: ["u32", "u32", "u32", "u32"],
      returns: "void"
    },
    getRenderStats: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    render: {
      args: ["u32", "bool"],
      returns: "u8"
    },
    repaintSplitFooter: {
      args: ["u32", "u32", "bool"],
      returns: "u64"
    },
    commitSplitFooterSnapshot: {
      args: ["u32", "u32", "u32", "bool", "bool", "u32", "bool", "bool", "bool"],
      returns: "u64"
    },
    getNextBuffer: {
      args: ["u32"],
      returns: "u32"
    },
    getCurrentBuffer: {
      args: ["u32"],
      returns: "u32"
    },
    rendererSetPaletteState: {
      args: ["u32", "ptr", "u32", "ptr", "ptr", "u32"],
      returns: "void"
    },
    queryPixelResolution: {
      args: ["u32"],
      returns: "void"
    },
    queryThemeColors: {
      args: ["u32"],
      returns: "void"
    },
    createOptimizedBuffer: {
      args: ["u32", "u32", "bool", "u8", "ptr", "u32"],
      returns: "u32"
    },
    destroyOptimizedBuffer: {
      args: ["u32"],
      returns: "void"
    },
    drawFrameBuffer: {
      args: ["u32", "i32", "i32", "u32", "u32", "u32", "u32", "u32"],
      returns: "void"
    },
    getBufferWidth: {
      args: ["u32"],
      returns: "u32"
    },
    getBufferHeight: {
      args: ["u32"],
      returns: "u32"
    },
    bufferClear: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    bufferGetCharPtr: {
      args: ["u32"],
      returns: "ptr"
    },
    bufferGetFgPtr: {
      args: ["u32"],
      returns: "ptr"
    },
    bufferGetBgPtr: {
      args: ["u32"],
      returns: "ptr"
    },
    bufferGetAttributesPtr: {
      args: ["u32"],
      returns: "ptr"
    },
    bufferGetRespectAlpha: {
      args: ["u32"],
      returns: "bool"
    },
    bufferSetRespectAlpha: {
      args: ["u32", "bool"],
      returns: "void"
    },
    bufferGetId: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    bufferGetRealCharSize: {
      args: ["u32"],
      returns: "u32"
    },
    bufferWriteResolvedChars: {
      args: ["u32", "ptr", "u32", "bool"],
      returns: "u32"
    },
    bufferDrawText: {
      args: ["u32", "ptr", "u32", "u32", "u32", "ptr", "ptr", "u32"],
      returns: "void"
    },
    bufferSetCellWithAlphaBlending: {
      args: ["u32", "u32", "u32", "u32", "ptr", "ptr", "u32"],
      returns: "void"
    },
    bufferSetCell: {
      args: ["u32", "u32", "u32", "u32", "ptr", "ptr", "u32"],
      returns: "void"
    },
    bufferFillRect: {
      args: ["u32", "u32", "u32", "u32", "u32", "ptr"],
      returns: "void"
    },
    bufferColorMatrix: {
      args: ["u32", "ptr", "ptr", "u32", "f32", "u8"],
      returns: "void"
    },
    bufferColorMatrixUniform: {
      args: ["u32", "ptr", "f32", "u8"],
      returns: "void"
    },
    bufferResize: {
      args: ["u32", "u32", "u32"],
      returns: "void"
    },
    linkAlloc: {
      args: ["ptr", "u32"],
      returns: "u32"
    },
    linkGetUrl: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    attributesWithLink: {
      args: ["u32", "u32"],
      returns: "u32"
    },
    attributesGetLinkId: {
      args: ["u32"],
      returns: "u32"
    },
    resizeRenderer: {
      args: ["u32", "u32", "u32"],
      returns: "void"
    },
    setCursorPosition: {
      args: ["u32", "i32", "i32", "bool"],
      returns: "void"
    },
    setCursorColor: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    getCursorState: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    setCursorStyleOptions: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    setDebugOverlay: {
      args: ["u32", "bool", "u8"],
      returns: "void"
    },
    clearTerminal: {
      args: ["u32"],
      returns: "void"
    },
    setTerminalTitle: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    copyToClipboardOSC52: {
      args: ["u32", "u8", "ptr", "u32"],
      returns: "bool"
    },
    clearClipboardOSC52: {
      args: ["u32", "u8"],
      returns: "bool"
    },
    triggerNotification: {
      args: ["u32", "ptr", "u32", "ptr", "u32"],
      returns: "bool"
    },
    bufferDrawSuperSampleBuffer: {
      args: ["u32", "u32", "u32", "ptr", "u32", "u8", "u32"],
      returns: "void"
    },
    bufferDrawPackedBuffer: {
      args: ["u32", "ptr", "u32", "u32", "u32", "u32", "u32"],
      returns: "void"
    },
    bufferDrawGrayscaleBuffer: {
      args: ["u32", "i32", "i32", "ptr", "u32", "u32", "ptr", "ptr"],
      returns: "void"
    },
    bufferDrawGrayscaleBufferSupersampled: {
      args: ["u32", "i32", "i32", "ptr", "u32", "u32", "ptr", "ptr"],
      returns: "void"
    },
    bufferDrawGrid: {
      args: ["u32", "ptr", "ptr", "ptr", "ptr", "u32", "ptr", "u32", "ptr"],
      returns: "void"
    },
    bufferDrawBox: {
      args: ["u32", "i32", "i32", "u32", "u32", "ptr", "u32", "ptr", "ptr", "ptr", "ptr", "u32", "ptr", "u32"],
      returns: "void"
    },
    bufferPushScissorRect: {
      args: ["u32", "i32", "i32", "u32", "u32"],
      returns: "void"
    },
    bufferPopScissorRect: {
      args: ["u32"],
      returns: "void"
    },
    bufferClearScissorRects: {
      args: ["u32"],
      returns: "void"
    },
    bufferPushOpacity: {
      args: ["u32", "f32"],
      returns: "void"
    },
    bufferPopOpacity: {
      args: ["u32"],
      returns: "void"
    },
    bufferGetCurrentOpacity: {
      args: ["u32"],
      returns: "f32"
    },
    bufferClearOpacity: {
      args: ["u32"],
      returns: "void"
    },
    addToHitGrid: {
      args: ["u32", "i32", "i32", "u32", "u32", "u32"],
      returns: "void"
    },
    clearCurrentHitGrid: {
      args: ["u32"],
      returns: "void"
    },
    hitGridPushScissorRect: {
      args: ["u32", "i32", "i32", "u32", "u32"],
      returns: "void"
    },
    hitGridPopScissorRect: {
      args: ["u32"],
      returns: "void"
    },
    hitGridClearScissorRects: {
      args: ["u32"],
      returns: "void"
    },
    addToCurrentHitGridClipped: {
      args: ["u32", "i32", "i32", "u32", "u32", "u32"],
      returns: "void"
    },
    checkHit: {
      args: ["u32", "u32", "u32"],
      returns: "u32"
    },
    getHitGridDirty: {
      args: ["u32"],
      returns: "bool"
    },
    dumpHitGrid: {
      args: ["u32"],
      returns: "void"
    },
    dumpBuffers: {
      args: ["u32", "i64"],
      returns: "void"
    },
    dumpOutputBuffer: {
      args: ["u32", "i64"],
      returns: "void"
    },
    restoreTerminalModes: {
      args: ["u32"],
      returns: "void"
    },
    enableMouse: {
      args: ["u32", "bool"],
      returns: "void"
    },
    disableMouse: {
      args: ["u32"],
      returns: "void"
    },
    enableKittyKeyboard: {
      args: ["u32", "u8"],
      returns: "void"
    },
    disableKittyKeyboard: {
      args: ["u32"],
      returns: "void"
    },
    setKittyKeyboardFlags: {
      args: ["u32", "u8"],
      returns: "void"
    },
    getKittyKeyboardFlags: {
      args: ["u32"],
      returns: "u8"
    },
    setupTerminal: {
      args: ["u32", "bool"],
      returns: "void"
    },
    suspendRenderer: {
      args: ["u32"],
      returns: "void"
    },
    resumeRenderer: {
      args: ["u32"],
      returns: "void"
    },
    writeOut: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    createTextBuffer: {
      args: ["u8"],
      returns: "u32"
    },
    destroyTextBuffer: {
      args: ["u32"],
      returns: "void"
    },
    textBufferGetLength: {
      args: ["u32"],
      returns: "u32"
    },
    textBufferGetByteSize: {
      args: ["u32"],
      returns: "u32"
    },
    textBufferReset: {
      args: ["u32"],
      returns: "void"
    },
    textBufferClear: {
      args: ["u32"],
      returns: "void"
    },
    textBufferSetDefaultFg: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferSetDefaultBg: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferSetDefaultAttributes: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferResetDefaults: {
      args: ["u32"],
      returns: "void"
    },
    textBufferGetTabWidth: {
      args: ["u32"],
      returns: "u8"
    },
    textBufferSetTabWidth: {
      args: ["u32", "u8"],
      returns: "void"
    },
    textBufferRegisterMemBuffer: {
      args: ["u32", "ptr", "u32", "bool"],
      returns: "u16"
    },
    textBufferReplaceMemBuffer: {
      args: ["u32", "u8", "ptr", "u32", "bool"],
      returns: "bool"
    },
    textBufferClearMemRegistry: {
      args: ["u32"],
      returns: "void"
    },
    textBufferSetTextFromMem: {
      args: ["u32", "u8"],
      returns: "void"
    },
    textBufferAppend: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    textBufferAppendFromMemId: {
      args: ["u32", "u8"],
      returns: "void"
    },
    textBufferLoadFile: {
      args: ["u32", "ptr", "u32"],
      returns: "bool"
    },
    textBufferSetStyledText: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    textBufferGetLineCount: {
      args: ["u32"],
      returns: "u32"
    },
    textBufferGetPlainText: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    textBufferAddHighlightByCharRange: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferAddHighlight: {
      args: ["u32", "u32", "ptr"],
      returns: "void"
    },
    textBufferRemoveHighlightsByRef: {
      args: ["u32", "u16"],
      returns: "void"
    },
    textBufferClearLineHighlights: {
      args: ["u32", "u32"],
      returns: "void"
    },
    textBufferClearAllHighlights: {
      args: ["u32"],
      returns: "void"
    },
    textBufferSetSyntaxStyle: {
      args: ["u32", "u32"],
      returns: "bool"
    },
    textBufferGetLineHighlightsPtr: {
      args: ["u32", "u32", "ptr"],
      returns: "ptr"
    },
    textBufferFreeLineHighlights: {
      args: ["ptr", "u32"],
      returns: "void"
    },
    textBufferGetHighlightCount: {
      args: ["u32"],
      returns: "u32"
    },
    textBufferGetTextRange: {
      args: ["u32", "u32", "u32", "ptr", "u32"],
      returns: "u32"
    },
    textBufferGetTextRangeByCoords: {
      args: ["u32", "u32", "u32", "u32", "u32", "ptr", "u32"],
      returns: "u32"
    },
    createTextBufferView: {
      args: ["u32"],
      returns: "u32"
    },
    destroyTextBufferView: {
      args: ["u32"],
      returns: "void"
    },
    textBufferViewSetSelection: {
      args: ["u32", "u32", "u32", "ptr", "ptr"],
      returns: "void"
    },
    textBufferViewResetSelection: {
      args: ["u32"],
      returns: "void"
    },
    textBufferViewGetSelectionInfo: {
      args: ["u32"],
      returns: "u64"
    },
    textBufferViewSetLocalSelection: {
      args: ["u32", "i32", "i32", "i32", "i32", "ptr", "ptr"],
      returns: "bool"
    },
    textBufferViewUpdateSelection: {
      args: ["u32", "u32", "ptr", "ptr"],
      returns: "void"
    },
    textBufferViewUpdateLocalSelection: {
      args: ["u32", "i32", "i32", "i32", "i32", "ptr", "ptr"],
      returns: "bool"
    },
    textBufferViewResetLocalSelection: {
      args: ["u32"],
      returns: "void"
    },
    textBufferViewSetWrapWidth: {
      args: ["u32", "u32"],
      returns: "void"
    },
    textBufferViewSetWrapMode: {
      args: ["u32", "u8"],
      returns: "void"
    },
    textBufferViewSetFirstLineOffset: {
      args: ["u32", "u32"],
      returns: "void"
    },
    textBufferViewSetViewportSize: {
      args: ["u32", "u32", "u32"],
      returns: "void"
    },
    textBufferViewSetViewport: {
      args: ["u32", "u32", "u32", "u32", "u32"],
      returns: "void"
    },
    textBufferViewGetVirtualLineCount: {
      args: ["u32"],
      returns: "u32"
    },
    textBufferViewGetLineInfoDirect: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferViewGetLogicalLineInfoDirect: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferViewGetSelectedText: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    textBufferViewGetPlainText: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    textBufferViewSetTabIndicator: {
      args: ["u32", "u32"],
      returns: "void"
    },
    textBufferViewSetTabIndicatorColor: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    textBufferViewSetTruncate: {
      args: ["u32", "bool"],
      returns: "void"
    },
    textBufferViewMeasureForDimensions: {
      args: ["u32", "u32", "u32", "ptr"],
      returns: "bool"
    },
    bufferDrawTextBufferView: {
      args: ["u32", "u32", "i32", "i32"],
      returns: "void"
    },
    bufferDrawEditorView: {
      args: ["u32", "u32", "i32", "i32"],
      returns: "void"
    },
    createEditorView: {
      args: ["u32", "u32", "u32"],
      returns: "u32"
    },
    destroyEditorView: {
      args: ["u32"],
      returns: "void"
    },
    editorViewSetViewportSize: {
      args: ["u32", "u32", "u32"],
      returns: "void"
    },
    editorViewSetViewport: {
      args: ["u32", "u32", "u32", "u32", "u32", "bool"],
      returns: "void"
    },
    editorViewGetViewport: {
      args: ["u32", "ptr", "ptr", "ptr", "ptr"],
      returns: "void"
    },
    editorViewSetScrollMargin: {
      args: ["u32", "f32"],
      returns: "void"
    },
    editorViewSetWrapMode: {
      args: ["u32", "u8"],
      returns: "void"
    },
    editorViewGetVirtualLineCount: {
      args: ["u32"],
      returns: "u32"
    },
    editorViewGetTotalVirtualLineCount: {
      args: ["u32"],
      returns: "u32"
    },
    editorViewGetTextBufferView: {
      args: ["u32"],
      returns: "u32"
    },
    editorViewGetLineInfoDirect: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewGetLogicalLineInfoDirect: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    createEditBuffer: {
      args: ["u8", "u32"],
      returns: "u32"
    },
    destroyEditBuffer: {
      args: ["u32"],
      returns: "void"
    },
    editBufferSetText: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    editBufferSetTextFromMem: {
      args: ["u32", "u8"],
      returns: "void"
    },
    editBufferReplaceText: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    editBufferReplaceTextFromMem: {
      args: ["u32", "u8"],
      returns: "void"
    },
    editBufferGetText: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    editBufferInsertChar: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    editBufferInsertText: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    editBufferDeleteChar: {
      args: ["u32"],
      returns: "void"
    },
    editBufferDeleteCharBackward: {
      args: ["u32"],
      returns: "void"
    },
    editBufferDeleteRange: {
      args: ["u32", "u32", "u32", "u32", "u32"],
      returns: "void"
    },
    editBufferNewLine: {
      args: ["u32"],
      returns: "void"
    },
    editBufferDeleteLine: {
      args: ["u32"],
      returns: "void"
    },
    editBufferMoveCursorLeft: {
      args: ["u32"],
      returns: "void"
    },
    editBufferMoveCursorRight: {
      args: ["u32"],
      returns: "void"
    },
    editBufferMoveCursorUp: {
      args: ["u32"],
      returns: "void"
    },
    editBufferMoveCursorDown: {
      args: ["u32"],
      returns: "void"
    },
    editBufferGotoLine: {
      args: ["u32", "u32"],
      returns: "void"
    },
    editBufferSetCursor: {
      args: ["u32", "u32", "u32"],
      returns: "void"
    },
    editBufferSetCursorToLineCol: {
      args: ["u32", "u32", "u32"],
      returns: "void"
    },
    editBufferSetCursorByOffset: {
      args: ["u32", "u32"],
      returns: "void"
    },
    editBufferGetCursorPosition: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editBufferGetId: {
      args: ["u32"],
      returns: "u16"
    },
    editBufferGetTextBuffer: {
      args: ["u32"],
      returns: "u32"
    },
    editBufferDebugLogRope: {
      args: ["u32"],
      returns: "void"
    },
    editBufferUndo: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    editBufferRedo: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    editBufferCanUndo: {
      args: ["u32"],
      returns: "bool"
    },
    editBufferCanRedo: {
      args: ["u32"],
      returns: "bool"
    },
    editBufferClearHistory: {
      args: ["u32"],
      returns: "void"
    },
    editBufferClear: {
      args: ["u32"],
      returns: "void"
    },
    editBufferGetNextWordBoundary: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editBufferGetPrevWordBoundary: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editBufferGetEOL: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editBufferOffsetToPosition: {
      args: ["u32", "u32", "ptr"],
      returns: "bool"
    },
    editBufferPositionToOffset: {
      args: ["u32", "u32", "u32"],
      returns: "u32"
    },
    editBufferGetLineStartOffset: {
      args: ["u32", "u32"],
      returns: "u32"
    },
    editBufferGetTextRange: {
      args: ["u32", "u32", "u32", "ptr", "u32"],
      returns: "u32"
    },
    editBufferGetTextRangeByCoords: {
      args: ["u32", "u32", "u32", "u32", "u32", "ptr", "u32"],
      returns: "u32"
    },
    editorViewSetSelection: {
      args: ["u32", "u32", "u32", "ptr", "ptr"],
      returns: "void"
    },
    editorViewResetSelection: {
      args: ["u32"],
      returns: "void"
    },
    editorViewGetSelection: {
      args: ["u32"],
      returns: "u64"
    },
    editorViewSetLocalSelection: {
      args: ["u32", "i32", "i32", "i32", "i32", "ptr", "ptr", "bool", "bool"],
      returns: "bool"
    },
    editorViewUpdateSelection: {
      args: ["u32", "u32", "ptr", "ptr"],
      returns: "void"
    },
    editorViewUpdateLocalSelection: {
      args: ["u32", "i32", "i32", "i32", "i32", "ptr", "ptr", "bool", "bool"],
      returns: "bool"
    },
    editorViewResetLocalSelection: {
      args: ["u32"],
      returns: "void"
    },
    editorViewGetSelectedTextBytes: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    editorViewGetCursor: {
      args: ["u32", "ptr", "ptr"],
      returns: "void"
    },
    editorViewGetText: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    editorViewGetVisualCursor: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewMoveUpVisual: {
      args: ["u32"],
      returns: "void"
    },
    editorViewMoveDownVisual: {
      args: ["u32"],
      returns: "void"
    },
    editorViewDeleteSelectedText: {
      args: ["u32"],
      returns: "void"
    },
    editorViewSetCursorByOffset: {
      args: ["u32", "u32"],
      returns: "void"
    },
    editorViewGetNextWordBoundary: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewGetPrevWordBoundary: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewGetEOL: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewGetVisualSOL: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewGetVisualEOL: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    editorViewSetPlaceholderStyledText: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    editorViewSetTabIndicator: {
      args: ["u32", "u32"],
      returns: "void"
    },
    editorViewSetTabIndicatorColor: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    getArenaAllocatedBytes: {
      args: [],
      returns: "u64"
    },
    getBuildOptions: {
      args: ["ptr"],
      returns: "void"
    },
    getAllocatorStats: {
      args: ["ptr"],
      returns: "void"
    },
    createSyntaxStyle: {
      args: [],
      returns: "u32"
    },
    destroySyntaxStyle: {
      args: ["u32"],
      returns: "void"
    },
    syntaxStyleRegister: {
      args: ["u32", "ptr", "u32", "ptr", "ptr", "u32"],
      returns: "u32"
    },
    syntaxStyleResolveByName: {
      args: ["u32", "ptr", "u32"],
      returns: "u32"
    },
    syntaxStyleGetStyleCount: {
      args: ["u32"],
      returns: "u32"
    },
    getTerminalCapabilities: {
      args: ["u32", "ptr"],
      returns: "void"
    },
    processCapabilityResponse: {
      args: ["u32", "ptr", "u32"],
      returns: "void"
    },
    encodeUnicode: {
      args: ["ptr", "u32", "ptr", "ptr", "u8"],
      returns: "bool"
    },
    freeUnicode: {
      args: ["ptr", "u32"],
      returns: "void"
    },
    bufferDrawChar: {
      args: ["u32", "u32", "u32", "u32", "ptr", "ptr", "u32"],
      returns: "void"
    },
    yogaConfigCreate: {
      args: [],
      returns: "ptr"
    },
    yogaConfigFree: {
      args: ["ptr"],
      returns: "void"
    },
    yogaConfigSetUseWebDefaults: {
      args: ["ptr", "bool"],
      returns: "void"
    },
    yogaConfigGetUseWebDefaults: {
      args: ["ptr"],
      returns: "bool"
    },
    yogaConfigSetPointScaleFactor: {
      args: ["ptr", "f32"],
      returns: "void"
    },
    yogaConfigGetPointScaleFactor: {
      args: ["ptr"],
      returns: "f32"
    },
    yogaConfigSetErrata: {
      args: ["ptr", "u32"],
      returns: "void"
    },
    yogaConfigGetErrata: {
      args: ["ptr"],
      returns: "u32"
    },
    yogaConfigSetExperimentalFeatureEnabled: {
      args: ["ptr", "u32", "bool"],
      returns: "void"
    },
    yogaConfigIsExperimentalFeatureEnabled: {
      args: ["ptr", "u32"],
      returns: "bool"
    },
    yogaNodeCreate: {
      args: [],
      returns: "ptr"
    },
    yogaNodeCreateForOpenTUI: {
      args: [],
      returns: "ptr"
    },
    yogaNodeCreateWithConfig: {
      args: ["ptr"],
      returns: "ptr"
    },
    yogaNodeFree: {
      args: ["ptr"],
      returns: "void"
    },
    yogaNodeFreeRecursive: {
      args: ["ptr"],
      returns: "void"
    },
    yogaNodeReset: {
      args: ["ptr"],
      returns: "void"
    },
    yogaNodeCopyStyle: {
      args: ["ptr", "ptr"],
      returns: "void"
    },
    yogaNodeInsertChild: {
      args: ["ptr", "ptr", "u32"],
      returns: "void"
    },
    yogaNodeRemoveChild: {
      args: ["ptr", "ptr"],
      returns: "void"
    },
    yogaNodeRemoveAllChildren: {
      args: ["ptr"],
      returns: "void"
    },
    yogaNodeGetChild: {
      args: ["ptr", "u32"],
      returns: "ptr"
    },
    yogaNodeGetChildCount: {
      args: ["ptr"],
      returns: "u32"
    },
    yogaNodeGetParent: {
      args: ["ptr"],
      returns: "ptr"
    },
    yogaNodeCalculateLayout: {
      args: ["ptr", "f32", "f32", "u32"],
      returns: "void"
    },
    yogaNodeIsDirty: {
      args: ["ptr"],
      returns: "bool"
    },
    yogaNodeMarkDirty: {
      args: ["ptr"],
      returns: "void"
    },
    yogaNodeGetHasNewLayout: {
      args: ["ptr"],
      returns: "bool"
    },
    yogaNodeSetHasNewLayout: {
      args: ["ptr", "bool"],
      returns: "void"
    },
    yogaNodeSetIsReferenceBaseline: {
      args: ["ptr", "bool"],
      returns: "void"
    },
    yogaNodeIsReferenceBaseline: {
      args: ["ptr"],
      returns: "bool"
    },
    yogaNodeSetAlwaysFormsContainingBlock: {
      args: ["ptr", "bool"],
      returns: "void"
    },
    yogaNodeGetAlwaysFormsContainingBlock: {
      args: ["ptr"],
      returns: "bool"
    },
    yogaNodeGetComputedLayout: {
      args: ["ptr", "ptr"],
      returns: "void"
    },
    yogaNodeLayoutGetEdge: {
      args: ["ptr", "u32", "u32"],
      returns: "f32"
    },
    yogaNodeStyleSetEnum: {
      args: ["ptr", "u32", "u32"],
      returns: "void"
    },
    yogaNodeStyleGetEnum: {
      args: ["ptr", "u32"],
      returns: "u32"
    },
    yogaNodeStyleSetFloat: {
      args: ["ptr", "u32", "f32"],
      returns: "void"
    },
    yogaNodeStyleGetFloat: {
      args: ["ptr", "u32"],
      returns: "f32"
    },
    yogaNodeStyleSetBorder: {
      args: ["ptr", "u32", "f32"],
      returns: "void"
    },
    yogaNodeStyleGetBorder: {
      args: ["ptr", "u32"],
      returns: "f32"
    },
    yogaNodeStyleSetValue: {
      args: ["ptr", "u32", "u32", "u32", "f32"],
      returns: "void"
    },
    yogaNodeStyleGetValue: {
      args: ["ptr", "u32", "u32"],
      returns: "u64"
    },
    yogaNodeSetMeasureFunc: {
      args: ["ptr", "bool"],
      returns: "void"
    },
    yogaNodeUnsetMeasureFunc: {
      args: ["ptr"],
      returns: "void"
    },
    yogaNodeHasMeasureFunc: {
      args: ["ptr"],
      returns: "bool"
    },
    yogaNodeSetDirtiedFunc: {
      args: ["ptr", "bool"],
      returns: "void"
    },
    yogaNodeUnsetDirtiedFunc: {
      args: ["ptr"],
      returns: "void"
    },
    yogaStoreMeasureResult: {
      args: ["f32", "f32"],
      returns: "void"
    },
    yogaSetMeasureCallback: {
      args: ["ptr"],
      returns: "void"
    },
    yogaSetDirtiedCallback: {
      args: ["ptr"],
      returns: "void"
    },
    createAudioEngine: {
      args: ["ptr"],
      returns: "u32"
    },
    destroyAudioEngine: {
      args: ["u32"],
      returns: "void"
    },
    audioRefreshPlaybackDevices: {
      args: ["u32"],
      returns: "i32"
    },
    audioGetPlaybackDeviceCount: {
      args: ["u32"],
      returns: "u32"
    },
    audioGetPlaybackDeviceName: {
      args: ["u32", "u32", "ptr", "u32"],
      returns: "u32"
    },
    audioIsPlaybackDeviceDefault: {
      args: ["u32", "u32"],
      returns: "bool"
    },
    audioSelectPlaybackDevice: {
      args: ["u32", "u32"],
      returns: "i32"
    },
    audioClearPlaybackDeviceSelection: {
      args: ["u32"],
      returns: "void"
    },
    audioStart: {
      args: ["u32", "ptr"],
      returns: "i32"
    },
    audioStartMixer: {
      args: ["u32"],
      returns: "i32"
    },
    audioStop: {
      args: ["u32"],
      returns: "i32"
    },
    audioCreateStream: {
      args: ["u32", "ptr", "ptr"],
      returns: "i32"
    },
    audioWriteStream: {
      args: ["u32", "u32", "ptr", "u32"],
      returns: "i32"
    },
    audioEndStream: {
      args: ["u32", "u32"],
      returns: "i32"
    },
    audioRestartStream: {
      args: ["u32", "u32"],
      returns: "i32"
    },
    audioSetStreamVolume: {
      args: ["u32", "u32", "f32"],
      returns: "i32"
    },
    audioSetStreamPan: {
      args: ["u32", "u32", "f32"],
      returns: "i32"
    },
    audioSetStreamGroup: {
      args: ["u32", "u32", "u32"],
      returns: "i32"
    },
    audioGetStreamStats: {
      args: ["u32", "u32", "ptr"],
      returns: "i32"
    },
    audioCloseStream: {
      args: ["u32", "u32", "u32", "ptr"],
      returns: "i32"
    },
    audioLoad: {
      args: ["u32", "ptr", "u32", "ptr"],
      returns: "i32"
    },
    audioUnload: {
      args: ["u32", "u32"],
      returns: "i32"
    },
    audioPlay: {
      args: ["u32", "u32", "ptr", "ptr"],
      returns: "i32"
    },
    audioStopVoice: {
      args: ["u32", "u32"],
      returns: "i32"
    },
    audioSetVoiceGroup: {
      args: ["u32", "u32", "u32"],
      returns: "i32"
    },
    audioCreateGroup: {
      args: ["u32", "ptr", "u32", "ptr"],
      returns: "i32"
    },
    audioSetGroupVolume: {
      args: ["u32", "u32", "f32"],
      returns: "i32"
    },
    audioSetMasterVolume: {
      args: ["u32", "f32"],
      returns: "i32"
    },
    audioMixToBuffer: {
      args: ["u32", "ptr", "u32", "u8"],
      returns: "i32"
    },
    audioEnableTap: {
      args: ["u32", "bool", "u32"],
      returns: "i32"
    },
    audioReadTap: {
      args: ["u32", "ptr", "u32", "u8", "ptr"],
      returns: "i32"
    },
    audioGetStats: {
      args: ["u32", "ptr"],
      returns: "i32"
    },
    createNativeSpanFeed: {
      args: ["ptr"],
      returns: "ptr"
    },
    attachNativeSpanFeed: {
      args: ["ptr"],
      returns: "i32"
    },
    destroyNativeSpanFeed: {
      args: ["ptr"],
      returns: "void"
    },
    streamWrite: {
      args: ["ptr", "ptr", "u32"],
      returns: "i32"
    },
    streamCommit: {
      args: ["ptr"],
      returns: "i32"
    },
    streamDrainSpans: {
      args: ["ptr", "ptr", "u32"],
      returns: "u32"
    },
    streamClose: {
      args: ["ptr"],
      returns: "i32"
    },
    streamReserve: {
      args: ["ptr", "u32", "ptr"],
      returns: "i32"
    },
    streamCommitReserved: {
      args: ["ptr", "u32"],
      returns: "i32"
    },
    streamSetOptions: {
      args: ["ptr", "ptr"],
      returns: "i32"
    },
    streamGetStats: {
      args: ["ptr", "ptr"],
      returns: "i32"
    },
    streamSetCallback: {
      args: ["ptr", "ptr"],
      returns: "void"
    }
  });
  if (env.OTUI_DEBUG_FFI || env.OTUI_TRACE_FFI) {
    return {
      ...rawSymbols,
      symbols: convertToDebugSymbols(rawSymbols.symbols)
    };
  }
  return rawSymbols;
}
function convertToDebugSymbols(symbols) {
  if (!globalTraceSymbols) {
    globalTraceSymbols = {};
  }
  if (env.OTUI_DEBUG_FFI && !globalFFILogPath) {
    const now = new Date;
    const timestamp = now.toISOString().replace(/[:.]/g, "-").replace(/T/, "_").split("Z")[0];
    globalFFILogPath = `ffi_otui_debug_${timestamp}.log`;
  }
  const debugSymbols = {};
  let hasTracing = false;
  Object.entries(symbols).forEach(([key, value]) => {
    debugSymbols[key] = value;
  });
  if (env.OTUI_DEBUG_FFI && globalFFILogPath) {
    const logPath = globalFFILogPath;
    const writeSync = (msg) => {
      writeFileSync(logPath, msg + `
`, { flag: "a" });
    };
    Object.entries(symbols).forEach(([key, value]) => {
      if (typeof value === "function") {
        debugSymbols[key] = (...args) => {
          writeSync(`${key}(${args.map((arg) => String(arg)).join(", ")})`);
          const result = value(...args);
          writeSync(`${key} returned: ${String(result)}`);
          return result;
        };
      }
    });
  }
  if (env.OTUI_TRACE_FFI) {
    hasTracing = true;
    Object.entries(symbols).forEach(([key, value]) => {
      if (typeof value === "function") {
        if (!globalTraceSymbols[key]) {
          globalTraceSymbols[key] = [];
        }
        const originalFunc = debugSymbols[key];
        debugSymbols[key] = (...args) => {
          const start = performance.now();
          const result = originalFunc(...args);
          const end = performance.now();
          globalTraceSymbols[key].push(end - start);
          return result;
        };
      }
    });
  }
  if ((env.OTUI_DEBUG_FFI || env.OTUI_TRACE_FFI) && !exitHandlerRegistered) {
    exitHandlerRegistered = true;
    process.on("exit", () => {
      if (globalTraceSymbols) {
        const allStats = [];
        for (const [key, timings] of Object.entries(globalTraceSymbols)) {
          if (!Array.isArray(timings) || timings.length === 0) {
            continue;
          }
          const sortedTimings = [...timings].sort((a, b) => a - b);
          const count = sortedTimings.length;
          const total = sortedTimings.reduce((acc, t2) => acc + t2, 0);
          const average = total / count;
          const min = sortedTimings[0];
          const max = sortedTimings[count - 1];
          const medianIndex = Math.floor(count / 2);
          const p90Index = Math.floor(count * 0.9);
          const p99Index = Math.floor(count * 0.99);
          const median = sortedTimings[medianIndex];
          const p90 = sortedTimings[Math.min(p90Index, count - 1)];
          const p99 = sortedTimings[Math.min(p99Index, count - 1)];
          allStats.push({
            name: key,
            count,
            total,
            average,
            min,
            max,
            median,
            p90,
            p99
          });
        }
        allStats.sort((a, b) => b.total - a.total);
        const lines = [];
        lines.push(`
--- OpenTUI FFI Call Performance ---`);
        lines.push("Sorted by total time spent (descending)");
        lines.push("-------------------------------------------------------------------------------------------------------------------------");
        if (allStats.length === 0) {
          lines.push("No trace data collected or all symbols had zero calls.");
        } else {
          const nameHeader = "Symbol";
          const callsHeader = "Calls";
          const totalHeader = "Total (ms)";
          const avgHeader = "Avg (ms)";
          const minHeader = "Min (ms)";
          const maxHeader = "Max (ms)";
          const medHeader = "Med (ms)";
          const p90Header = "P90 (ms)";
          const p99Header = "P99 (ms)";
          const nameWidth = Math.max(nameHeader.length, ...allStats.map((s) => s.name.length));
          const countWidth = Math.max(callsHeader.length, ...allStats.map((s) => String(s.count).length));
          const totalWidth = Math.max(totalHeader.length, ...allStats.map((s) => s.total.toFixed(2).length));
          const avgWidth = Math.max(avgHeader.length, ...allStats.map((s) => s.average.toFixed(2).length));
          const statWidthMin = Math.max(minHeader.length, ...allStats.map((s) => s.min.toFixed(2).length));
          const statWidthMax = Math.max(maxHeader.length, ...allStats.map((s) => s.max.toFixed(2).length));
          const medianWidth = Math.max(medHeader.length, ...allStats.map((s) => s.median.toFixed(2).length));
          const p90Width = Math.max(p90Header.length, ...allStats.map((s) => s.p90.toFixed(2).length));
          const p99Width = Math.max(p99Header.length, ...allStats.map((s) => s.p99.toFixed(2).length));
          lines.push(`${nameHeader.padEnd(nameWidth)} | ` + `${callsHeader.padStart(countWidth)} | ` + `${totalHeader.padStart(totalWidth)} | ` + `${avgHeader.padStart(avgWidth)} | ` + `${minHeader.padStart(statWidthMin)} | ` + `${maxHeader.padStart(statWidthMax)} | ` + `${medHeader.padStart(medianWidth)} | ` + `${p90Header.padStart(p90Width)} | ` + `${p99Header.padStart(p99Width)}`);
          lines.push(`${"-".repeat(nameWidth)}-+-${"-".repeat(countWidth)}-+-${"-".repeat(totalWidth)}-+-${"-".repeat(avgWidth)}-+-${"-".repeat(statWidthMin)}-+-${"-".repeat(statWidthMax)}-+-${"-".repeat(medianWidth)}-+-${"-".repeat(p90Width)}-+-${"-".repeat(p99Width)}`);
          allStats.forEach((stat) => {
            lines.push(`${stat.name.padEnd(nameWidth)} | ` + `${String(stat.count).padStart(countWidth)} | ` + `${stat.total.toFixed(2).padStart(totalWidth)} | ` + `${stat.average.toFixed(2).padStart(avgWidth)} | ` + `${stat.min.toFixed(2).padStart(statWidthMin)} | ` + `${stat.max.toFixed(2).padStart(statWidthMax)} | ` + `${stat.median.toFixed(2).padStart(medianWidth)} | ` + `${stat.p90.toFixed(2).padStart(p90Width)} | ` + `${stat.p99.toFixed(2).padStart(p99Width)}`);
          });
        }
        lines.push("-------------------------------------------------------------------------------------------------------------------------");
        const output = lines.join(`
`);
        console.log(output);
        try {
          const now = new Date;
          const timestamp = now.toISOString().replace(/[:.]/g, "-").replace(/T/, "_").split("Z")[0];
          const traceFilePath = `ffi_otui_trace_${timestamp}.log`;
          writeFile(traceFilePath, output).catch((error) => {
            console.error("Failed to write FFI trace file:", error);
          });
        } catch (e) {
          console.error("Failed to write FFI trace file:", e);
        }
      }
    });
  }
  return debugSymbols;
}
var LogLevel2;
((LogLevel3) => {
  LogLevel3[LogLevel3["Error"] = 0] = "Error";
  LogLevel3[LogLevel3["Warn"] = 1] = "Warn";
  LogLevel3[LogLevel3["Info"] = 2] = "Info";
  LogLevel3[LogLevel3["Debug"] = 3] = "Debug";
})(LogLevel2 ||= {});
var NativeMeasureTargetKind = {
  None: 0,
  TextBufferView: 1,
  EditorView: 2
};

class FFIRenderLib {
  opentui;
  encoder = new TextEncoder;
  decoder = new TextDecoder;
  logCallbackWrapper = null;
  eventCallbackWrapper = null;
  eventSinkPtr = null;
  _nativeEvents = new EventEmitter4;
  _anyEventHandlers = [];
  nativeSpanFeedCallbackWrapper = null;
  nativeSpanFeedHandlers = new Map;
  createNativeRenderable() {
    const handle = this.opentui.symbols.createNativeRenderable();
    if (!handle)
      throw new Error("Failed to create native renderable");
    return handle;
  }
  destroyNativeRenderable(handle) {
    this.opentui.symbols.destroyNativeRenderable(handle);
  }
  nativeRenderableAttachYogaNode(handle, node) {
    return Boolean(this.opentui.symbols.nativeRenderableAttachYogaNode(handle, node));
  }
  nativeRenderableSetMeasureTarget(handle, kind, target) {
    return Boolean(this.opentui.symbols.nativeRenderableSetMeasureTarget(handle, kind, target));
  }
  constructor(libPath) {
    this.opentui = getOpenTUILib(libPath);
    try {
      this.setupLogging();
      this.setupEventBus();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  setupLogging() {
    if (this.logCallbackWrapper) {
      return;
    }
    const logCallback = this.opentui.createCallback((level, msgPtr, msgLen) => {
      try {
        if (msgLen === 0 || !msgPtr) {
          return;
        }
        const msgBuffer = toArrayBuffer(msgPtr, 0, msgLen);
        const msgBytes = new Uint8Array(msgBuffer);
        const message = this.decoder.decode(msgBytes);
        switch (level) {
          case 0 /* Error */:
            console.error(message);
            break;
          case 1 /* Warn */:
            console.warn(message);
            break;
          case 2 /* Info */:
            console.info(message);
            break;
          case 3 /* Debug */:
            console.debug(message);
            break;
          default:
            console.log(message);
        }
      } catch (error) {
        console.error("Error in Zig log callback:", error);
      }
    }, {
      args: ["u8", "ptr", "u32"],
      returns: "void"
    });
    this.logCallbackWrapper = logCallback;
    if (!logCallback.ptr) {
      throw new Error("Failed to create log callback");
    }
    this.setLogCallback(logCallback.ptr);
  }
  setLogCallback(callbackPtr) {
    this.opentui.symbols.setLogCallback(callbackPtr);
  }
  dispose() {
    try {
      if (this.eventSinkPtr) {
        this.opentui.symbols.destroyEventSink(this.eventSinkPtr);
        this.eventSinkPtr = null;
      }
      this.yogaSetMeasureCallback(null);
      this.yogaSetDirtiedCallback(null);
      this.setLogCallback(null);
    } finally {
      try {
        this.opentui.close();
      } finally {
        this.eventCallbackWrapper = null;
        this.logCallbackWrapper = null;
        this.nativeSpanFeedCallbackWrapper = null;
        this.nativeSpanFeedHandlers.clear();
      }
    }
  }
  setupEventBus() {
    if (this.eventCallbackWrapper) {
      return;
    }
    const eventCallback = this.opentui.createCallback((namePtr, nameLen, dataPtr, dataLen) => {
      try {
        if (nameLen === 0 || !namePtr) {
          return;
        }
        const eventName = this.decoder.decode(toArrayBuffer(namePtr, 0, nameLen));
        const eventData = dataLen > 0 && dataPtr ? toArrayBuffer(dataPtr, 0, dataLen).slice(0) : new ArrayBuffer(0);
        queueMicrotask(() => {
          this._nativeEvents.emit(eventName, eventData);
          for (const handler of this._anyEventHandlers) {
            handler(eventName, eventData);
          }
        });
      } catch (error) {
        console.error("Error in native event callback:", error);
      }
    }, {
      args: ["ptr", "u32", "ptr", "u32"],
      returns: "void"
    });
    this.eventCallbackWrapper = eventCallback;
    if (!eventCallback.ptr) {
      throw new Error("Failed to create event callback");
    }
    this.eventSinkPtr = this.opentui.symbols.createEventSink(eventCallback.ptr);
    if (!this.eventSinkPtr) {
      eventCallback.close();
      this.eventCallbackWrapper = null;
      throw new Error("Failed to create native event sink");
    }
  }
  ensureNativeSpanFeedCallback() {
    if (this.nativeSpanFeedCallbackWrapper) {
      return this.nativeSpanFeedCallbackWrapper;
    }
    const callback = this.opentui.createCallback((streamPtr, eventId, arg0, arg1) => {
      const handler = this.nativeSpanFeedHandlers.get(streamPtr);
      if (handler) {
        handler(eventId, arg0, arg1);
      }
    }, {
      args: ["ptr", "u32", "ptr", "u64"],
      returns: "void"
    });
    this.nativeSpanFeedCallbackWrapper = callback;
    if (!callback.ptr) {
      throw new Error("Failed to create native span feed callback");
    }
    return callback;
  }
  createRenderer(width, height, options = {}) {
    const bufferedOutputKind = options.bufferedOutput === "memory" ? 1 : 0;
    const remoteMode = options.remote === undefined ? 0 : options.remote ? 2 : 1;
    const feedPtr = options.feedPtr ?? null;
    const renderer = this.opentui.symbols.createRenderer(width, height, bufferedOutputKind, remoteMode, feedPtr);
    return renderer ? renderer : null;
  }
  setTerminalEnvVar(renderer, key, value) {
    const keyBytes = this.encoder.encode(key);
    const valueBytes = this.encoder.encode(value);
    return this.opentui.symbols.setTerminalEnvVar(renderer, ptrOrNull(keyBytes), keyBytes.byteLength, ptrOrNull(valueBytes), valueBytes.byteLength);
  }
  destroyRenderer(renderer) {
    this.opentui.symbols.destroyRenderer(renderer);
  }
  setUseThread(renderer, useThread) {
    this.opentui.symbols.setUseThread(renderer, ffiBool(useThread));
  }
  setClearOnShutdown(renderer, clear) {
    this.opentui.symbols.setClearOnShutdown(renderer, ffiBool(clear));
  }
  setBackgroundColor(renderer, color) {
    this.opentui.symbols.setBackgroundColor(renderer, rgbaPtr(color));
  }
  setRenderOffset(renderer, offset) {
    this.opentui.symbols.setRenderOffset(renderer, offset);
  }
  resetSplitScrollback(renderer, seedRows, pinnedRenderOffset) {
    return this.opentui.symbols.resetSplitScrollback(renderer, seedRows, pinnedRenderOffset);
  }
  syncSplitScrollback(renderer, pinnedRenderOffset) {
    return this.opentui.symbols.syncSplitScrollback(renderer, pinnedRenderOffset);
  }
  getSplitOutputOffset(renderer, surfaceOffset) {
    return this.opentui.symbols.getSplitOutputOffset(renderer, surfaceOffset);
  }
  setPendingSplitFooterTransition(renderer, mode, sourceTopLine, sourceHeight, targetTopLine, targetHeight, scrollLines) {
    this.opentui.symbols.setPendingSplitFooterTransition(renderer, mode, sourceTopLine, sourceHeight, targetTopLine, targetHeight, scrollLines);
  }
  clearPendingSplitFooterTransition(renderer) {
    this.opentui.symbols.clearPendingSplitFooterTransition(renderer);
  }
  updateStats(renderer, time, fps, frameCallbackTime) {
    this.opentui.symbols.updateStats(renderer, time, fps, frameCallbackTime);
  }
  updateMemoryStats(renderer, heapUsed, heapTotal, arrayBuffers) {
    this.opentui.symbols.updateMemoryStats(renderer, heapUsed, heapTotal, arrayBuffers);
  }
  getRenderStats(renderer) {
    const statsBuffer = new ArrayBuffer(NativeRenderStatsStruct.size);
    this.opentui.symbols.getRenderStats(renderer, ptr(statsBuffer));
    const stats = NativeRenderStatsStruct.unpack(statsBuffer);
    return {
      nativeLastFrameTime: stats.lastFrameTime,
      nativeAverageFrameTime: stats.averageFrameTime,
      nativeFrameCount: toNumber(stats.frameCount),
      cellsUpdated: stats.cellsUpdated,
      averageCellsUpdated: stats.averageCellsUpdated,
      nativeRenderTime: stats.renderTimeValid ? stats.renderTime : undefined,
      nativeStdoutWriteTime: stats.stdoutWriteTimeValid ? stats.stdoutWriteTime : undefined
    };
  }
  getNextBuffer(renderer) {
    const bufferPtr = this.opentui.symbols.getNextBuffer(renderer);
    if (!bufferPtr) {
      throw new Error("Failed to get next buffer");
    }
    const width = this.opentui.symbols.getBufferWidth(bufferPtr);
    const height = this.opentui.symbols.getBufferHeight(bufferPtr);
    return new OptimizedBuffer(this, bufferPtr, width, height, { id: "next buffer", widthMethod: "unicode" });
  }
  getCurrentBuffer(renderer) {
    const bufferPtr = this.opentui.symbols.getCurrentBuffer(renderer);
    if (!bufferPtr) {
      throw new Error("Failed to get current buffer");
    }
    const width = this.opentui.symbols.getBufferWidth(bufferPtr);
    const height = this.opentui.symbols.getBufferHeight(bufferPtr);
    return new OptimizedBuffer(this, bufferPtr, width, height, { id: "current buffer", widthMethod: "unicode" });
  }
  rendererSetPaletteState(renderer, palette, defaultForeground, defaultBackground, paletteEpoch) {
    const paletteBuffer = new Uint16Array(palette.length * 4);
    for (let index = 0;index < palette.length; index++) {
      paletteBuffer.set(palette[index].buffer, index * 4);
    }
    this.opentui.symbols.rendererSetPaletteState(renderer, ptr(paletteBuffer), palette.length, rgbaPtr(defaultForeground), rgbaPtr(defaultBackground), paletteEpoch >>> 0);
  }
  bufferGetCharPtr(buffer) {
    const ptr3 = this.opentui.symbols.bufferGetCharPtr(buffer);
    if (!ptr3) {
      throw new Error("Failed to get char pointer");
    }
    return ptr3;
  }
  bufferGetFgPtr(buffer) {
    const ptr3 = this.opentui.symbols.bufferGetFgPtr(buffer);
    if (!ptr3) {
      throw new Error("Failed to get fg pointer");
    }
    return ptr3;
  }
  bufferGetBgPtr(buffer) {
    const ptr3 = this.opentui.symbols.bufferGetBgPtr(buffer);
    if (!ptr3) {
      throw new Error("Failed to get bg pointer");
    }
    return ptr3;
  }
  bufferGetAttributesPtr(buffer) {
    const ptr3 = this.opentui.symbols.bufferGetAttributesPtr(buffer);
    if (!ptr3) {
      throw new Error("Failed to get attributes pointer");
    }
    return ptr3;
  }
  bufferGetRespectAlpha(buffer) {
    return this.opentui.symbols.bufferGetRespectAlpha(buffer);
  }
  bufferSetRespectAlpha(buffer, respectAlpha) {
    this.opentui.symbols.bufferSetRespectAlpha(buffer, ffiBool(respectAlpha));
  }
  bufferGetId(buffer) {
    const maxLen = 256;
    const outBuffer = new Uint8Array(maxLen);
    const actualLen = this.opentui.symbols.bufferGetId(buffer, ptr(outBuffer), maxLen);
    return this.decoder.decode(outBuffer.slice(0, actualLen));
  }
  bufferGetRealCharSize(buffer) {
    return this.opentui.symbols.bufferGetRealCharSize(buffer);
  }
  bufferWriteResolvedChars(buffer, outputBuffer, addLineBreaks) {
    return this.opentui.symbols.bufferWriteResolvedChars(buffer, ptrOrNull(outputBuffer), outputBuffer.byteLength, ffiBool(addLineBreaks));
  }
  getBufferWidth(buffer) {
    return this.opentui.symbols.getBufferWidth(buffer);
  }
  getBufferHeight(buffer) {
    return this.opentui.symbols.getBufferHeight(buffer);
  }
  bufferClear(buffer, color) {
    this.opentui.symbols.bufferClear(buffer, rgbaPtr(color));
  }
  bufferDrawText(buffer, text, x, y, color, bgColor, attributes) {
    const textBytes = this.encoder.encode(text);
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = rgbaPtr(color);
    this.opentui.symbols.bufferDrawText(buffer, ptrOrNull(textBytes), textBytes.byteLength, x, y, fg2, bg2, attributes ?? 0);
  }
  bufferSetCellWithAlphaBlending(buffer, x, y, char, color, bgColor, attributes) {
    const charPtr = char.codePointAt(0) ?? " ".codePointAt(0);
    const bg2 = rgbaPtr(bgColor);
    const fg2 = rgbaPtr(color);
    this.opentui.symbols.bufferSetCellWithAlphaBlending(buffer, x, y, charPtr, fg2, bg2, attributes ?? 0);
  }
  bufferSetCell(buffer, x, y, char, color, bgColor, attributes) {
    const charPtr = char.codePointAt(0) ?? " ".codePointAt(0);
    const bg2 = rgbaPtr(bgColor);
    const fg2 = rgbaPtr(color);
    this.opentui.symbols.bufferSetCell(buffer, x, y, charPtr, fg2, bg2, attributes ?? 0);
  }
  bufferFillRect(buffer, x, y, width, height, color) {
    const bg2 = rgbaPtr(color);
    this.opentui.symbols.bufferFillRect(buffer, x, y, width, height, bg2);
  }
  bufferColorMatrix(buffer, matrixPtr, cellMaskPtr, cellMaskCount, strength, target) {
    this.opentui.symbols.bufferColorMatrix(buffer, matrixPtr, cellMaskPtr, cellMaskCount, strength, target);
  }
  bufferColorMatrixUniform(buffer, matrixPtr, strength, target) {
    this.opentui.symbols.bufferColorMatrixUniform(buffer, matrixPtr, strength, target);
  }
  bufferDrawSuperSampleBuffer(buffer, x, y, pixelDataPtr, pixelDataLength, format, alignedBytesPerRow) {
    const formatId = format === "bgra8unorm" ? 0 : 1;
    this.opentui.symbols.bufferDrawSuperSampleBuffer(buffer, x, y, pixelDataPtr, pixelDataLength, formatId, alignedBytesPerRow);
  }
  bufferDrawPackedBuffer(buffer, dataPtr, dataLen, posX, posY, terminalWidthCells, terminalHeightCells) {
    this.opentui.symbols.bufferDrawPackedBuffer(buffer, dataPtr, dataLen, posX, posY, terminalWidthCells, terminalHeightCells);
  }
  bufferDrawGrayscaleBuffer(buffer, posX, posY, intensitiesPtr, srcWidth, srcHeight, fg2, bg2) {
    this.opentui.symbols.bufferDrawGrayscaleBuffer(buffer, posX, posY, intensitiesPtr, srcWidth, srcHeight, optionalRgbaPtr(fg2), optionalRgbaPtr(bg2));
  }
  bufferDrawGrayscaleBufferSupersampled(buffer, posX, posY, intensitiesPtr, srcWidth, srcHeight, fg2, bg2) {
    this.opentui.symbols.bufferDrawGrayscaleBufferSupersampled(buffer, posX, posY, intensitiesPtr, srcWidth, srcHeight, optionalRgbaPtr(fg2), optionalRgbaPtr(bg2));
  }
  bufferDrawGrid(buffer, borderChars, borderFg, borderBg, columnOffsets, columnCount, rowOffsets, rowCount, options) {
    const optionsBuffer = GridDrawOptionsStruct.pack({
      drawInner: options.drawInner,
      drawOuter: options.drawOuter
    });
    this.opentui.symbols.bufferDrawGrid(buffer, ptr(borderChars), rgbaPtr(borderFg), rgbaPtr(borderBg), ptr(columnOffsets), columnCount, ptr(rowOffsets), rowCount, ptr(optionsBuffer));
  }
  bufferDrawBox(buffer, x, y, width, height, borderChars, packedOptions, borderColor, backgroundColor, titleColor, title, bottomTitle) {
    const titleBytes = title ? this.encoder.encode(title) : null;
    const titleLen = titleBytes?.byteLength ?? 0;
    const titlePtr = titleBytes ? ptr(titleBytes) : null;
    const bottomTitleBytes = bottomTitle ? this.encoder.encode(bottomTitle) : null;
    const bottomTitleLen = bottomTitleBytes?.byteLength ?? 0;
    const bottomTitlePtr = bottomTitleBytes ? ptr(bottomTitleBytes) : null;
    this.opentui.symbols.bufferDrawBox(buffer, x, y, width, height, ptr(borderChars), packedOptions, rgbaPtr(borderColor), rgbaPtr(backgroundColor), rgbaPtr(titleColor), titlePtr, titleLen, bottomTitlePtr, bottomTitleLen);
  }
  bufferResize(buffer, width, height) {
    this.opentui.symbols.bufferResize(buffer, width, height);
  }
  linkAlloc(url) {
    const urlBytes = this.encoder.encode(url);
    return this.opentui.symbols.linkAlloc(ptrOrNull(urlBytes), urlBytes.byteLength);
  }
  linkGetUrl(linkId, maxLen = 512) {
    const outBuffer = new Uint8Array(maxLen);
    const actualLen = this.opentui.symbols.linkGetUrl(linkId, ptrOrNull(outBuffer), maxLen);
    return this.decoder.decode(outBuffer.slice(0, actualLen));
  }
  attributesWithLink(baseAttributes, linkId) {
    return this.opentui.symbols.attributesWithLink(baseAttributes, linkId);
  }
  attributesGetLinkId(attributes) {
    return this.opentui.symbols.attributesGetLinkId(attributes);
  }
  resizeRenderer(renderer, width, height) {
    this.opentui.symbols.resizeRenderer(renderer, width, height);
  }
  setCursorPosition(renderer, x, y, visible) {
    this.opentui.symbols.setCursorPosition(renderer, x, y, ffiBool(visible));
  }
  setCursorColor(renderer, color) {
    this.opentui.symbols.setCursorColor(renderer, rgbaPtr(color));
  }
  getCursorState(renderer) {
    const cursorBuffer = new ArrayBuffer(CursorStateStruct.size);
    this.opentui.symbols.getCursorState(renderer, ptr(cursorBuffer));
    const struct = CursorStateStruct.unpack(cursorBuffer);
    return {
      x: struct.x,
      y: struct.y,
      visible: struct.visible,
      style: CURSOR_ID_TO_STYLE[struct.style] ?? "block",
      blinking: struct.blinking,
      color: RGBA.fromValues(struct.r, struct.g, struct.b, struct.a)
    };
  }
  setCursorStyleOptions(renderer, options) {
    const style = options.style != null ? CURSOR_STYLE_TO_ID[options.style] : 255;
    const blinking = options.blinking != null ? options.blinking ? 1 : 0 : 255;
    const cursor = options.cursor != null ? MOUSE_STYLE_TO_ID[options.cursor] : 255;
    const buffer = CursorStyleOptionsStruct.pack({ style, blinking, color: options.color, cursor });
    this.opentui.symbols.setCursorStyleOptions(renderer, buffer);
  }
  render(renderer, force) {
    return this.opentui.symbols.render(renderer, ffiBool(force));
  }
  unpackRenderOperationResult(value) {
    const packed = typeof value === "bigint" ? value : BigInt(value);
    return {
      renderOffset: Number(packed & 0xffffffffn),
      status: Number(packed >> 32n & 0xffn)
    };
  }
  repaintSplitFooter(renderer, pinnedRenderOffset, force) {
    return this.unpackRenderOperationResult(this.opentui.symbols.repaintSplitFooter(renderer, pinnedRenderOffset, ffiBool(force)));
  }
  commitSplitFooterSnapshot(renderer, snapshot, rowColumns, startOnNewLine, trailingNewline, pinnedRenderOffset, force, beginFrame = true, finalizeFrame = true) {
    return this.unpackRenderOperationResult(this.opentui.symbols.commitSplitFooterSnapshot(renderer, snapshot.ptr, rowColumns, ffiBool(startOnNewLine), ffiBool(trailingNewline), pinnedRenderOffset, ffiBool(force), ffiBool(beginFrame), ffiBool(finalizeFrame)));
  }
  createOptimizedBuffer(width, height, widthMethod, respectAlpha = false, id) {
    if (Number.isNaN(width) || Number.isNaN(height)) {
      console.error(new Error(`Invalid dimensions for OptimizedBuffer: ${width}x${height}`).stack);
    }
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1;
    const idToUse = id || "unnamed buffer";
    const idBytes = this.encoder.encode(idToUse);
    const bufferPtr = this.opentui.symbols.createOptimizedBuffer(width, height, ffiBool(respectAlpha), widthMethodCode, ptr(idBytes), idBytes.byteLength);
    if (!bufferPtr) {
      throw new Error(`Failed to create optimized buffer: ${width}x${height}`);
    }
    return new OptimizedBuffer(this, bufferPtr, width, height, { respectAlpha, id, widthMethod });
  }
  destroyOptimizedBuffer(bufferPtr) {
    this.opentui.symbols.destroyOptimizedBuffer(bufferPtr);
  }
  drawFrameBuffer(targetBufferPtr, destX, destY, bufferPtr, sourceX, sourceY, sourceWidth, sourceHeight) {
    const srcX = sourceX ?? 0;
    const srcY = sourceY ?? 0;
    const srcWidth = sourceWidth ?? 0;
    const srcHeight = sourceHeight ?? 0;
    this.opentui.symbols.drawFrameBuffer(targetBufferPtr, destX, destY, bufferPtr, srcX, srcY, srcWidth, srcHeight);
  }
  setDebugOverlay(renderer, enabled, corner) {
    this.opentui.symbols.setDebugOverlay(renderer, ffiBool(enabled), corner);
  }
  clearTerminal(renderer) {
    this.opentui.symbols.clearTerminal(renderer);
  }
  setTerminalTitle(renderer, title) {
    const titleBytes = this.encoder.encode(title);
    this.opentui.symbols.setTerminalTitle(renderer, ptrOrNull(titleBytes), titleBytes.byteLength);
  }
  copyToClipboardOSC52(renderer, target, textUtf8) {
    if (textUtf8.byteLength > 4294967295)
      return false;
    return Boolean(this.opentui.symbols.copyToClipboardOSC52(renderer, target, ptrOrNull(textUtf8), textUtf8.byteLength));
  }
  clearClipboardOSC52(renderer, target) {
    return Boolean(this.opentui.symbols.clearClipboardOSC52(renderer, target));
  }
  triggerNotification(renderer, message, title) {
    const messageBytes = this.encoder.encode(message);
    const titleBytes = title === undefined ? null : this.encoder.encode(title);
    return Boolean(this.opentui.symbols.triggerNotification(renderer, messageBytes, messageBytes.length, titleBytes, titleBytes?.length ?? 0));
  }
  addToHitGrid(renderer, x, y, width, height, id) {
    this.opentui.symbols.addToHitGrid(renderer, x, y, width, height, id);
  }
  clearCurrentHitGrid(renderer) {
    this.opentui.symbols.clearCurrentHitGrid(renderer);
  }
  hitGridPushScissorRect(renderer, x, y, width, height) {
    this.opentui.symbols.hitGridPushScissorRect(renderer, x, y, width, height);
  }
  hitGridPopScissorRect(renderer) {
    this.opentui.symbols.hitGridPopScissorRect(renderer);
  }
  hitGridClearScissorRects(renderer) {
    this.opentui.symbols.hitGridClearScissorRects(renderer);
  }
  addToCurrentHitGridClipped(renderer, x, y, width, height, id) {
    this.opentui.symbols.addToCurrentHitGridClipped(renderer, x, y, width, height, id);
  }
  checkHit(renderer, x, y) {
    return this.opentui.symbols.checkHit(renderer, x, y);
  }
  getHitGridDirty(renderer) {
    return this.opentui.symbols.getHitGridDirty(renderer);
  }
  dumpHitGrid(renderer) {
    this.opentui.symbols.dumpHitGrid(renderer);
  }
  dumpBuffers(renderer, timestamp) {
    const ts = timestamp ?? Date.now();
    this.opentui.symbols.dumpBuffers(renderer, ts);
  }
  dumpOutputBuffer(renderer, timestamp) {
    const ts = timestamp ?? Date.now();
    this.opentui.symbols.dumpOutputBuffer(renderer, ts);
  }
  restoreTerminalModes(renderer) {
    this.opentui.symbols.restoreTerminalModes(renderer);
  }
  enableMouse(renderer, enableMovement) {
    this.opentui.symbols.enableMouse(renderer, ffiBool(enableMovement));
  }
  disableMouse(renderer) {
    this.opentui.symbols.disableMouse(renderer);
  }
  enableKittyKeyboard(renderer, flags) {
    this.opentui.symbols.enableKittyKeyboard(renderer, flags);
  }
  disableKittyKeyboard(renderer) {
    this.opentui.symbols.disableKittyKeyboard(renderer);
  }
  setKittyKeyboardFlags(renderer, flags) {
    this.opentui.symbols.setKittyKeyboardFlags(renderer, flags);
  }
  getKittyKeyboardFlags(renderer) {
    return this.opentui.symbols.getKittyKeyboardFlags(renderer);
  }
  setupTerminal(renderer, useAlternateScreen) {
    this.opentui.symbols.setupTerminal(renderer, ffiBool(useAlternateScreen));
  }
  suspendRenderer(renderer) {
    this.opentui.symbols.suspendRenderer(renderer);
  }
  resumeRenderer(renderer) {
    this.opentui.symbols.resumeRenderer(renderer);
  }
  queryPixelResolution(renderer) {
    this.opentui.symbols.queryPixelResolution(renderer);
  }
  queryThemeColors(renderer) {
    this.opentui.symbols.queryThemeColors(renderer);
  }
  writeOut(renderer, data) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.length === 0)
      return;
    this.opentui.symbols.writeOut(renderer, ptrOrNull(bytes), bytes.byteLength);
  }
  yogaConfigCreate() {
    const config = this.opentui.symbols.yogaConfigCreate();
    if (!config)
      throw new Error("Failed to create Yoga config");
    return config;
  }
  yogaConfigFree(config) {
    this.opentui.symbols.yogaConfigFree(config);
  }
  yogaConfigSetUseWebDefaults(config, enabled) {
    this.opentui.symbols.yogaConfigSetUseWebDefaults(config, ffiBool(enabled));
  }
  yogaConfigGetUseWebDefaults(config) {
    return this.opentui.symbols.yogaConfigGetUseWebDefaults(config);
  }
  yogaConfigSetPointScaleFactor(config, pointScaleFactor) {
    this.opentui.symbols.yogaConfigSetPointScaleFactor(config, pointScaleFactor);
  }
  yogaConfigGetPointScaleFactor(config) {
    return this.opentui.symbols.yogaConfigGetPointScaleFactor(config);
  }
  yogaConfigSetErrata(config, errata) {
    this.opentui.symbols.yogaConfigSetErrata(config, errata);
  }
  yogaConfigGetErrata(config) {
    return this.opentui.symbols.yogaConfigGetErrata(config);
  }
  yogaConfigSetExperimentalFeatureEnabled(config, feature, enabled) {
    this.opentui.symbols.yogaConfigSetExperimentalFeatureEnabled(config, feature, ffiBool(enabled));
  }
  yogaConfigIsExperimentalFeatureEnabled(config, feature) {
    return this.opentui.symbols.yogaConfigIsExperimentalFeatureEnabled(config, feature);
  }
  yogaNodeCreate() {
    const node = this.opentui.symbols.yogaNodeCreate();
    if (!node)
      throw new Error("Failed to create Yoga node");
    return node;
  }
  yogaNodeCreateForOpenTUI() {
    const node = this.opentui.symbols.yogaNodeCreateForOpenTUI();
    if (!node)
      throw new Error("Failed to create OpenTUI Yoga node");
    return node;
  }
  yogaNodeCreateWithConfig(config) {
    const node = this.opentui.symbols.yogaNodeCreateWithConfig(config);
    if (!node)
      throw new Error("Failed to create Yoga node");
    return node;
  }
  yogaNodeFree(node) {
    this.opentui.symbols.yogaNodeFree(node);
  }
  yogaNodeFreeRecursive(node) {
    this.opentui.symbols.yogaNodeFreeRecursive(node);
  }
  yogaNodeReset(node) {
    this.opentui.symbols.yogaNodeReset(node);
  }
  yogaNodeCopyStyle(dstNode, srcNode) {
    this.opentui.symbols.yogaNodeCopyStyle(dstNode, srcNode);
  }
  yogaNodeInsertChild(node, child, index) {
    this.opentui.symbols.yogaNodeInsertChild(node, child, index);
  }
  yogaNodeRemoveChild(node, child) {
    this.opentui.symbols.yogaNodeRemoveChild(node, child);
  }
  yogaNodeRemoveAllChildren(node) {
    this.opentui.symbols.yogaNodeRemoveAllChildren(node);
  }
  yogaNodeGetChild(node, index) {
    return this.opentui.symbols.yogaNodeGetChild(node, index) || null;
  }
  yogaNodeGetChildCount(node) {
    return this.opentui.symbols.yogaNodeGetChildCount(node);
  }
  yogaNodeGetParent(node) {
    return this.opentui.symbols.yogaNodeGetParent(node) || null;
  }
  yogaNodeCalculateLayout(node, width, height, direction) {
    this.opentui.symbols.yogaNodeCalculateLayout(node, width, height, direction);
  }
  yogaNodeIsDirty(node) {
    return this.opentui.symbols.yogaNodeIsDirty(node);
  }
  yogaNodeMarkDirty(node) {
    this.opentui.symbols.yogaNodeMarkDirty(node);
  }
  yogaNodeGetHasNewLayout(node) {
    return this.opentui.symbols.yogaNodeGetHasNewLayout(node);
  }
  yogaNodeSetHasNewLayout(node, hasNewLayout) {
    this.opentui.symbols.yogaNodeSetHasNewLayout(node, ffiBool(hasNewLayout));
  }
  yogaNodeSetIsReferenceBaseline(node, isReferenceBaseline) {
    this.opentui.symbols.yogaNodeSetIsReferenceBaseline(node, ffiBool(isReferenceBaseline));
  }
  yogaNodeIsReferenceBaseline(node) {
    return this.opentui.symbols.yogaNodeIsReferenceBaseline(node);
  }
  yogaNodeSetAlwaysFormsContainingBlock(node, alwaysFormsContainingBlock) {
    this.opentui.symbols.yogaNodeSetAlwaysFormsContainingBlock(node, ffiBool(alwaysFormsContainingBlock));
  }
  yogaNodeGetAlwaysFormsContainingBlock(node) {
    return this.opentui.symbols.yogaNodeGetAlwaysFormsContainingBlock(node);
  }
  yogaNodeGetComputedLayout(node) {
    const layout = new Float32Array(6);
    this.opentui.symbols.yogaNodeGetComputedLayout(node, ptr(layout));
    return {
      left: layout[0],
      top: layout[1],
      right: layout[2],
      bottom: layout[3],
      width: layout[4],
      height: layout[5]
    };
  }
  yogaNodeLayoutGetEdge(node, kind, edge) {
    return this.opentui.symbols.yogaNodeLayoutGetEdge(node, kind, edge);
  }
  yogaNodeStyleSetEnum(node, kind, value) {
    this.opentui.symbols.yogaNodeStyleSetEnum(node, kind, value);
  }
  yogaNodeStyleGetEnum(node, kind) {
    return this.opentui.symbols.yogaNodeStyleGetEnum(node, kind);
  }
  yogaNodeStyleSetFloat(node, kind, value) {
    this.opentui.symbols.yogaNodeStyleSetFloat(node, kind, value);
  }
  yogaNodeStyleGetFloat(node, kind) {
    return this.opentui.symbols.yogaNodeStyleGetFloat(node, kind);
  }
  yogaNodeStyleSetBorder(node, edge, border2) {
    this.opentui.symbols.yogaNodeStyleSetBorder(node, edge, border2);
  }
  yogaNodeStyleGetBorder(node, edge) {
    return this.opentui.symbols.yogaNodeStyleGetBorder(node, edge);
  }
  yogaNodeStyleSetValue(node, kind, edgeOrGutter, unit, value) {
    this.opentui.symbols.yogaNodeStyleSetValue(node, kind, edgeOrGutter, unit, value);
  }
  yogaNodeStyleGetValue(node, kind, edgeOrGutter) {
    return this.opentui.symbols.yogaNodeStyleGetValue(node, kind, edgeOrGutter);
  }
  yogaNodeSetMeasureFunc(node, enabled) {
    this.opentui.symbols.yogaNodeSetMeasureFunc(node, ffiBool(enabled));
  }
  yogaNodeUnsetMeasureFunc(node) {
    this.opentui.symbols.yogaNodeUnsetMeasureFunc(node);
  }
  yogaNodeHasMeasureFunc(node) {
    return Boolean(this.opentui.symbols.yogaNodeHasMeasureFunc(node));
  }
  yogaNodeSetDirtiedFunc(node, enabled) {
    this.opentui.symbols.yogaNodeSetDirtiedFunc(node, ffiBool(enabled));
  }
  yogaNodeUnsetDirtiedFunc(node) {
    this.opentui.symbols.yogaNodeUnsetDirtiedFunc(node);
  }
  yogaStoreMeasureResult(width, height) {
    this.opentui.symbols.yogaStoreMeasureResult(width, height);
  }
  yogaSetMeasureCallback(callback) {
    this.opentui.symbols.yogaSetMeasureCallback(callback);
  }
  yogaSetDirtiedCallback(callback) {
    this.opentui.symbols.yogaSetDirtiedCallback(callback);
  }
  createYogaMeasureCallback(callback) {
    return this.opentui.createCallback(callback, {
      args: ["ptr", "f32", "u32", "f32", "u32"],
      returns: "void"
    });
  }
  createYogaDirtiedCallback(callback) {
    return this.opentui.createCallback(callback, {
      args: ["ptr"],
      returns: "void"
    });
  }
  createTextBuffer(widthMethod) {
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1;
    const bufferPtr = this.opentui.symbols.createTextBuffer(widthMethodCode);
    if (!bufferPtr) {
      throw new Error(`Failed to create TextBuffer`);
    }
    return new TextBuffer(this, bufferPtr);
  }
  destroyTextBuffer(buffer) {
    this.opentui.symbols.destroyTextBuffer(buffer);
  }
  textBufferGetLength(buffer) {
    return this.opentui.symbols.textBufferGetLength(buffer);
  }
  textBufferGetByteSize(buffer) {
    return this.opentui.symbols.textBufferGetByteSize(buffer);
  }
  textBufferReset(buffer) {
    this.opentui.symbols.textBufferReset(buffer);
  }
  textBufferClear(buffer) {
    this.opentui.symbols.textBufferClear(buffer);
  }
  textBufferSetDefaultFg(buffer, fg2) {
    const fgPtr = optionalRgbaPtr(fg2);
    this.opentui.symbols.textBufferSetDefaultFg(buffer, fgPtr);
  }
  textBufferSetDefaultBg(buffer, bg2) {
    const bgPtr = optionalRgbaPtr(bg2);
    this.opentui.symbols.textBufferSetDefaultBg(buffer, bgPtr);
  }
  textBufferSetDefaultAttributes(buffer, attributes) {
    const attrValue = attributes === null ? null : new Uint32Array([attributes]);
    this.opentui.symbols.textBufferSetDefaultAttributes(buffer, attrValue ? ptr(attrValue) : null);
  }
  textBufferResetDefaults(buffer) {
    this.opentui.symbols.textBufferResetDefaults(buffer);
  }
  textBufferGetTabWidth(buffer) {
    return this.opentui.symbols.textBufferGetTabWidth(buffer);
  }
  textBufferSetTabWidth(buffer, width) {
    this.opentui.symbols.textBufferSetTabWidth(buffer, width);
  }
  textBufferRegisterMemBuffer(buffer, bytes, owned = false) {
    const result = this.opentui.symbols.textBufferRegisterMemBuffer(buffer, ptrOrNull(bytes), bytes.byteLength, ffiBool(owned));
    if (result === 65535) {
      throw new Error("Failed to register memory buffer");
    }
    return result;
  }
  textBufferReplaceMemBuffer(buffer, memId, bytes, owned = false) {
    return this.opentui.symbols.textBufferReplaceMemBuffer(buffer, memId, ptrOrNull(bytes), bytes.byteLength, ffiBool(owned));
  }
  textBufferClearMemRegistry(buffer) {
    this.opentui.symbols.textBufferClearMemRegistry(buffer);
  }
  textBufferSetTextFromMem(buffer, memId) {
    this.opentui.symbols.textBufferSetTextFromMem(buffer, memId);
  }
  textBufferAppend(buffer, bytes) {
    this.opentui.symbols.textBufferAppend(buffer, ptrOrNull(bytes), bytes.byteLength);
  }
  textBufferAppendFromMemId(buffer, memId) {
    this.opentui.symbols.textBufferAppendFromMemId(buffer, memId);
  }
  textBufferLoadFile(buffer, path3) {
    const pathBytes = this.encoder.encode(path3);
    return this.opentui.symbols.textBufferLoadFile(buffer, ptrOrNull(pathBytes), pathBytes.byteLength);
  }
  textBufferSetStyledText(buffer, chunks) {
    if (chunks.length === 0) {
      this.textBufferClear(buffer);
      return;
    }
    const chunksBuffer = StyledChunkStruct.packList(chunks);
    this.opentui.symbols.textBufferSetStyledText(buffer, chunksBuffer, chunks.length);
  }
  textBufferGetLineCount(buffer) {
    return this.opentui.symbols.textBufferGetLineCount(buffer);
  }
  textBufferGetPlainText(buffer, outPtr, maxLen) {
    return this.opentui.symbols.textBufferGetPlainText(buffer, outPtr, maxLen);
  }
  getPlainTextBytes(buffer, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.textBufferGetPlainText(buffer, ptrOrNull(outBuffer), maxLength);
    if (actualLen === 0) {
      return null;
    }
    return outBuffer.slice(0, actualLen);
  }
  textBufferGetTextRange(buffer, startOffset, endOffset, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.textBufferGetTextRange(buffer, startOffset, endOffset, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0) {
      return null;
    }
    return outBuffer.slice(0, len);
  }
  textBufferGetTextRangeByCoords(buffer, startRow, startCol, endRow, endCol, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.textBufferGetTextRangeByCoords(buffer, startRow, startCol, endRow, endCol, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0) {
      return null;
    }
    return outBuffer.slice(0, len);
  }
  createTextBufferView(textBuffer) {
    const viewPtr = this.opentui.symbols.createTextBufferView(textBuffer);
    if (!viewPtr) {
      throw new Error("Failed to create TextBufferView");
    }
    return viewPtr;
  }
  destroyTextBufferView(view) {
    this.opentui.symbols.destroyTextBufferView(view);
  }
  textBufferViewSetSelection(view, start, end, bgColor, fgColor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    this.opentui.symbols.textBufferViewSetSelection(view, start, end, bg2, fg2);
  }
  textBufferViewResetSelection(view) {
    this.opentui.symbols.textBufferViewResetSelection(view);
  }
  textBufferViewGetSelection(view) {
    const packedInfo = this.textBufferViewGetSelectionInfo(view);
    if (packedInfo === 0xffff_ffff_ffff_ffffn) {
      return null;
    }
    const start = Number(packedInfo >> 32n);
    const end = Number(packedInfo & 0xffff_ffffn);
    return { start, end };
  }
  textBufferViewGetSelectionInfo(view) {
    return this.opentui.symbols.textBufferViewGetSelectionInfo(view);
  }
  textBufferViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor, fgColor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    return Boolean(this.opentui.symbols.textBufferViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bg2, fg2));
  }
  textBufferViewUpdateSelection(view, end, bgColor, fgColor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    this.opentui.symbols.textBufferViewUpdateSelection(view, end, bg2, fg2);
  }
  textBufferViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor, fgColor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    return Boolean(this.opentui.symbols.textBufferViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bg2, fg2));
  }
  textBufferViewResetLocalSelection(view) {
    this.opentui.symbols.textBufferViewResetLocalSelection(view);
  }
  textBufferViewSetWrapWidth(view, width) {
    this.opentui.symbols.textBufferViewSetWrapWidth(view, width);
  }
  textBufferViewSetWrapMode(view, mode) {
    const modeValue = mode === "none" ? 0 : mode === "char" ? 1 : 2;
    this.opentui.symbols.textBufferViewSetWrapMode(view, modeValue);
  }
  textBufferViewSetFirstLineOffset(view, offset) {
    this.opentui.symbols.textBufferViewSetFirstLineOffset(view, offset);
  }
  textBufferViewSetViewportSize(view, width, height) {
    this.opentui.symbols.textBufferViewSetViewportSize(view, width, height);
  }
  textBufferViewSetViewport(view, x, y, width, height) {
    this.opentui.symbols.textBufferViewSetViewport(view, x, y, width, height);
  }
  textBufferViewGetLineInfo(view) {
    const outBuffer = new ArrayBuffer(LineInfoStruct.size);
    this.textBufferViewGetLineInfoDirect(view, ptr(outBuffer));
    const struct = LineInfoStruct.unpack(outBuffer);
    const lineStartCols = struct.startCols;
    const lineWidthCols = struct.widthCols;
    const lineWidthColsMax = struct.widthColsMax;
    return {
      lineStartCols,
      lineWidthCols,
      lineWidthColsMax,
      lineSources: struct.sources,
      lineWraps: struct.wraps
    };
  }
  textBufferViewGetLogicalLineInfo(view) {
    const outBuffer = new ArrayBuffer(LineInfoStruct.size);
    this.textBufferViewGetLogicalLineInfoDirect(view, ptr(outBuffer));
    const struct = LineInfoStruct.unpack(outBuffer);
    const lineStartCols = struct.startCols;
    const lineWidthCols = struct.widthCols;
    const lineWidthColsMax = struct.widthColsMax;
    return {
      lineStartCols,
      lineWidthCols,
      lineWidthColsMax,
      lineSources: struct.sources,
      lineWraps: struct.wraps
    };
  }
  textBufferViewGetVirtualLineCount(view) {
    return this.opentui.symbols.textBufferViewGetVirtualLineCount(view);
  }
  textBufferViewGetLineInfoDirect(view, outPtr) {
    this.opentui.symbols.textBufferViewGetLineInfoDirect(view, outPtr);
  }
  textBufferViewGetLogicalLineInfoDirect(view, outPtr) {
    this.opentui.symbols.textBufferViewGetLogicalLineInfoDirect(view, outPtr);
  }
  textBufferViewGetSelectedText(view, outPtr, maxLen) {
    return this.opentui.symbols.textBufferViewGetSelectedText(view, outPtr, maxLen);
  }
  textBufferViewGetPlainText(view, outPtr, maxLen) {
    return this.opentui.symbols.textBufferViewGetPlainText(view, outPtr, maxLen);
  }
  textBufferViewGetSelectedTextBytes(view, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.textBufferViewGetSelectedText(view, ptrOrNull(outBuffer), maxLength);
    if (actualLen === 0) {
      return null;
    }
    return outBuffer.slice(0, actualLen);
  }
  textBufferViewGetPlainTextBytes(view, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.textBufferViewGetPlainText(view, ptrOrNull(outBuffer), maxLength);
    if (actualLen === 0) {
      return null;
    }
    return outBuffer.slice(0, actualLen);
  }
  textBufferViewSetTabIndicator(view, indicator) {
    this.opentui.symbols.textBufferViewSetTabIndicator(view, indicator);
  }
  textBufferViewSetTabIndicatorColor(view, color) {
    this.opentui.symbols.textBufferViewSetTabIndicatorColor(view, rgbaPtr(color));
  }
  textBufferViewSetTruncate(view, truncate) {
    this.opentui.symbols.textBufferViewSetTruncate(view, ffiBool(truncate));
  }
  textBufferViewMeasureForDimensions(view, width, height) {
    const resultBuffer = new ArrayBuffer(MeasureResultStruct.size);
    const resultPtr = ptr(new Uint8Array(resultBuffer));
    const success = this.opentui.symbols.textBufferViewMeasureForDimensions(view, width, height, resultPtr);
    if (!success) {
      return null;
    }
    const result = MeasureResultStruct.unpack(resultBuffer);
    return result;
  }
  textBufferAddHighlightByCharRange(buffer, highlight) {
    const packedHighlight = HighlightStruct.pack(highlight);
    this.opentui.symbols.textBufferAddHighlightByCharRange(buffer, ptr(packedHighlight));
  }
  textBufferAddHighlight(buffer, lineIdx, highlight) {
    const packedHighlight = HighlightStruct.pack(highlight);
    this.opentui.symbols.textBufferAddHighlight(buffer, lineIdx, ptr(packedHighlight));
  }
  textBufferRemoveHighlightsByRef(buffer, hlRef) {
    this.opentui.symbols.textBufferRemoveHighlightsByRef(buffer, hlRef);
  }
  textBufferClearLineHighlights(buffer, lineIdx) {
    this.opentui.symbols.textBufferClearLineHighlights(buffer, lineIdx);
  }
  textBufferClearAllHighlights(buffer) {
    this.opentui.symbols.textBufferClearAllHighlights(buffer);
  }
  textBufferSetSyntaxStyle(buffer, style) {
    return this.opentui.symbols.textBufferSetSyntaxStyle(buffer, style ?? 0);
  }
  textBufferGetLineHighlights(buffer, lineIdx) {
    const outCountBuf = new Uint32Array(1);
    const nativePtr = this.opentui.symbols.textBufferGetLineHighlightsPtr(buffer, lineIdx, ptr(outCountBuf));
    if (!nativePtr)
      return [];
    const count = outCountBuf[0];
    const byteLen = count * HighlightStruct.size;
    const raw = toArrayBuffer(nativePtr, 0, byteLen);
    const results = HighlightStruct.unpackList(raw, count);
    this.opentui.symbols.textBufferFreeLineHighlights(nativePtr, count);
    return results;
  }
  textBufferGetHighlightCount(buffer) {
    return this.opentui.symbols.textBufferGetHighlightCount(buffer);
  }
  getArenaAllocatedBytes() {
    const result = this.opentui.symbols.getArenaAllocatedBytes();
    return toSafeByteCount(result, "Arena allocated bytes");
  }
  getBuildOptions() {
    const optionsBuffer = new ArrayBuffer(BuildOptionsStruct.size);
    this.opentui.symbols.getBuildOptions(ptr(optionsBuffer));
    const options = BuildOptionsStruct.unpack(optionsBuffer);
    return {
      gpaSafeStats: !!options.gpaSafeStats,
      gpaMemoryLimitTracking: !!options.gpaMemoryLimitTracking
    };
  }
  getAllocatorStats() {
    const statsBuffer = new ArrayBuffer(AllocatorStatsStruct.size);
    this.opentui.symbols.getAllocatorStats(ptr(statsBuffer));
    const stats = AllocatorStatsStruct.unpack(statsBuffer);
    return {
      totalRequestedBytes: toNumber(stats.totalRequestedBytes),
      activeAllocations: toNumber(stats.activeAllocations),
      smallAllocations: toNumber(stats.smallAllocations),
      largeAllocations: toNumber(stats.largeAllocations),
      requestedBytesValid: !!stats.requestedBytesValid
    };
  }
  bufferDrawTextBufferView(buffer, view, x, y) {
    this.opentui.symbols.bufferDrawTextBufferView(buffer, view, x, y);
  }
  bufferDrawEditorView(buffer, view, x, y) {
    this.opentui.symbols.bufferDrawEditorView(buffer, view, x, y);
  }
  createEditorView(editBufferPtr, viewportWidth, viewportHeight) {
    const viewPtr = this.opentui.symbols.createEditorView(editBufferPtr, viewportWidth, viewportHeight);
    if (!viewPtr) {
      throw new Error("Failed to create EditorView");
    }
    return viewPtr;
  }
  destroyEditorView(view) {
    this.opentui.symbols.destroyEditorView(view);
  }
  editorViewSetViewportSize(view, width, height) {
    this.opentui.symbols.editorViewSetViewportSize(view, width, height);
  }
  editorViewSetViewport(view, x, y, width, height, moveCursor) {
    this.opentui.symbols.editorViewSetViewport(view, x, y, width, height, ffiBool(moveCursor));
  }
  editorViewGetViewport(view) {
    const x = new Uint32Array(1);
    const y = new Uint32Array(1);
    const width = new Uint32Array(1);
    const height = new Uint32Array(1);
    this.opentui.symbols.editorViewGetViewport(view, ptr(x), ptr(y), ptr(width), ptr(height));
    return {
      offsetX: x[0],
      offsetY: y[0],
      width: width[0],
      height: height[0]
    };
  }
  editorViewSetScrollMargin(view, margin) {
    this.opentui.symbols.editorViewSetScrollMargin(view, margin);
  }
  editorViewSetWrapMode(view, mode) {
    const modeValue = mode === "none" ? 0 : mode === "char" ? 1 : 2;
    this.opentui.symbols.editorViewSetWrapMode(view, modeValue);
  }
  editorViewGetVirtualLineCount(view) {
    return this.opentui.symbols.editorViewGetVirtualLineCount(view);
  }
  editorViewGetTotalVirtualLineCount(view) {
    return this.opentui.symbols.editorViewGetTotalVirtualLineCount(view);
  }
  editorViewGetTextBufferView(view) {
    const result = this.opentui.symbols.editorViewGetTextBufferView(view);
    if (!result) {
      throw new Error("Failed to get TextBufferView from EditorView");
    }
    return result;
  }
  editorViewGetLineInfo(view) {
    const outBuffer = new ArrayBuffer(LineInfoStruct.size);
    this.opentui.symbols.editorViewGetLineInfoDirect(view, ptr(outBuffer));
    const struct = LineInfoStruct.unpack(outBuffer);
    const lineStartCols = struct.startCols;
    const lineWidthCols = struct.widthCols;
    const lineWidthColsMax = struct.widthColsMax;
    return {
      lineStartCols,
      lineWidthCols,
      lineWidthColsMax,
      lineSources: struct.sources,
      lineWraps: struct.wraps
    };
  }
  editorViewGetLogicalLineInfo(view) {
    const outBuffer = new ArrayBuffer(LineInfoStruct.size);
    this.opentui.symbols.editorViewGetLogicalLineInfoDirect(view, ptr(outBuffer));
    const struct = LineInfoStruct.unpack(outBuffer);
    const lineStartCols = struct.startCols;
    const lineWidthCols = struct.widthCols;
    const lineWidthColsMax = struct.widthColsMax;
    return {
      lineStartCols,
      lineWidthCols,
      lineWidthColsMax,
      lineSources: struct.sources,
      lineWraps: struct.wraps
    };
  }
  createEditBuffer(widthMethod) {
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1;
    const bufferPtr = this.opentui.symbols.createEditBuffer(widthMethodCode, this.eventSinkPtr ?? 0);
    if (!bufferPtr) {
      throw new Error("Failed to create EditBuffer");
    }
    return bufferPtr;
  }
  destroyEditBuffer(buffer) {
    this.opentui.symbols.destroyEditBuffer(buffer);
  }
  editBufferSetText(buffer, textBytes) {
    this.opentui.symbols.editBufferSetText(buffer, ptrOrNull(textBytes), textBytes.byteLength);
  }
  editBufferSetTextFromMem(buffer, memId) {
    this.opentui.symbols.editBufferSetTextFromMem(buffer, memId);
  }
  editBufferReplaceText(buffer, textBytes) {
    this.opentui.symbols.editBufferReplaceText(buffer, ptrOrNull(textBytes), textBytes.byteLength);
  }
  editBufferReplaceTextFromMem(buffer, memId) {
    this.opentui.symbols.editBufferReplaceTextFromMem(buffer, memId);
  }
  editBufferGetText(buffer, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editBufferGetText(buffer, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editBufferInsertChar(buffer, char) {
    const charBytes = this.encoder.encode(char);
    this.opentui.symbols.editBufferInsertChar(buffer, ptrOrNull(charBytes), charBytes.byteLength);
  }
  editBufferInsertText(buffer, text) {
    const textBytes = this.encoder.encode(text);
    this.opentui.symbols.editBufferInsertText(buffer, ptrOrNull(textBytes), textBytes.byteLength);
  }
  editBufferDeleteChar(buffer) {
    this.opentui.symbols.editBufferDeleteChar(buffer);
  }
  editBufferDeleteCharBackward(buffer) {
    this.opentui.symbols.editBufferDeleteCharBackward(buffer);
  }
  editBufferDeleteRange(buffer, startLine, startCol, endLine, endCol) {
    this.opentui.symbols.editBufferDeleteRange(buffer, startLine, startCol, endLine, endCol);
  }
  editBufferNewLine(buffer) {
    this.opentui.symbols.editBufferNewLine(buffer);
  }
  editBufferDeleteLine(buffer) {
    this.opentui.symbols.editBufferDeleteLine(buffer);
  }
  editBufferMoveCursorLeft(buffer) {
    this.opentui.symbols.editBufferMoveCursorLeft(buffer);
  }
  editBufferMoveCursorRight(buffer) {
    this.opentui.symbols.editBufferMoveCursorRight(buffer);
  }
  editBufferMoveCursorUp(buffer) {
    this.opentui.symbols.editBufferMoveCursorUp(buffer);
  }
  editBufferMoveCursorDown(buffer) {
    this.opentui.symbols.editBufferMoveCursorDown(buffer);
  }
  editBufferGotoLine(buffer, line) {
    this.opentui.symbols.editBufferGotoLine(buffer, line);
  }
  editBufferSetCursor(buffer, line, byteOffset) {
    this.opentui.symbols.editBufferSetCursor(buffer, line, byteOffset);
  }
  editBufferSetCursorToLineCol(buffer, line, col) {
    this.opentui.symbols.editBufferSetCursorToLineCol(buffer, line, col);
  }
  editBufferSetCursorByOffset(buffer, offset) {
    this.opentui.symbols.editBufferSetCursorByOffset(buffer, offset);
  }
  editBufferGetCursorPosition(buffer) {
    const cursorBuffer = new ArrayBuffer(LogicalCursorStruct.size);
    this.opentui.symbols.editBufferGetCursorPosition(buffer, ptr(cursorBuffer));
    return LogicalCursorStruct.unpack(cursorBuffer);
  }
  editBufferGetId(buffer) {
    return this.opentui.symbols.editBufferGetId(buffer);
  }
  editBufferGetTextBuffer(buffer) {
    const result = this.opentui.symbols.editBufferGetTextBuffer(buffer);
    if (!result) {
      throw new Error("Failed to get TextBuffer from EditBuffer");
    }
    return result;
  }
  editBufferDebugLogRope(buffer) {
    this.opentui.symbols.editBufferDebugLogRope(buffer);
  }
  editBufferUndo(buffer, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editBufferUndo(buffer, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editBufferRedo(buffer, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editBufferRedo(buffer, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editBufferCanUndo(buffer) {
    return Boolean(this.opentui.symbols.editBufferCanUndo(buffer));
  }
  editBufferCanRedo(buffer) {
    return Boolean(this.opentui.symbols.editBufferCanRedo(buffer));
  }
  editBufferClearHistory(buffer) {
    this.opentui.symbols.editBufferClearHistory(buffer);
  }
  editBufferClear(buffer) {
    this.opentui.symbols.editBufferClear(buffer);
  }
  editBufferGetNextWordBoundary(buffer) {
    const cursorBuffer = new ArrayBuffer(LogicalCursorStruct.size);
    this.opentui.symbols.editBufferGetNextWordBoundary(buffer, ptr(cursorBuffer));
    return LogicalCursorStruct.unpack(cursorBuffer);
  }
  editBufferGetPrevWordBoundary(buffer) {
    const cursorBuffer = new ArrayBuffer(LogicalCursorStruct.size);
    this.opentui.symbols.editBufferGetPrevWordBoundary(buffer, ptr(cursorBuffer));
    return LogicalCursorStruct.unpack(cursorBuffer);
  }
  editBufferGetEOL(buffer) {
    const cursorBuffer = new ArrayBuffer(LogicalCursorStruct.size);
    this.opentui.symbols.editBufferGetEOL(buffer, ptr(cursorBuffer));
    return LogicalCursorStruct.unpack(cursorBuffer);
  }
  editBufferOffsetToPosition(buffer, offset) {
    const cursorBuffer = new ArrayBuffer(LogicalCursorStruct.size);
    const success = this.opentui.symbols.editBufferOffsetToPosition(buffer, offset, ptr(cursorBuffer));
    if (!success)
      return null;
    return LogicalCursorStruct.unpack(cursorBuffer);
  }
  editBufferPositionToOffset(buffer, row, col) {
    return this.opentui.symbols.editBufferPositionToOffset(buffer, row, col);
  }
  editBufferGetLineStartOffset(buffer, row) {
    return this.opentui.symbols.editBufferGetLineStartOffset(buffer, row);
  }
  editBufferGetTextRange(buffer, startOffset, endOffset, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editBufferGetTextRange(buffer, startOffset, endOffset, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editBufferGetTextRangeByCoords(buffer, startRow, startCol, endRow, endCol, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editBufferGetTextRangeByCoords(buffer, startRow, startCol, endRow, endCol, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editorViewSetSelection(view, start, end, bgColor, fgColor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    this.opentui.symbols.editorViewSetSelection(view, start, end, bg2, fg2);
  }
  editorViewResetSelection(view) {
    this.opentui.symbols.editorViewResetSelection(view);
  }
  editorViewGetSelection(view) {
    const packedInfo = this.opentui.symbols.editorViewGetSelection(view);
    if (packedInfo === 0xffff_ffff_ffff_ffffn) {
      return null;
    }
    const start = Number(packedInfo >> 32n);
    const end = Number(packedInfo & 0xffff_ffffn);
    return { start, end };
  }
  editorViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor, fgColor, updateCursor, followCursor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    return Boolean(this.opentui.symbols.editorViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bg2, fg2, ffiBool(updateCursor), ffiBool(followCursor)));
  }
  editorViewUpdateSelection(view, end, bgColor, fgColor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    this.opentui.symbols.editorViewUpdateSelection(view, end, bg2, fg2);
  }
  editorViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor, fgColor, updateCursor, followCursor) {
    const bg2 = optionalRgbaPtr(bgColor);
    const fg2 = optionalRgbaPtr(fgColor);
    return Boolean(this.opentui.symbols.editorViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bg2, fg2, ffiBool(updateCursor), ffiBool(followCursor)));
  }
  editorViewResetLocalSelection(view) {
    this.opentui.symbols.editorViewResetLocalSelection(view);
  }
  editorViewGetSelectedTextBytes(view, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editorViewGetSelectedTextBytes(view, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editorViewGetCursor(view) {
    const row = new Uint32Array(1);
    const col = new Uint32Array(1);
    this.opentui.symbols.editorViewGetCursor(view, ptr(row), ptr(col));
    return { row: row[0], col: col[0] };
  }
  editorViewGetText(view, maxLength) {
    const outBuffer = new Uint8Array(maxLength);
    const actualLen = this.opentui.symbols.editorViewGetText(view, ptrOrNull(outBuffer), maxLength);
    const len = actualLen;
    if (len === 0)
      return null;
    return outBuffer.slice(0, len);
  }
  editorViewGetVisualCursor(view) {
    const cursorBuffer = new ArrayBuffer(VisualCursorStruct.size);
    this.opentui.symbols.editorViewGetVisualCursor(view, ptr(cursorBuffer));
    return VisualCursorStruct.unpack(cursorBuffer);
  }
  editorViewMoveUpVisual(view) {
    this.opentui.symbols.editorViewMoveUpVisual(view);
  }
  editorViewMoveDownVisual(view) {
    this.opentui.symbols.editorViewMoveDownVisual(view);
  }
  editorViewDeleteSelectedText(view) {
    this.opentui.symbols.editorViewDeleteSelectedText(view);
  }
  editorViewSetCursorByOffset(view, offset) {
    this.opentui.symbols.editorViewSetCursorByOffset(view, offset);
  }
  editorViewGetNextWordBoundary(view) {
    const cursorBuffer = new ArrayBuffer(VisualCursorStruct.size);
    this.opentui.symbols.editorViewGetNextWordBoundary(view, ptr(cursorBuffer));
    return VisualCursorStruct.unpack(cursorBuffer);
  }
  editorViewGetPrevWordBoundary(view) {
    const cursorBuffer = new ArrayBuffer(VisualCursorStruct.size);
    this.opentui.symbols.editorViewGetPrevWordBoundary(view, ptr(cursorBuffer));
    return VisualCursorStruct.unpack(cursorBuffer);
  }
  editorViewGetEOL(view) {
    const cursorBuffer = new ArrayBuffer(VisualCursorStruct.size);
    this.opentui.symbols.editorViewGetEOL(view, ptr(cursorBuffer));
    return VisualCursorStruct.unpack(cursorBuffer);
  }
  editorViewGetVisualSOL(view) {
    const cursorBuffer = new ArrayBuffer(VisualCursorStruct.size);
    this.opentui.symbols.editorViewGetVisualSOL(view, ptr(cursorBuffer));
    return VisualCursorStruct.unpack(cursorBuffer);
  }
  editorViewGetVisualEOL(view) {
    const cursorBuffer = new ArrayBuffer(VisualCursorStruct.size);
    this.opentui.symbols.editorViewGetVisualEOL(view, ptr(cursorBuffer));
    return VisualCursorStruct.unpack(cursorBuffer);
  }
  bufferPushScissorRect(buffer, x, y, width, height) {
    this.opentui.symbols.bufferPushScissorRect(buffer, x, y, width, height);
  }
  bufferPopScissorRect(buffer) {
    this.opentui.symbols.bufferPopScissorRect(buffer);
  }
  bufferClearScissorRects(buffer) {
    this.opentui.symbols.bufferClearScissorRects(buffer);
  }
  bufferPushOpacity(buffer, opacity) {
    this.opentui.symbols.bufferPushOpacity(buffer, opacity);
  }
  bufferPopOpacity(buffer) {
    this.opentui.symbols.bufferPopOpacity(buffer);
  }
  bufferGetCurrentOpacity(buffer) {
    return this.opentui.symbols.bufferGetCurrentOpacity(buffer);
  }
  bufferClearOpacity(buffer) {
    this.opentui.symbols.bufferClearOpacity(buffer);
  }
  getTerminalCapabilities(renderer) {
    const capsBuffer = new ArrayBuffer(TerminalCapabilitiesStruct.size);
    this.opentui.symbols.getTerminalCapabilities(renderer, ptr(capsBuffer));
    const caps = TerminalCapabilitiesStruct.unpack(capsBuffer);
    return {
      kitty_keyboard: caps.kitty_keyboard,
      kitty_graphics: caps.kitty_graphics,
      rgb: caps.rgb,
      ansi256: caps.ansi256,
      unicode: caps.unicode,
      sgr_pixels: caps.sgr_pixels,
      color_scheme_updates: caps.color_scheme_updates,
      explicit_width: caps.explicit_width,
      scaled_text: caps.scaled_text,
      sixel: caps.sixel,
      focus_tracking: caps.focus_tracking,
      sync: caps.sync,
      bracketed_paste: caps.bracketed_paste,
      hyperlinks: caps.hyperlinks,
      osc52: caps.osc52,
      osc52_support: caps.osc52_support,
      notifications: caps.notifications,
      explicit_cursor_positioning: caps.explicit_cursor_positioning,
      remote: caps.remote,
      multiplexer: caps.multiplexer,
      terminal: {
        name: caps.term_name ?? "",
        version: caps.term_version ?? "",
        from_xtversion: caps.term_from_xtversion
      }
    };
  }
  processCapabilityResponse(renderer, response) {
    const responseBytes = this.encoder.encode(response);
    this.opentui.symbols.processCapabilityResponse(renderer, ptrOrNull(responseBytes), responseBytes.byteLength);
  }
  encodeUnicode(text, widthMethod) {
    const textBytes = this.encoder.encode(text);
    const widthMethodCode = widthMethod === "wcwidth" ? 0 : 1;
    const outPtrBuffer = new ArrayBuffer(8);
    const outLenBuffer = new ArrayBuffer(8);
    const success = this.opentui.symbols.encodeUnicode(ptrOrNull(textBytes), textBytes.byteLength, ptr(outPtrBuffer), ptr(outLenBuffer), widthMethodCode);
    if (!success) {
      return null;
    }
    const outPtrView = new BigUint64Array(outPtrBuffer);
    const outLenView = new BigUint64Array(outLenBuffer);
    const resultLen = Number(outLenView[0]);
    if (resultLen === 0) {
      return { ptr: 0, data: [] };
    }
    const resultPtr = toPointer(outPtrView[0]);
    const byteLen = resultLen * EncodedCharStruct.size;
    const raw = toArrayBuffer(resultPtr, 0, byteLen);
    const data = EncodedCharStruct.unpackList(raw, resultLen);
    return { ptr: resultPtr, data };
  }
  freeUnicode(encoded) {
    this.opentui.symbols.freeUnicode(encoded.ptr, encoded.data.length);
  }
  bufferDrawChar(buffer, char, x, y, fg2, bg2, attributes = 0) {
    this.opentui.symbols.bufferDrawChar(buffer, char, x, y, rgbaPtr(fg2), rgbaPtr(bg2), attributes);
  }
  createAudioEngine(options) {
    const optionsBuffer = options == null ? null : AudioCreateOptionsStruct.pack(options);
    const engineHandle = this.opentui.symbols.createAudioEngine(optionsBuffer ? ptr(optionsBuffer) : null);
    return engineHandle ? engineHandle : null;
  }
  destroyAudioEngine(engine) {
    this.opentui.symbols.destroyAudioEngine(engine);
  }
  audioRefreshPlaybackDevices(engine) {
    return this.opentui.symbols.audioRefreshPlaybackDevices(engine);
  }
  audioGetPlaybackDeviceCount(engine) {
    return this.opentui.symbols.audioGetPlaybackDeviceCount(engine);
  }
  audioGetPlaybackDeviceName(engine, index) {
    const outBuffer = new Uint8Array(512);
    const bytesWritten = toNumber(this.opentui.symbols.audioGetPlaybackDeviceName(engine, index, ptr(outBuffer), outBuffer.length));
    const safeBytesWritten = Math.max(0, Math.min(outBuffer.length, bytesWritten));
    return this.decoder.decode(outBuffer.subarray(0, safeBytesWritten));
  }
  audioIsPlaybackDeviceDefault(engine, index) {
    return this.opentui.symbols.audioIsPlaybackDeviceDefault(engine, index);
  }
  audioSelectPlaybackDevice(engine, index) {
    return this.opentui.symbols.audioSelectPlaybackDevice(engine, index);
  }
  audioClearPlaybackDeviceSelection(engine) {
    this.opentui.symbols.audioClearPlaybackDeviceSelection(engine);
  }
  audioStart(engine, options) {
    let optionsBuffer;
    try {
      optionsBuffer = options == null ? null : AudioStartOptionsStruct.pack(options);
    } catch {
      return -1;
    }
    return this.opentui.symbols.audioStart(engine, optionsBuffer ? ptr(optionsBuffer) : null);
  }
  audioStartMixer(engine) {
    return this.opentui.symbols.audioStartMixer(engine);
  }
  audioStop(engine) {
    return this.opentui.symbols.audioStop(engine);
  }
  audioCreateStream(engine, options) {
    if (!isFFIU32(options.groupId) || options.format !== NativeAudioStreamFormat2.Mp3 && options.format !== NativeAudioStreamFormat2.Flac) {
      return { status: -1, streamId: null };
    }
    const optionsBuffer = AudioStreamCreateOptionsStruct.pack(options);
    const outBuffer = new ArrayBuffer(4);
    const status = this.opentui.symbols.audioCreateStream(engine, optionsBuffer, outBuffer);
    if (status !== 0)
      return { status, streamId: null };
    return { status, streamId: new Uint32Array(outBuffer)[0] ?? null };
  }
  audioWriteStream(engine, streamId, data) {
    const dataLength = toSafeFFIU32Length(data.byteLength, "Audio stream data length");
    return this.opentui.symbols.audioWriteStream(engine, streamId, dataLength === 0 ? null : data, dataLength);
  }
  audioEndStream(engine, streamId) {
    return this.opentui.symbols.audioEndStream(engine, streamId);
  }
  audioRestartStream(engine, streamId) {
    return this.opentui.symbols.audioRestartStream(engine, streamId);
  }
  audioSetStreamVolume(engine, streamId, volume) {
    return this.opentui.symbols.audioSetStreamVolume(engine, streamId, volume);
  }
  audioSetStreamPan(engine, streamId, pan) {
    return this.opentui.symbols.audioSetStreamPan(engine, streamId, pan);
  }
  audioSetStreamGroup(engine, streamId, groupId) {
    if (!isFFIU32(groupId))
      return -1;
    return this.opentui.symbols.audioSetStreamGroup(engine, streamId, groupId);
  }
  audioGetStreamStats(engine, streamId) {
    const outBuffer = new ArrayBuffer(AudioStreamStatsStruct.size);
    const status = this.opentui.symbols.audioGetStreamStats(engine, streamId, outBuffer);
    if (status !== 0)
      return null;
    return AudioStreamStatsStruct.unpack(outBuffer);
  }
  audioCloseStream(engine, streamId, reason) {
    const outBuffer = new ArrayBuffer(AudioStreamStatsStruct.size);
    const status = this.opentui.symbols.audioCloseStream(engine, streamId, reason, outBuffer);
    if (status !== 0)
      return { status, stats: null };
    return { status, stats: AudioStreamStatsStruct.unpack(outBuffer) };
  }
  audioLoad(engine, data) {
    const outBuffer = new ArrayBuffer(4);
    const dataLength = toSafeFFIU32Length(data.byteLength, "Audio data length");
    const status = this.opentui.symbols.audioLoad(engine, ptr(data), dataLength, ptr(outBuffer));
    if (status !== 0) {
      return { status, soundId: null };
    }
    const view = new Uint32Array(outBuffer);
    return { status, soundId: view[0] };
  }
  audioUnload(engine, soundId) {
    return this.opentui.symbols.audioUnload(engine, soundId);
  }
  audioPlay(engine, soundId, options) {
    if (options?.groupId !== undefined && !isFFIU32(options.groupId))
      return { status: -1, voiceId: null };
    const outBuffer = new ArrayBuffer(4);
    const optionsBuffer = options ? AudioVoiceOptionsStruct.pack(options) : null;
    const status = this.opentui.symbols.audioPlay(engine, soundId, optionsBuffer ? ptr(optionsBuffer) : null, ptr(outBuffer));
    if (status !== 0) {
      return { status, voiceId: null };
    }
    const view = new Uint32Array(outBuffer);
    return { status, voiceId: view[0] };
  }
  audioStopVoice(engine, voiceId) {
    return this.opentui.symbols.audioStopVoice(engine, voiceId);
  }
  audioSetVoiceGroup(engine, voiceId, groupId) {
    if (!isFFIU32(groupId))
      return -1;
    return this.opentui.symbols.audioSetVoiceGroup(engine, voiceId, groupId);
  }
  audioCreateGroup(engine, name) {
    const outBuffer = new ArrayBuffer(4);
    const nameBytes = this.encoder.encode(name);
    const nameLength = toSafeFFIU32Length(nameBytes.byteLength, "Audio group name length");
    const status = this.opentui.symbols.audioCreateGroup(engine, ptr(nameBytes), nameLength, ptr(outBuffer));
    if (status !== 0) {
      return { status, groupId: null };
    }
    const view = new Uint32Array(outBuffer);
    return { status, groupId: view[0] };
  }
  audioSetGroupVolume(engine, groupId, volume) {
    return this.opentui.symbols.audioSetGroupVolume(engine, groupId, volume);
  }
  audioSetMasterVolume(engine, volume) {
    return this.opentui.symbols.audioSetMasterVolume(engine, volume);
  }
  audioMixToBuffer(engine, outBuffer, frameCount, channels) {
    return this.opentui.symbols.audioMixToBuffer(engine, ptr(outBuffer), frameCount, channels);
  }
  audioEnableTap(engine, enabled, capacityFrames) {
    return this.opentui.symbols.audioEnableTap(engine, ffiBool(enabled), capacityFrames);
  }
  audioReadTap(engine, outBuffer, frameCount, channels) {
    const outFramesReadBuffer = new ArrayBuffer(4);
    const status = this.opentui.symbols.audioReadTap(engine, ptr(outBuffer), frameCount, channels, ptr(outFramesReadBuffer));
    if (status !== 0) {
      return { status, framesRead: 0 };
    }
    const view = new Uint32Array(outFramesReadBuffer);
    return { status, framesRead: view[0] ?? 0 };
  }
  audioGetStats(engine) {
    const statsBuffer = new ArrayBuffer(AudioStatsStruct.size);
    const status = this.opentui.symbols.audioGetStats(engine, ptr(statsBuffer));
    if (status !== 0) {
      return null;
    }
    const stats = AudioStatsStruct.unpack(statsBuffer);
    return {
      soundsLoaded: stats.soundsLoaded,
      voicesActive: stats.voicesActive,
      framesMixed: typeof stats.framesMixed === "bigint" ? stats.framesMixed : BigInt(stats.framesMixed),
      lockMisses: stats.lockMisses,
      lastPeak: stats.lastPeak,
      lastRms: stats.lastRms
    };
  }
  registerNativeSpanFeedStream(stream, handler) {
    const callback = this.ensureNativeSpanFeedCallback();
    this.nativeSpanFeedHandlers.set(stream, handler);
    this.opentui.symbols.streamSetCallback(stream, callback.ptr);
  }
  unregisterNativeSpanFeedStream(stream) {
    this.opentui.symbols.streamSetCallback(stream, null);
    this.nativeSpanFeedHandlers.delete(stream);
  }
  createNativeSpanFeed(options) {
    const optionsBuffer = options == null ? null : NativeSpanFeedOptionsStruct.pack(options);
    const streamPtr = this.opentui.symbols.createNativeSpanFeed(optionsBuffer ? ptr(optionsBuffer) : null);
    if (!streamPtr) {
      throw new Error("Failed to create stream");
    }
    return streamPtr;
  }
  attachNativeSpanFeed(stream) {
    return this.opentui.symbols.attachNativeSpanFeed(stream);
  }
  destroyNativeSpanFeed(stream) {
    this.opentui.symbols.destroyNativeSpanFeed(stream);
    this.nativeSpanFeedHandlers.delete(stream);
  }
  streamWrite(stream, data) {
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    return this.opentui.symbols.streamWrite(stream, ptrOrNull(bytes), bytes.byteLength);
  }
  streamCommit(stream) {
    return this.opentui.symbols.streamCommit(stream);
  }
  streamDrainSpans(stream, outBuffer, maxSpans) {
    const count = this.opentui.symbols.streamDrainSpans(stream, ptr(outBuffer), maxSpans);
    return toNumber(count);
  }
  streamClose(stream) {
    return this.opentui.symbols.streamClose(stream);
  }
  streamSetOptions(stream, options) {
    const optionsBuffer = NativeSpanFeedOptionsStruct.pack(options);
    return this.opentui.symbols.streamSetOptions(stream, ptr(optionsBuffer));
  }
  streamGetStats(stream) {
    const statsBuffer = new ArrayBuffer(NativeSpanFeedStatsStruct.size);
    const status = this.opentui.symbols.streamGetStats(stream, ptr(statsBuffer));
    if (status !== 0) {
      return null;
    }
    const stats = NativeSpanFeedStatsStruct.unpack(statsBuffer);
    return {
      bytesWritten: typeof stats.bytesWritten === "bigint" ? stats.bytesWritten : BigInt(stats.bytesWritten),
      spansCommitted: typeof stats.spansCommitted === "bigint" ? stats.spansCommitted : BigInt(stats.spansCommitted),
      chunks: stats.chunks,
      pendingSpans: stats.pendingSpans
    };
  }
  streamReserve(stream, minLen) {
    const reserveBuffer = new ArrayBuffer(ReserveInfoStruct.size);
    const status = this.opentui.symbols.streamReserve(stream, minLen, ptr(reserveBuffer));
    if (status !== 0) {
      return { status, info: null };
    }
    return { status, info: ReserveInfoStruct.unpack(reserveBuffer) };
  }
  streamCommitReserved(stream, length) {
    return this.opentui.symbols.streamCommitReserved(stream, length);
  }
  createSyntaxStyle() {
    const styleHandle = this.opentui.symbols.createSyntaxStyle();
    if (!styleHandle) {
      throw new Error("Failed to create SyntaxStyle");
    }
    return styleHandle;
  }
  destroySyntaxStyle(style) {
    this.opentui.symbols.destroySyntaxStyle(style);
  }
  syntaxStyleRegister(style, name, fg2, bg2, attributes) {
    const nameBytes = this.encoder.encode(name);
    const fgPtr = optionalRgbaPtr(fg2);
    const bgPtr = optionalRgbaPtr(bg2);
    return this.opentui.symbols.syntaxStyleRegister(style, ptrOrNull(nameBytes), nameBytes.byteLength, fgPtr, bgPtr, attributes);
  }
  syntaxStyleResolveByName(style, name) {
    const nameBytes = this.encoder.encode(name);
    const id = this.opentui.symbols.syntaxStyleResolveByName(style, ptrOrNull(nameBytes), nameBytes.byteLength);
    return id === 0 ? null : id;
  }
  syntaxStyleGetStyleCount(style) {
    return this.opentui.symbols.syntaxStyleGetStyleCount(style);
  }
  editorViewSetPlaceholderStyledText(view, chunks) {
    const nonEmptyChunks = chunks.filter((c) => c.text.length > 0);
    if (nonEmptyChunks.length === 0) {
      this.opentui.symbols.editorViewSetPlaceholderStyledText(view, null, 0);
      return;
    }
    const chunksBuffer = StyledChunkStruct.packList(nonEmptyChunks);
    this.opentui.symbols.editorViewSetPlaceholderStyledText(view, chunksBuffer, nonEmptyChunks.length);
  }
  editorViewSetTabIndicator(view, indicator) {
    this.opentui.symbols.editorViewSetTabIndicator(view, indicator);
  }
  editorViewSetTabIndicatorColor(view, color) {
    this.opentui.symbols.editorViewSetTabIndicatorColor(view, rgbaPtr(color));
  }
  onNativeEvent(name, handler) {
    this._nativeEvents.on(name, handler);
  }
  onceNativeEvent(name, handler) {
    this._nativeEvents.once(name, handler);
  }
  offNativeEvent(name, handler) {
    this._nativeEvents.off(name, handler);
  }
  onAnyNativeEvent(handler) {
    this._anyEventHandlers.push(handler);
  }
}
var opentuiLibPath;
var opentuiLib;
var renderLibResolved = false;
function setRenderLibPath(libPath) {
  if (opentuiLibPath !== libPath) {
    if (renderLibResolved) {
      throw new Error("setRenderLibPath() must be called before resolveRenderLib()");
    }
    if (opentuiLib instanceof FFIRenderLib) {
      opentuiLib.dispose();
    }
    opentuiLibPath = libPath;
    opentuiLib = undefined;
  }
}
function resolveRenderLib() {
  if (!opentuiLib) {
    try {
      opentuiLib = new FFIRenderLib(opentuiLibPath);
    } catch (error) {
      throw new Error(`Failed to initialize OpenTUI render library: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  renderLibResolved = true;
  return opentuiLib;
}
try {
  opentuiLib = new FFIRenderLib(opentuiLibPath);
} catch (error) {}

// src/yoga.ts
var Align;
((Align2) => {
  Align2[Align2["Auto"] = 0] = "Auto";
  Align2[Align2["FlexStart"] = 1] = "FlexStart";
  Align2[Align2["Center"] = 2] = "Center";
  Align2[Align2["FlexEnd"] = 3] = "FlexEnd";
  Align2[Align2["Stretch"] = 4] = "Stretch";
  Align2[Align2["Baseline"] = 5] = "Baseline";
  Align2[Align2["SpaceBetween"] = 6] = "SpaceBetween";
  Align2[Align2["SpaceAround"] = 7] = "SpaceAround";
  Align2[Align2["SpaceEvenly"] = 8] = "SpaceEvenly";
})(Align ||= {});
var BoxSizing;
((BoxSizing2) => {
  BoxSizing2[BoxSizing2["BorderBox"] = 0] = "BorderBox";
  BoxSizing2[BoxSizing2["ContentBox"] = 1] = "ContentBox";
})(BoxSizing ||= {});
var Dimension;
((Dimension2) => {
  Dimension2[Dimension2["Width"] = 0] = "Width";
  Dimension2[Dimension2["Height"] = 1] = "Height";
})(Dimension ||= {});
var Direction;
((Direction2) => {
  Direction2[Direction2["Inherit"] = 0] = "Inherit";
  Direction2[Direction2["LTR"] = 1] = "LTR";
  Direction2[Direction2["RTL"] = 2] = "RTL";
})(Direction ||= {});
var Display;
((Display2) => {
  Display2[Display2["Flex"] = 0] = "Flex";
  Display2[Display2["None"] = 1] = "None";
  Display2[Display2["Contents"] = 2] = "Contents";
})(Display ||= {});
var Edge;
((Edge2) => {
  Edge2[Edge2["Left"] = 0] = "Left";
  Edge2[Edge2["Top"] = 1] = "Top";
  Edge2[Edge2["Right"] = 2] = "Right";
  Edge2[Edge2["Bottom"] = 3] = "Bottom";
  Edge2[Edge2["Start"] = 4] = "Start";
  Edge2[Edge2["End"] = 5] = "End";
  Edge2[Edge2["Horizontal"] = 6] = "Horizontal";
  Edge2[Edge2["Vertical"] = 7] = "Vertical";
  Edge2[Edge2["All"] = 8] = "All";
})(Edge ||= {});
var Errata;
((Errata2) => {
  Errata2[Errata2["None"] = 0] = "None";
  Errata2[Errata2["StretchFlexBasis"] = 1] = "StretchFlexBasis";
  Errata2[Errata2["AbsolutePositionWithoutInsetsExcludesPadding"] = 2] = "AbsolutePositionWithoutInsetsExcludesPadding";
  Errata2[Errata2["AbsolutePercentAgainstInnerSize"] = 4] = "AbsolutePercentAgainstInnerSize";
  Errata2[Errata2["All"] = 2147483647] = "All";
  Errata2[Errata2["Classic"] = 2147483646] = "Classic";
})(Errata ||= {});
var ExperimentalFeature;
((ExperimentalFeature2) => {
  ExperimentalFeature2[ExperimentalFeature2["WebFlexBasis"] = 0] = "WebFlexBasis";
})(ExperimentalFeature ||= {});
var FlexDirection;
((FlexDirection2) => {
  FlexDirection2[FlexDirection2["Column"] = 0] = "Column";
  FlexDirection2[FlexDirection2["ColumnReverse"] = 1] = "ColumnReverse";
  FlexDirection2[FlexDirection2["Row"] = 2] = "Row";
  FlexDirection2[FlexDirection2["RowReverse"] = 3] = "RowReverse";
})(FlexDirection ||= {});
var Gutter;
((Gutter2) => {
  Gutter2[Gutter2["Column"] = 0] = "Column";
  Gutter2[Gutter2["Row"] = 1] = "Row";
  Gutter2[Gutter2["All"] = 2] = "All";
})(Gutter ||= {});
var Justify;
((Justify2) => {
  Justify2[Justify2["FlexStart"] = 0] = "FlexStart";
  Justify2[Justify2["Center"] = 1] = "Center";
  Justify2[Justify2["FlexEnd"] = 2] = "FlexEnd";
  Justify2[Justify2["SpaceBetween"] = 3] = "SpaceBetween";
  Justify2[Justify2["SpaceAround"] = 4] = "SpaceAround";
  Justify2[Justify2["SpaceEvenly"] = 5] = "SpaceEvenly";
})(Justify ||= {});
var LogLevel;
((LogLevel3) => {
  LogLevel3[LogLevel3["Error"] = 0] = "Error";
  LogLevel3[LogLevel3["Warn"] = 1] = "Warn";
  LogLevel3[LogLevel3["Info"] = 2] = "Info";
  LogLevel3[LogLevel3["Debug"] = 3] = "Debug";
  LogLevel3[LogLevel3["Verbose"] = 4] = "Verbose";
  LogLevel3[LogLevel3["Fatal"] = 5] = "Fatal";
})(LogLevel ||= {});
var MeasureMode;
((MeasureMode2) => {
  MeasureMode2[MeasureMode2["Undefined"] = 0] = "Undefined";
  MeasureMode2[MeasureMode2["Exactly"] = 1] = "Exactly";
  MeasureMode2[MeasureMode2["AtMost"] = 2] = "AtMost";
})(MeasureMode ||= {});
var NodeType;
((NodeType2) => {
  NodeType2[NodeType2["Default"] = 0] = "Default";
  NodeType2[NodeType2["Text"] = 1] = "Text";
})(NodeType ||= {});
var Overflow;
((Overflow2) => {
  Overflow2[Overflow2["Visible"] = 0] = "Visible";
  Overflow2[Overflow2["Hidden"] = 1] = "Hidden";
  Overflow2[Overflow2["Scroll"] = 2] = "Scroll";
})(Overflow ||= {});
var PositionType;
((PositionType2) => {
  PositionType2[PositionType2["Static"] = 0] = "Static";
  PositionType2[PositionType2["Relative"] = 1] = "Relative";
  PositionType2[PositionType2["Absolute"] = 2] = "Absolute";
})(PositionType ||= {});
var Unit;
((Unit2) => {
  Unit2[Unit2["Undefined"] = 0] = "Undefined";
  Unit2[Unit2["Point"] = 1] = "Point";
  Unit2[Unit2["Percent"] = 2] = "Percent";
  Unit2[Unit2["Auto"] = 3] = "Auto";
})(Unit ||= {});
var Wrap;
((_Wrap) => {
  _Wrap[_Wrap["NoWrap"] = 0] = "NoWrap";
  _Wrap[_Wrap["Wrap"] = 1] = "Wrap";
  _Wrap[_Wrap["WrapReverse"] = 2] = "WrapReverse";
})(Wrap ||= {});
var ALIGN_AUTO = 0 /* Auto */;
var ALIGN_FLEX_START = 1 /* FlexStart */;
var ALIGN_CENTER = 2 /* Center */;
var ALIGN_FLEX_END = 3 /* FlexEnd */;
var ALIGN_STRETCH = 4 /* Stretch */;
var ALIGN_BASELINE = 5 /* Baseline */;
var ALIGN_SPACE_BETWEEN = 6 /* SpaceBetween */;
var ALIGN_SPACE_AROUND = 7 /* SpaceAround */;
var ALIGN_SPACE_EVENLY = 8 /* SpaceEvenly */;
var BOX_SIZING_BORDER_BOX = 0 /* BorderBox */;
var BOX_SIZING_CONTENT_BOX = 1 /* ContentBox */;
var DIMENSION_WIDTH = 0 /* Width */;
var DIMENSION_HEIGHT = 1 /* Height */;
var DIRECTION_INHERIT = 0 /* Inherit */;
var DIRECTION_LTR = 1 /* LTR */;
var DIRECTION_RTL = 2 /* RTL */;
var DISPLAY_FLEX = 0 /* Flex */;
var DISPLAY_NONE = 1 /* None */;
var DISPLAY_CONTENTS = 2 /* Contents */;
var EDGE_LEFT = 0 /* Left */;
var EDGE_TOP = 1 /* Top */;
var EDGE_RIGHT = 2 /* Right */;
var EDGE_BOTTOM = 3 /* Bottom */;
var EDGE_START = 4 /* Start */;
var EDGE_END = 5 /* End */;
var EDGE_HORIZONTAL = 6 /* Horizontal */;
var EDGE_VERTICAL = 7 /* Vertical */;
var EDGE_ALL = 8 /* All */;
var ERRATA_NONE = 0 /* None */;
var ERRATA_STRETCH_FLEX_BASIS = 1 /* StretchFlexBasis */;
var ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING = 2 /* AbsolutePositionWithoutInsetsExcludesPadding */;
var ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE = 4 /* AbsolutePercentAgainstInnerSize */;
var ERRATA_ALL = 2147483647 /* All */;
var ERRATA_CLASSIC = 2147483646 /* Classic */;
var EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS = 0 /* WebFlexBasis */;
var FLEX_DIRECTION_COLUMN = 0 /* Column */;
var FLEX_DIRECTION_COLUMN_REVERSE = 1 /* ColumnReverse */;
var FLEX_DIRECTION_ROW = 2 /* Row */;
var FLEX_DIRECTION_ROW_REVERSE = 3 /* RowReverse */;
var GUTTER_COLUMN = 0 /* Column */;
var GUTTER_ROW = 1 /* Row */;
var GUTTER_ALL = 2 /* All */;
var JUSTIFY_FLEX_START = 0 /* FlexStart */;
var JUSTIFY_CENTER = 1 /* Center */;
var JUSTIFY_FLEX_END = 2 /* FlexEnd */;
var JUSTIFY_SPACE_BETWEEN = 3 /* SpaceBetween */;
var JUSTIFY_SPACE_AROUND = 4 /* SpaceAround */;
var JUSTIFY_SPACE_EVENLY = 5 /* SpaceEvenly */;
var LOG_LEVEL_ERROR = 0 /* Error */;
var LOG_LEVEL_WARN = 1 /* Warn */;
var LOG_LEVEL_INFO = 2 /* Info */;
var LOG_LEVEL_DEBUG = 3 /* Debug */;
var LOG_LEVEL_VERBOSE = 4 /* Verbose */;
var LOG_LEVEL_FATAL = 5 /* Fatal */;
var MEASURE_MODE_UNDEFINED = 0 /* Undefined */;
var MEASURE_MODE_EXACTLY = 1 /* Exactly */;
var MEASURE_MODE_AT_MOST = 2 /* AtMost */;
var NODE_TYPE_DEFAULT = 0 /* Default */;
var NODE_TYPE_TEXT = 1 /* Text */;
var OVERFLOW_VISIBLE = 0 /* Visible */;
var OVERFLOW_HIDDEN = 1 /* Hidden */;
var OVERFLOW_SCROLL = 2 /* Scroll */;
var POSITION_TYPE_STATIC = 0 /* Static */;
var POSITION_TYPE_RELATIVE = 1 /* Relative */;
var POSITION_TYPE_ABSOLUTE = 2 /* Absolute */;
var UNIT_UNDEFINED = 0 /* Undefined */;
var UNIT_POINT = 1 /* Point */;
var UNIT_PERCENT = 2 /* Percent */;
var UNIT_AUTO = 3 /* Auto */;
var WRAP_NO_WRAP = 0 /* NoWrap */;
var WRAP_WRAP = 1 /* Wrap */;
var WRAP_WRAP_REVERSE = 2 /* WrapReverse */;
var YogaEnumKind = {
  Direction: 0,
  FlexDirection: 1,
  JustifyContent: 2,
  AlignContent: 3,
  AlignItems: 4,
  AlignSelf: 5,
  PositionType: 6,
  FlexWrap: 7,
  Overflow: 8,
  Display: 9,
  BoxSizing: 10
};
var YogaFloatKind = {
  Flex: 0,
  FlexGrow: 1,
  FlexShrink: 2,
  AspectRatio: 3
};
var YogaValueKind = {
  Width: 0,
  Height: 1,
  MinWidth: 2,
  MinHeight: 3,
  MaxWidth: 4,
  MaxHeight: 5,
  FlexBasis: 6,
  Margin: 7,
  Padding: 8,
  Position: 9,
  Gap: 10
};
var YogaEdgeLayoutKind = {
  Margin: 0,
  Padding: 1,
  Border: 2
};
var UNDEFINED_VALUE = { unit: 0 /* Undefined */, value: NaN };
var nodeRegistry = new Map;
var measureRegistry = new Map;
var dirtiedRegistry = new Map;
var measureCallback = null;
var measureCallbackLib = null;
var dirtiedCallback = null;
var dirtiedCallbackLib = null;
function lib() {
  return resolveRenderLib();
}
function ensureMeasureCallback() {
  const renderLib = lib();
  if (measureCallback?.ptr && measureCallbackLib === renderLib)
    return;
  const callback = (node, width, widthMode, height, heightMode) => {
    const measureFunc = node ? measureRegistry.get(node) : undefined;
    const result = measureFunc?.(width, widthMode, height, heightMode);
    renderLib.yogaStoreMeasureResult(result?.width ?? NaN, result?.height ?? NaN);
  };
  measureCallback = renderLib.createYogaMeasureCallback(callback);
  if (!measureCallback.ptr) {
    measureCallback.close();
    measureCallback = null;
    throw new Error("Failed to create Yoga measure callback");
  }
  renderLib.yogaSetMeasureCallback(measureCallback.ptr);
  measureCallbackLib = renderLib;
}
function ensureDirtiedCallback() {
  const renderLib = lib();
  if (dirtiedCallback?.ptr && dirtiedCallbackLib === renderLib)
    return;
  const callback = (node) => {
    if (!node)
      return;
    const registration = dirtiedRegistry.get(node);
    if (registration)
      registration.callback(registration.node);
  };
  dirtiedCallback = renderLib.createYogaDirtiedCallback(callback);
  if (!dirtiedCallback.ptr) {
    dirtiedCallback.close();
    dirtiedCallback = null;
    throw new Error("Failed to create Yoga dirtied callback");
  }
  renderLib.yogaSetDirtiedCallback(dirtiedCallback.ptr);
  dirtiedCallbackLib = renderLib;
}
function isValueObject(value) {
  return typeof value === "object" && value !== null && "unit" in value && "value" in value;
}
function parseValue(value) {
  if (isValueObject(value)) {
    return value;
  }
  if (value === undefined) {
    return UNDEFINED_VALUE;
  }
  if (value === "auto") {
    return { unit: 3 /* Auto */, value: NaN };
  }
  if (typeof value === "string") {
    if (!value.endsWith("%")) {
      throw new Error(`Invalid Yoga value: ${value}`);
    }
    const numberValue = Number.parseFloat(value);
    if (Number.isNaN(numberValue)) {
      throw new Error(`Invalid Yoga percentage value: ${value}`);
    }
    return { unit: 2 /* Percent */, value: numberValue };
  }
  return { unit: 1 /* Point */, value };
}
function unpackValue(packedValue) {
  const packed = typeof packedValue === "bigint" ? packedValue : BigInt(packedValue);
  const unit = Number(packed & 0xffffffffn);
  const valueBits = Number(packed >> 32n & 0xffffffffn);
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, valueBits, true);
  return { unit, value: view.getFloat32(0, true) };
}
function normalizeLayoutInput(value) {
  return value === undefined || value === "auto" ? NaN : value;
}

class Config {
  ptr;
  freed = false;
  constructor(ptr3) {
    this.ptr = ptr3;
  }
  static create() {
    return new Config(lib().yogaConfigCreate());
  }
  static destroy(config) {
    config.free();
  }
  free() {
    if (this.freed)
      return;
    this.freed = true;
    lib().yogaConfigFree(this.ptr);
  }
  setUseWebDefaults(useWebDefaults) {
    if (this.freed)
      return;
    lib().yogaConfigSetUseWebDefaults(this.ptr, useWebDefaults);
  }
  useWebDefaults() {
    if (this.freed)
      return false;
    return lib().yogaConfigGetUseWebDefaults(this.ptr);
  }
  setPointScaleFactor(pointScaleFactor) {
    if (this.freed)
      return;
    lib().yogaConfigSetPointScaleFactor(this.ptr, pointScaleFactor);
  }
  getPointScaleFactor() {
    if (this.freed)
      return 0;
    return lib().yogaConfigGetPointScaleFactor(this.ptr);
  }
  setErrata(errata) {
    if (this.freed)
      return;
    lib().yogaConfigSetErrata(this.ptr, errata);
  }
  getErrata() {
    if (this.freed)
      return 0 /* None */;
    return lib().yogaConfigGetErrata(this.ptr);
  }
  setExperimentalFeatureEnabled(feature, enabled) {
    if (this.freed)
      return;
    lib().yogaConfigSetExperimentalFeatureEnabled(this.ptr, feature, enabled);
  }
  isExperimentalFeatureEnabled(feature) {
    if (this.freed)
      return false;
    return lib().yogaConfigIsExperimentalFeatureEnabled(this.ptr, feature);
  }
}

class Node {
  ptr;
  freed = false;
  constructor(ptr3) {
    this.ptr = ptr3;
    nodeRegistry.set(ptr3, this);
  }
  static create(config) {
    return Node.fromPointer(config ? lib().yogaNodeCreateWithConfig(config.ptr) : lib().yogaNodeCreate());
  }
  static createForOpenTUI() {
    return Node.fromPointer(lib().yogaNodeCreateForOpenTUI());
  }
  static createDefault() {
    return Node.create();
  }
  static createWithConfig(config) {
    return Node.create(config);
  }
  static destroy(node) {
    node.free();
  }
  static fromPointer(ptr3) {
    const existing = nodeRegistry.get(ptr3);
    if (existing)
      return existing;
    return new Node(ptr3);
  }
  isFreed() {
    return this.freed;
  }
  free() {
    if (this.freed)
      return;
    this.unsetMeasureFunc();
    this.unsetDirtiedFunc();
    lib().yogaNodeFree(this.ptr);
    this.markFreed();
  }
  freeRecursive() {
    if (this.freed)
      return;
    const nodes = this.collectSubtree([]);
    for (const node of nodes) {
      node.unregisterCallbacks();
    }
    lib().yogaNodeFreeRecursive(this.ptr);
    for (const node of nodes) {
      node.markFreed();
    }
  }
  reset() {
    if (this.freed)
      return;
    this.unsetMeasureFunc();
    this.unsetDirtiedFunc();
    lib().yogaNodeReset(this.ptr);
  }
  copyStyle(node) {
    if (this.freed)
      return;
    lib().yogaNodeCopyStyle(this.ptr, node.ptr);
  }
  insertChild(child, index) {
    if (this.freed)
      return;
    lib().yogaNodeInsertChild(this.ptr, child.ptr, index);
  }
  removeChild(child) {
    if (this.freed)
      return;
    lib().yogaNodeRemoveChild(this.ptr, child.ptr);
  }
  removeAllChildren() {
    if (this.freed)
      return;
    lib().yogaNodeRemoveAllChildren(this.ptr);
  }
  getChild(index) {
    if (this.freed)
      return null;
    const child = lib().yogaNodeGetChild(this.ptr, index);
    return child ? Node.fromPointer(child) : null;
  }
  getChildCount() {
    if (this.freed)
      return 0;
    return lib().yogaNodeGetChildCount(this.ptr);
  }
  getParent() {
    if (this.freed)
      return null;
    const parent = lib().yogaNodeGetParent(this.ptr);
    return parent ? Node.fromPointer(parent) : null;
  }
  calculateLayout(width, height, direction = 1 /* LTR */) {
    if (this.freed)
      return;
    lib().yogaNodeCalculateLayout(this.ptr, normalizeLayoutInput(width), normalizeLayoutInput(height), direction);
  }
  hasNewLayout() {
    if (this.freed)
      return false;
    return lib().yogaNodeGetHasNewLayout(this.ptr);
  }
  markLayoutSeen() {
    if (this.freed)
      return;
    lib().yogaNodeSetHasNewLayout(this.ptr, false);
  }
  markDirty() {
    if (this.freed)
      return;
    lib().yogaNodeMarkDirty(this.ptr);
  }
  isDirty() {
    if (this.freed)
      return true;
    return lib().yogaNodeIsDirty(this.ptr);
  }
  getComputedLayout() {
    if (this.freed)
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return lib().yogaNodeGetComputedLayout(this.ptr);
  }
  getComputedLeft() {
    return this.getComputedLayout().left;
  }
  getComputedTop() {
    return this.getComputedLayout().top;
  }
  getComputedRight() {
    return this.getComputedLayout().right;
  }
  getComputedBottom() {
    return this.getComputedLayout().bottom;
  }
  getComputedWidth() {
    return this.getComputedLayout().width;
  }
  getComputedHeight() {
    return this.getComputedLayout().height;
  }
  getComputedMargin(edge) {
    if (this.freed)
      return 0;
    return lib().yogaNodeLayoutGetEdge(this.ptr, YogaEdgeLayoutKind.Margin, edge);
  }
  getComputedPadding(edge) {
    if (this.freed)
      return 0;
    return lib().yogaNodeLayoutGetEdge(this.ptr, YogaEdgeLayoutKind.Padding, edge);
  }
  getComputedBorder(edge) {
    if (this.freed)
      return 0;
    return lib().yogaNodeLayoutGetEdge(this.ptr, YogaEdgeLayoutKind.Border, edge);
  }
  setDirection(direction) {
    this.setEnum(YogaEnumKind.Direction, direction);
  }
  getDirection() {
    return this.getEnum(YogaEnumKind.Direction, 0 /* Inherit */);
  }
  setFlexDirection(flexDirection) {
    this.setEnum(YogaEnumKind.FlexDirection, flexDirection);
  }
  getFlexDirection() {
    return this.getEnum(YogaEnumKind.FlexDirection, 0 /* Column */);
  }
  setJustifyContent(justifyContent) {
    this.setEnum(YogaEnumKind.JustifyContent, justifyContent);
  }
  getJustifyContent() {
    return this.getEnum(YogaEnumKind.JustifyContent, 0 /* FlexStart */);
  }
  setAlignContent(alignContent) {
    this.setEnum(YogaEnumKind.AlignContent, alignContent);
  }
  getAlignContent() {
    return this.getEnum(YogaEnumKind.AlignContent, 1 /* FlexStart */);
  }
  setAlignItems(alignItems) {
    this.setEnum(YogaEnumKind.AlignItems, alignItems);
  }
  getAlignItems() {
    return this.getEnum(YogaEnumKind.AlignItems, 4 /* Stretch */);
  }
  setAlignSelf(alignSelf) {
    this.setEnum(YogaEnumKind.AlignSelf, alignSelf);
  }
  getAlignSelf() {
    return this.getEnum(YogaEnumKind.AlignSelf, 0 /* Auto */);
  }
  setPositionType(positionType) {
    this.setEnum(YogaEnumKind.PositionType, positionType);
  }
  getPositionType() {
    return this.getEnum(YogaEnumKind.PositionType, 1 /* Relative */);
  }
  setFlexWrap(flexWrap) {
    this.setEnum(YogaEnumKind.FlexWrap, flexWrap);
  }
  getFlexWrap() {
    return this.getEnum(YogaEnumKind.FlexWrap, 0 /* NoWrap */);
  }
  setOverflow(overflow) {
    this.setEnum(YogaEnumKind.Overflow, overflow);
  }
  getOverflow() {
    return this.getEnum(YogaEnumKind.Overflow, 0 /* Visible */);
  }
  setDisplay(display) {
    this.setEnum(YogaEnumKind.Display, display);
  }
  getDisplay() {
    return this.getEnum(YogaEnumKind.Display, 0 /* Flex */);
  }
  setBoxSizing(boxSizing) {
    this.setEnum(YogaEnumKind.BoxSizing, boxSizing);
  }
  getBoxSizing() {
    return this.getEnum(YogaEnumKind.BoxSizing, 0 /* BorderBox */);
  }
  setFlex(flex) {
    this.setFloat(YogaFloatKind.Flex, flex);
  }
  getFlex() {
    return this.getFloat(YogaFloatKind.Flex);
  }
  setFlexGrow(flexGrow) {
    this.setFloat(YogaFloatKind.FlexGrow, flexGrow);
  }
  getFlexGrow() {
    return this.getFloat(YogaFloatKind.FlexGrow);
  }
  setFlexShrink(flexShrink) {
    this.setFloat(YogaFloatKind.FlexShrink, flexShrink);
  }
  getFlexShrink() {
    return this.getFloat(YogaFloatKind.FlexShrink);
  }
  setAspectRatio(aspectRatio) {
    this.setFloat(YogaFloatKind.AspectRatio, aspectRatio);
  }
  getAspectRatio() {
    return this.getFloat(YogaFloatKind.AspectRatio);
  }
  setFlexBasis(flexBasis) {
    this.setValue(YogaValueKind.FlexBasis, 0, flexBasis);
  }
  setFlexBasisPercent(flexBasis) {
    this.setValue(YogaValueKind.FlexBasis, 0, flexBasis === undefined ? undefined : { unit: 2 /* Percent */, value: flexBasis });
  }
  setFlexBasisAuto() {
    this.setValue(YogaValueKind.FlexBasis, 0, "auto");
  }
  getFlexBasis() {
    return this.getValue(YogaValueKind.FlexBasis, 0);
  }
  setWidth(width) {
    this.setValue(YogaValueKind.Width, 0, width);
  }
  setWidthPercent(width) {
    this.setValue(YogaValueKind.Width, 0, width === undefined ? undefined : { unit: 2 /* Percent */, value: width });
  }
  setWidthAuto() {
    this.setValue(YogaValueKind.Width, 0, "auto");
  }
  getWidth() {
    return this.getValue(YogaValueKind.Width, 0);
  }
  setHeight(height) {
    this.setValue(YogaValueKind.Height, 0, height);
  }
  setHeightPercent(height) {
    this.setValue(YogaValueKind.Height, 0, height === undefined ? undefined : { unit: 2 /* Percent */, value: height });
  }
  setHeightAuto() {
    this.setValue(YogaValueKind.Height, 0, "auto");
  }
  getHeight() {
    return this.getValue(YogaValueKind.Height, 0);
  }
  setMinWidth(minWidth) {
    this.setValue(YogaValueKind.MinWidth, 0, minWidth);
  }
  setMinWidthPercent(minWidth) {
    this.setValue(YogaValueKind.MinWidth, 0, minWidth === undefined ? undefined : { unit: 2 /* Percent */, value: minWidth });
  }
  getMinWidth() {
    return this.getValue(YogaValueKind.MinWidth, 0);
  }
  setMinHeight(minHeight) {
    this.setValue(YogaValueKind.MinHeight, 0, minHeight);
  }
  setMinHeightPercent(minHeight) {
    this.setValue(YogaValueKind.MinHeight, 0, minHeight === undefined ? undefined : { unit: 2 /* Percent */, value: minHeight });
  }
  getMinHeight() {
    return this.getValue(YogaValueKind.MinHeight, 0);
  }
  setMaxWidth(maxWidth) {
    this.setValue(YogaValueKind.MaxWidth, 0, maxWidth);
  }
  setMaxWidthPercent(maxWidth) {
    this.setValue(YogaValueKind.MaxWidth, 0, maxWidth === undefined ? undefined : { unit: 2 /* Percent */, value: maxWidth });
  }
  getMaxWidth() {
    return this.getValue(YogaValueKind.MaxWidth, 0);
  }
  setMaxHeight(maxHeight) {
    this.setValue(YogaValueKind.MaxHeight, 0, maxHeight);
  }
  setMaxHeightPercent(maxHeight) {
    this.setValue(YogaValueKind.MaxHeight, 0, maxHeight === undefined ? undefined : { unit: 2 /* Percent */, value: maxHeight });
  }
  getMaxHeight() {
    return this.getValue(YogaValueKind.MaxHeight, 0);
  }
  setMargin(edge, margin) {
    this.setValue(YogaValueKind.Margin, edge, margin);
  }
  setMarginPercent(edge, margin) {
    this.setValue(YogaValueKind.Margin, edge, margin === undefined ? undefined : { unit: 2 /* Percent */, value: margin });
  }
  setMarginAuto(edge) {
    this.setValue(YogaValueKind.Margin, edge, "auto");
  }
  getMargin(edge) {
    return this.getValue(YogaValueKind.Margin, edge);
  }
  setPadding(edge, padding) {
    this.setValue(YogaValueKind.Padding, edge, padding);
  }
  setPaddingPercent(edge, padding) {
    this.setValue(YogaValueKind.Padding, edge, padding === undefined ? undefined : { unit: 2 /* Percent */, value: padding });
  }
  getPadding(edge) {
    return this.getValue(YogaValueKind.Padding, edge);
  }
  setPosition(edge, position) {
    this.setValue(YogaValueKind.Position, edge, position);
  }
  setPositionPercent(edge, position) {
    this.setValue(YogaValueKind.Position, edge, position === undefined ? undefined : { unit: 2 /* Percent */, value: position });
  }
  setPositionAuto(edge) {
    this.setValue(YogaValueKind.Position, edge, "auto");
  }
  getPosition(edge) {
    return this.getValue(YogaValueKind.Position, edge);
  }
  setGap(gutter, gap) {
    this.setValue(YogaValueKind.Gap, gutter, gap);
  }
  setGapPercent(gutter, gap) {
    this.setValue(YogaValueKind.Gap, gutter, gap === undefined ? undefined : { unit: 2 /* Percent */, value: gap });
  }
  getGap(gutter) {
    return this.getValue(YogaValueKind.Gap, gutter);
  }
  setBorder(edge, border2) {
    if (this.freed)
      return;
    lib().yogaNodeStyleSetBorder(this.ptr, edge, border2 ?? NaN);
  }
  getBorder(edge) {
    if (this.freed)
      return NaN;
    return lib().yogaNodeStyleGetBorder(this.ptr, edge);
  }
  setIsReferenceBaseline(isReferenceBaseline) {
    if (this.freed)
      return;
    lib().yogaNodeSetIsReferenceBaseline(this.ptr, isReferenceBaseline);
  }
  isReferenceBaseline() {
    if (this.freed)
      return false;
    return lib().yogaNodeIsReferenceBaseline(this.ptr);
  }
  setAlwaysFormsContainingBlock(alwaysFormsContainingBlock) {
    if (this.freed)
      return;
    lib().yogaNodeSetAlwaysFormsContainingBlock(this.ptr, alwaysFormsContainingBlock);
  }
  getAlwaysFormsContainingBlock() {
    if (this.freed)
      return false;
    return lib().yogaNodeGetAlwaysFormsContainingBlock(this.ptr);
  }
  setMeasureFunc(measureFunc) {
    if (this.freed)
      return;
    this.unsetMeasureFunc();
    if (!measureFunc)
      return;
    ensureMeasureCallback();
    measureRegistry.set(this.ptr, measureFunc);
    lib().yogaNodeSetMeasureFunc(this.ptr, true);
  }
  unsetMeasureFunc() {
    if (this.freed)
      return;
    lib().yogaNodeUnsetMeasureFunc(this.ptr);
    measureRegistry.delete(this.ptr);
  }
  hasMeasureFunc() {
    if (this.freed)
      return false;
    return lib().yogaNodeHasMeasureFunc(this.ptr);
  }
  setDirtiedFunc(dirtiedFunc) {
    if (this.freed)
      return;
    this.unsetDirtiedFunc();
    if (!dirtiedFunc)
      return;
    ensureDirtiedCallback();
    dirtiedRegistry.set(this.ptr, { node: this, callback: dirtiedFunc });
    lib().yogaNodeSetDirtiedFunc(this.ptr, true);
  }
  unsetDirtiedFunc() {
    if (this.freed)
      return;
    lib().yogaNodeUnsetDirtiedFunc(this.ptr);
    dirtiedRegistry.delete(this.ptr);
  }
  setEnum(kind, value) {
    if (this.freed)
      return;
    lib().yogaNodeStyleSetEnum(this.ptr, kind, value);
  }
  getEnum(kind, fallback) {
    if (this.freed)
      return fallback;
    return lib().yogaNodeStyleGetEnum(this.ptr, kind);
  }
  setFloat(kind, value) {
    if (this.freed)
      return;
    lib().yogaNodeStyleSetFloat(this.ptr, kind, value ?? NaN);
  }
  getFloat(kind) {
    if (this.freed)
      return NaN;
    return lib().yogaNodeStyleGetFloat(this.ptr, kind);
  }
  setValue(kind, edgeOrGutter, valueInput) {
    if (this.freed)
      return;
    const value = parseValue(valueInput);
    lib().yogaNodeStyleSetValue(this.ptr, kind, edgeOrGutter, value.unit, value.value);
  }
  getValue(kind, edgeOrGutter) {
    if (this.freed)
      return UNDEFINED_VALUE;
    return unpackValue(lib().yogaNodeStyleGetValue(this.ptr, kind, edgeOrGutter));
  }
  collectSubtree(nodes) {
    for (let index = 0;index < this.getChildCount(); index++) {
      this.getChild(index)?.collectSubtree(nodes);
    }
    nodes.push(this);
    return nodes;
  }
  unregisterCallbacks() {
    measureRegistry.delete(this.ptr);
    dirtiedRegistry.delete(this.ptr);
  }
  markFreed() {
    this.unregisterCallbacks();
    this.freed = true;
    nodeRegistry.delete(this.ptr);
  }
}
var Yoga = {
  Config,
  Node,
  Align,
  BoxSizing,
  Dimension,
  Direction,
  Display,
  Edge,
  Errata,
  ExperimentalFeature,
  FlexDirection,
  Gutter,
  Justify,
  LogLevel,
  MeasureMode,
  NodeType,
  Overflow,
  PositionType,
  Unit,
  Wrap,
  ALIGN_AUTO,
  ALIGN_FLEX_START,
  ALIGN_CENTER,
  ALIGN_FLEX_END,
  ALIGN_STRETCH,
  ALIGN_BASELINE,
  ALIGN_SPACE_BETWEEN,
  ALIGN_SPACE_AROUND,
  ALIGN_SPACE_EVENLY,
  BOX_SIZING_BORDER_BOX,
  BOX_SIZING_CONTENT_BOX,
  DIMENSION_WIDTH,
  DIMENSION_HEIGHT,
  DIRECTION_INHERIT,
  DIRECTION_LTR,
  DIRECTION_RTL,
  DISPLAY_FLEX,
  DISPLAY_NONE,
  DISPLAY_CONTENTS,
  EDGE_LEFT,
  EDGE_TOP,
  EDGE_RIGHT,
  EDGE_BOTTOM,
  EDGE_START,
  EDGE_END,
  EDGE_HORIZONTAL,
  EDGE_VERTICAL,
  EDGE_ALL,
  ERRATA_NONE,
  ERRATA_STRETCH_FLEX_BASIS,
  ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING,
  ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE,
  ERRATA_ALL,
  ERRATA_CLASSIC,
  EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS,
  FLEX_DIRECTION_COLUMN,
  FLEX_DIRECTION_COLUMN_REVERSE,
  FLEX_DIRECTION_ROW,
  FLEX_DIRECTION_ROW_REVERSE,
  GUTTER_COLUMN,
  GUTTER_ROW,
  GUTTER_ALL,
  JUSTIFY_FLEX_START,
  JUSTIFY_CENTER,
  JUSTIFY_FLEX_END,
  JUSTIFY_SPACE_BETWEEN,
  JUSTIFY_SPACE_AROUND,
  JUSTIFY_SPACE_EVENLY,
  LOG_LEVEL_ERROR,
  LOG_LEVEL_WARN,
  LOG_LEVEL_INFO,
  LOG_LEVEL_DEBUG,
  LOG_LEVEL_VERBOSE,
  LOG_LEVEL_FATAL,
  MEASURE_MODE_UNDEFINED,
  MEASURE_MODE_EXACTLY,
  MEASURE_MODE_AT_MOST,
  NODE_TYPE_DEFAULT,
  NODE_TYPE_TEXT,
  OVERFLOW_VISIBLE,
  OVERFLOW_HIDDEN,
  OVERFLOW_SCROLL,
  POSITION_TYPE_STATIC,
  POSITION_TYPE_RELATIVE,
  POSITION_TYPE_ABSOLUTE,
  UNIT_UNDEFINED,
  UNIT_POINT,
  UNIT_PERCENT,
  UNIT_AUTO,
  WRAP_NO_WRAP,
  WRAP_WRAP,
  WRAP_WRAP_REVERSE
};
var yoga_default = Yoga;

export { toArrayBuffer, singleton, envRegistry, registerEnvVar, clearEnvCache, generateEnvMarkdown, generateEnvColored, env, sleep, stringWidth2 as stringWidth, resolveBundledFilePath, DEFAULT_FOREGROUND_RGB, DEFAULT_BACKGROUND_RGB, normalizeIndexedColorIndex, ansi256IndexToRgb, RGBA, normalizeColorValue, hexToRgb, rgbToHex, hsvToRgb, parseColor, isValidBorderStyle, parseBorderStyle, BorderChars, getBorderFromSides, getBorderSides, borderCharsToArray, BorderCharArrays, KeyEvent, PasteEvent, KeyHandler, InternalKeyHandler, fonts, measureText, getCharacterPositions, coordinateToCharacterIndex, renderFontToFrameBuffer, TextAttributes, ATTRIBUTE_BASE_BITS, ATTRIBUTE_BASE_MASK, getBaseAttributes, DebugOverlayCorner, TargetChannel, createTextAttributes, attributesWithLink, getLinkId, visualizeRenderableTree, isStyledText, StyledText, stringToStyledText, black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite, bgBlack, bgRed, bgGreen, bgYellow, bgBlue, bgMagenta, bgCyan, bgWhite, bold, italic, underline, strikethrough, dim, reverse, blink, fg, bg, link, t, hastToStyledText, SystemClock, nonAlphanumericKeys, terminalNamedSingleStrokeKeys, parseKeypress, LinearScrollAccel, MacOSScrollAccel, parseAlign, parseAlignItems, parseBoxSizing, parseDimension, parseDirection, parseDisplay, parseEdge, parseFlexDirection, parseGutter, parseJustify, parseLogLevel, parseMeasureMode, parseOverflow, parsePositionType, parseUnit, parseWrap, MouseParser, Selection, convertGlobalToLocalSelection, ASCIIFontSelectionHelper, StdinParser, treeSitterToTextChunks, treeSitterToStyledText, addDefaultParsers, TreeSitterClient, DataPathsManager, getDataPaths, extensionToFiletype, basenameToFiletype, extToFiletype, pathToFiletype, infoStringToFiletype, getTreeSitterClient, destroyTreeSitterClient, ExtmarksController, createExtmarksController, TerminalPalette, createTerminalPalette, normalizeTerminalPalette, buildTerminalPaletteSignature, decodePasteBytes, stripAnsiSequences, ClipboardTarget, Clipboard, detectLinks, OptimizedBuffer, TextBuffer, SpanInfoStruct, NativeAudioStreamFormat, NativeAudioStreamState, NativeAudioStreamStateNames, NativeAudioStreamCloseReason, NativeAudioStreamState2 as NativeAudioStreamState1, NativeAudioStreamCloseReason2 as NativeAudioStreamCloseReason1, NativeAudioStreamFormat2 as NativeAudioStreamFormat1, LogLevel2 as LogLevel, NativeMeasureTargetKind, setRenderLibPath, resolveRenderLib, Align, BoxSizing, Dimension, Direction, Display, Edge, Errata, ExperimentalFeature, FlexDirection, Gutter, Justify, LogLevel as LogLevel1, MeasureMode, NodeType, Overflow, PositionType, Unit, Wrap, ALIGN_AUTO, ALIGN_FLEX_START, ALIGN_CENTER, ALIGN_FLEX_END, ALIGN_STRETCH, ALIGN_BASELINE, ALIGN_SPACE_BETWEEN, ALIGN_SPACE_AROUND, ALIGN_SPACE_EVENLY, BOX_SIZING_BORDER_BOX, BOX_SIZING_CONTENT_BOX, DIMENSION_WIDTH, DIMENSION_HEIGHT, DIRECTION_INHERIT, DIRECTION_LTR, DIRECTION_RTL, DISPLAY_FLEX, DISPLAY_NONE, DISPLAY_CONTENTS, EDGE_LEFT, EDGE_TOP, EDGE_RIGHT, EDGE_BOTTOM, EDGE_START, EDGE_END, EDGE_HORIZONTAL, EDGE_VERTICAL, EDGE_ALL, ERRATA_NONE, ERRATA_STRETCH_FLEX_BASIS, ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING, ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE, ERRATA_ALL, ERRATA_CLASSIC, EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS, FLEX_DIRECTION_COLUMN, FLEX_DIRECTION_COLUMN_REVERSE, FLEX_DIRECTION_ROW, FLEX_DIRECTION_ROW_REVERSE, GUTTER_COLUMN, GUTTER_ROW, GUTTER_ALL, JUSTIFY_FLEX_START, JUSTIFY_CENTER, JUSTIFY_FLEX_END, JUSTIFY_SPACE_BETWEEN, JUSTIFY_SPACE_AROUND, JUSTIFY_SPACE_EVENLY, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_INFO, LOG_LEVEL_DEBUG, LOG_LEVEL_VERBOSE, LOG_LEVEL_FATAL, MEASURE_MODE_UNDEFINED, MEASURE_MODE_EXACTLY, MEASURE_MODE_AT_MOST, NODE_TYPE_DEFAULT, NODE_TYPE_TEXT, OVERFLOW_VISIBLE, OVERFLOW_HIDDEN, OVERFLOW_SCROLL, POSITION_TYPE_STATIC, POSITION_TYPE_RELATIVE, POSITION_TYPE_ABSOLUTE, UNIT_UNDEFINED, UNIT_POINT, UNIT_PERCENT, UNIT_AUTO, WRAP_NO_WRAP, WRAP_WRAP, WRAP_WRAP_REVERSE, Config, Node, exports_yoga, yoga_default };

//# debugId=9AB6478EE1CB2A8A64756E2164756E21
//# sourceMappingURL=chunk-bun-t2myhmwd.js.map
