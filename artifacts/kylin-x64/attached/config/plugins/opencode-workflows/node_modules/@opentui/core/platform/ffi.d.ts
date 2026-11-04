declare const pointerBrand: unique symbol;
export type PointerInput = number | bigint;
export type Pointer = PointerInput & {
    readonly [pointerBrand]: "Pointer";
};
type PointerSource = ArrayBufferLike | ArrayBufferView;
type BunPointer = number;
export declare const FFIType: {
    readonly char: "char";
    readonly int8_t: "int8_t";
    readonly i8: "i8";
    readonly uint8_t: "uint8_t";
    readonly u8: "u8";
    readonly int16_t: "int16_t";
    readonly i16: "i16";
    readonly uint16_t: "uint16_t";
    readonly u16: "u16";
    readonly int32_t: "int32_t";
    readonly i32: "i32";
    readonly int: "int";
    readonly uint32_t: "uint32_t";
    readonly u32: "u32";
    readonly int64_t: "int64_t";
    readonly i64: "i64";
    readonly uint64_t: "uint64_t";
    readonly u64: "u64";
    readonly double: "double";
    readonly f64: "f64";
    readonly float: "float";
    readonly f32: "f32";
    readonly bool: "bool";
    readonly ptr: "ptr";
    readonly pointer: "pointer";
    readonly void: "void";
    readonly cstring: "cstring";
    readonly function: "function";
    readonly usize: "usize";
    readonly callback: "callback";
    readonly napi_env: "napi_env";
    readonly napi_value: "napi_value";
    readonly buffer: "buffer";
};
export type FFIType = (typeof FFIType)[keyof typeof FFIType];
export type FFITypeOrString = FFIType;
export interface FFIFunction {
    readonly args?: readonly FFITypeOrString[];
    readonly returns?: FFITypeOrString;
    readonly ptr?: Pointer;
    readonly threadsafe?: boolean;
}
export interface FFICallbackInstance {
    readonly ptr: Pointer | null;
    readonly threadsafe: boolean;
    close(): void;
}
export interface Library<Fns extends Record<string, FFIFunction>> {
    symbols: {
        [K in keyof Fns]: (...args: any[]) => any;
    };
    createCallback(callback: (...args: any[]) => any, definition: FFIFunction): FFICallbackInstance;
    close(): void;
}
interface FfiBackend {
    dlopen<Fns extends Record<string, FFIFunction>>(path: string | URL, symbols: Fns): Library<Fns>;
    ptr(value: PointerSource): Pointer;
    suffix: string;
    toArrayBuffer(pointer: Pointer, offset: number | undefined, length: number): ArrayBuffer;
}
interface BunFFIFunction {
    readonly args?: readonly FFITypeOrString[];
    readonly returns?: FFITypeOrString;
    readonly ptr?: BunPointer;
    readonly threadsafe?: boolean;
}
interface BunFfiLibrary<Fns extends Record<string, BunFFIFunction>> {
    symbols: {
        [K in keyof Fns]: (...args: any[]) => any;
    };
    close(): void;
}
interface BunFfiBackend {
    JSCallback: new (callback: (...args: any[]) => any, definition: BunFFIFunction) => FFICallbackInstance;
    dlopen<Fns extends Record<string, BunFFIFunction>>(path: string | URL, symbols: Fns): BunFfiLibrary<Fns>;
    ptr(value: PointerSource): Pointer;
    suffix: string;
    toArrayBuffer(pointer: BunPointer, offset: number | undefined, length: number): ArrayBuffer;
}
interface NodeFFIFunction {
    readonly arguments: readonly string[];
    readonly return: string;
}
interface NodeDynamicLibrary {
    close(): void;
    registerCallback(signature: NodeFFIFunction, callback: (...args: any[]) => any): bigint;
    unregisterCallback(pointer: bigint): void;
}
interface NodeFfiLibrary {
    readonly lib: NodeDynamicLibrary;
    readonly functions: Record<string, (...args: any[]) => any>;
}
interface NodeFfiBackend {
    dlopen(path: string | null, symbols: Record<string, NodeFFIFunction>): NodeFfiLibrary;
    getRawPointer(source: ArrayBuffer): bigint;
    suffix: string;
    toArrayBuffer(pointer: bigint, length: number, copy?: boolean): ArrayBuffer;
}
export declare const FFI_UNAVAILABLE = "OpenTUI native FFI is not available for this runtime yet";
export declare const BUN_DLOPEN_NULL = "Bun FFI backend does not support dlopen(null)";
export declare const LIBRARY_CLOSED = "Cannot create FFI callback after library.close() has been called";
export declare const NODE_CALLBACK_THREADSAFE = "Node FFI callbacks are same-thread only and do not support threadsafe callbacks";
export declare const NODE_NAPI_UNSUPPORTED = "Node FFI backend does not support Bun N-API FFI types";
export declare const NODE_POINTER_OVERRIDE = "Node FFI backend does not support FFIFunction.ptr overrides";
export declare const NODE_POINTER_ARGUMENT = "Node FFI pointer arguments must be a Pointer, ArrayBuffer, or ArrayBufferView";
export declare const NODE_PTR_VALUE = "node:ffi ptr() only supports ArrayBuffer and ArrayBufferView values backed by ArrayBuffer";
export declare const NODE_STRING_RETURN = "Node FFI backend does not normalize string return values (yet)";
export declare const NODE_USIZE_UNSUPPORTED = "Node FFI backend does not support usize yet";
export declare const POINTER_NEGATIVE = "Pointer must be non-negative";
export declare const POINTER_OFFSET_NEGATIVE = "Pointer offset must be non-negative";
export declare const POINTER_OFFSET_UNSAFE = "Pointer offset must be a safe integer";
export declare const POINTER_UNSAFE = "Pointer exceeds safe integer range";
export declare function toPointer(value: PointerInput): Pointer;
export declare function ffiBool(value: boolean): 0 | 1;
export declare function createBunBackend(bun: BunFfiBackend): FfiBackend;
export declare function createNodeBackend(nodeFfi: NodeFfiBackend): FfiBackend;
export declare const dlopen: <Fns extends Record<string, FFIFunction>>(path: string | URL, symbols: Fns) => Library<Fns>;
export declare const ptr: (value: PointerSource) => Pointer;
export declare const suffix: string;
export declare const toArrayBuffer: (pointer: Pointer, offset: number | undefined, length: number) => ArrayBuffer;
export {};
