/**
 * `bun:ffi` lets you efficiently call C functions & FFI functions from JavaScript
 *  without writing bindings yourself.
 *
 * ```js
 * import {dlopen, CString, ptr} from 'bun:ffi';
 *
 * const lib = dlopen('libsqlite3', {
 * });
 * ```
 *
 * This is powered by just-in-time compiling C wrappers
 * that convert JavaScript types to C types and back. Internally,
 * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
 * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
 *
 * @category FFI
 */
declare module "bun:ffi" {
  enum FFIType {
    char = 0,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -127 and 127
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int8_t = 1,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -127 and 127
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i8 = 1,

    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint8_t = 2,
    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u8 = 2,

    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * in16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int16_t = 3,
    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * in16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i16 = 3,

    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint16_t = 4,
    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to a FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u16 = 4,

    /**
     * 32-bit signed integer
     */
    int32_t = 5,

    /**
     * 32-bit signed integer
     *
     * Alias of {@link FFIType.int32_t}
     */
    i32 = 5,
    /**
     * 32-bit signed integer
     *
     * The same as `int` in C
     *
     * ```c
     * int
     * ```
     */
    int = 5,

    /**
     * 32-bit unsigned integer
     *
     * The same as `unsigned int` in C (on x64 & arm64)
     *
     * C:
     * ```c
     * unsigned int
     * ```
     * JavaScript:
     * ```js
     * ptr(new Uint32Array(1))
     * ```
     */
    uint32_t = 6,
    /**
     * 32-bit unsigned integer
     *
     * Alias of {@link FFIType.uint32_t}
     */
    u32 = 6,

    /**
     * int64 is a 64-bit signed integer
     */
    int64_t = 7,
    /**
     * i64 is a 64-bit signed integer
     */
    i64 = 7,

    /**
     * 64-bit unsigned integer
     */
    uint64_t = 8,
    /**
     * 64-bit unsigned integer
     */
    u64 = 8,

    /**
     * IEEE-754 double precision float
     */
    double = 9,

    /**
     * Alias of {@link FFIType.double}
     */
    f64 = 9,

    /**
     * IEEE-754 single precision float
     */
    float = 10,

    /**
     * Alias of {@link FFIType.float}
     */
    f32 = 10,

    /**
     * Boolean value
     *
     * Must be `true` or `false`. `0` and `1` type coercion is not supported.
     *
     * In C, this corresponds to:
     * ```c
     * bool
     * _Bool
     * ```
     */
    bool = 11,

    /**
     * Pointer value
     *
     * See {@link Bun.FFI.ptr} for more information
     *
     * In C:
     * ```c
     * void*
     * ```
     *
     * In JavaScript:
     * ```js
     * ptr(new Uint8Array(1))
     * ```
     */
    ptr = 12,
    /**
     * Pointer value
     *
     * alias of {@link FFIType.ptr}
     */
    pointer = 12,

    /**
     * void value
     *
     * void arguments are not supported
     *
     * void return type is the default return type
     *
     * In C:
     * ```c
     * void
     * ```
     */
    void = 13,

    /**
     * When used as a `returns`, this will automatically become a {@link CString}.
     *
     * When used in `args` it is equivalent to {@link FFIType.pointer}
     */
    cstring = 14,

    /**
     * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
     * but means you might get a `BigInt` or you might get a `number`.
     *
     * In C, this always becomes `int64_t`
     *
     * In JavaScript, this could be number or it could be BigInt, depending on what
     * value is passed in.
     */
    i64_fast = 15,

    /**
     * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
     * but means you might get a `BigInt` or you might get a `number`.
     *
     * In C, this always becomes `uint64_t`
     *
     * In JavaScript, this could be number or it could be BigInt, depending on what
     * value is passed in.
     */
    u64_fast = 16,
    function = 17,

    napi_env = 18,
    napi_value = 19,
    buffer = 20,
  }

  type Pointer = number & { __pointer__: null };

  // Only the canonical enum members are listed below. `FFIType` declares
  // several alias members (e.g. `i8` for `int8_t`, `pointer` for `ptr`) that
  // share the same numeric value. Including both an enum member and its alias
  // as computed property keys makes `tsgo` report duplicate identifiers, and
  // the resulting lookup type is identical regardless of which alias is used
  // since both resolve to the same numeric key.
  interface FFITypeToArgsType {
    [FFIType.char]: number;
    [FFIType.int8_t]: number;
    [FFIType.uint8_t]: number;
    [FFIType.int16_t]: number;
    [FFIType.uint16_t]: number;
    [FFIType.int32_t]: number;
    [FFIType.uint32_t]: number;
    [FFIType.int64_t]: number | bigint;
    [FFIType.uint64_t]: number | bigint;
    [FFIType.double]: number;
    [FFIType.float]: number;
    [FFIType.bool]: boolean;
    [FFIType.ptr]: NodeJS.TypedArray | Pointer | CString | null;
    [FFIType.void]: undefined;
    [FFIType.cstring]: NodeJS.TypedArray | Pointer | CString | null;
    [FFIType.i64_fast]: number | bigint;
    [FFIType.u64_fast]: number | bigint;
    [FFIType.function]: Pointer | JSCallback; // cannot be null
    [FFIType.napi_env]: unknown;
    [FFIType.napi_value]: unknown;
    [FFIType.buffer]: NodeJS.TypedArray | DataView;
  }
  interface FFITypeToReturnsType {
    [FFIType.char]: number;
    [FFIType.int8_t]: number;
    [FFIType.uint8_t]: number;
    [FFIType.int16_t]: number;
    [FFIType.uint16_t]: number;
    [FFIType.int32_t]: number;
    [FFIType.uint32_t]: number;
    [FFIType.int64_t]: bigint;
    [FFIType.uint64_t]: bigint;
    [FFIType.double]: number;
    [FFIType.float]: number;
    [FFIType.bool]: boolean;
    [FFIType.ptr]: Pointer | null;
    [FFIType.void]: undefined;
    [FFIType.cstring]: CString;
    [FFIType.i64_fast]: number | bigint;
    [FFIType.u64_fast]: number | bigint;
    [FFIType.function]: Pointer | null;
    [FFIType.napi_env]: unknown;
    [FFIType.napi_value]: unknown;
    [FFIType.buffer]: NodeJS.TypedArray | DataView;
  }
  interface FFITypeStringToType {
    ["char"]: FFIType.char;
    ["int8_t"]: FFIType.int8_t;
    ["i8"]: FFIType.i8;
    ["uint8_t"]: FFIType.uint8_t;
    ["u8"]: FFIType.u8;
    ["int16_t"]: FFIType.int16_t;
    ["i16"]: FFIType.i16;
    ["uint16_t"]: FFIType.uint16_t;
    ["u16"]: FFIType.u16;
    ["int32_t"]: FFIType.int32_t;
    ["i32"]: FFIType.i32;
    ["int"]: FFIType.int;
    ["uint32_t"]: FFIType.uint32_t;
    ["u32"]: FFIType.u32;
    ["int64_t"]: FFIType.int64_t;
    ["i64"]: FFIType.i64;
    ["uint64_t"]: FFIType.uint64_t;
    ["u64"]: FFIType.u64;
    ["double"]: FFIType.double;
    ["f64"]: FFIType.f64;
    ["float"]: FFIType.float;
    ["f32"]: FFIType.f32;
    ["bool"]: FFIType.bool;
    ["ptr"]: FFIType.ptr;
    ["pointer"]: FFIType.pointer;
    ["void"]: FFIType.void;
    ["cstring"]: FFIType.cstring;
    ["function"]: FFIType.pointer; // for now
    ["usize"]: FFIType.uint64_t; // for now
    ["callback"]: FFIType.pointer; // for now
    ["napi_env"]: FFIType.napi_env;
    ["napi_value"]: FFIType.napi_value;
    ["buffer"]: FFIType.buffer;
  }

  type FFITypeOrString = FFIType | keyof FFITypeStringToType;

  interface FFIFunction {
    /**
     * Arguments to a FFI function (C ABI)
     *
     * Defaults to an empty array, which means no arguments.
     *
     * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
     *
     * @example
     * From JavaScript:
     * ```ts
     * import { dlopen, FFIType, suffix } from "bun:ffi"
     *
     * const lib = dlopen(`adder.${suffix}`, {
     * 	add: {
     * 		// FFIType can be used or you can pass string labels.
     * 		args: [FFIType.i32, "i32"],
     * 		returns: "i32",
     * 	},
     * })
     * lib.symbols.add(1, 2)
     * ```
     * In C:
     * ```c
     * int add(int a, int b) {
     *   return a + b;
     * }
     * ```
     */
    readonly args?: readonly FFITypeOrString[];
    /**
     * Return type to a FFI function (C ABI)
     *
     * Defaults to {@link FFIType.void}
     *
     * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
     *
     * @example
     * From JavaScript:
     * ```ts
     * import { dlopen, CString } from "bun:ffi"
     *
     * const lib = dlopen('z', {
     *    version: {
     *      returns: "ptr",
     *   }
     * });
     * console.log(new CString(lib.symbols.version()));
     * ```
     * In C:
     * ```c
     * char* version()
     * {
     *  return "1.0.0";
     * }
     * ```
     */
    readonly returns?: FFITypeOrString;

    /**
     * Function pointer to the native function
     *
     * If provided, instead of using dlsym() to lookup the function, Bun will use this instead.
     * This pointer should not be null (0).
     *
     * This is useful if the library has already been loaded
     * or if the module is also using Node-API.
     */
    readonly ptr?: Pointer | bigint;

    /**
     * Can C/FFI code call this function from a separate thread?
     *
     * Only supported with {@link JSCallback}.
     *
     * This does not make the function run in a separate thread. It is still up to the application/library
     * to run their code in a separate thread.
     *
     * By default, {@link JSCallback} calls are not thread-safe. Turning this on
     * incurs a small performance penalty for every function call. That small
     * performance penalty needs to be less than the performance gain from
     * running the function in a separate thread.
     *
     * @default false
     */
    readonly threadsafe?: boolean;
  }

  type Symbols = Readonly<Record<string, FFIFunction>>;

  interface Library<Fns extends Symbols> {
    symbols: ConvertFns<Fns>;

    /**
     * `dlclose` the library, unloading the symbols and freeing allocated memory.
     *
     * Once called, the library is no longer usable.
     *
     * Calling a function from a library that has been closed is undefined behavior.
     */
    close(): void;
  }

  type ToFFIType<T extends FFITypeOrString> = T extends FFIType ? T : T extends string ? FFITypeStringToType[T] : never;

  const FFIFunctionCallableSymbol: unique symbol;
  type ConvertFns<Fns extends Symbols> = {
    [K in keyof Fns]: {
      (
        ...args: Fns[K]["args"] extends infer A extends readonly FFITypeOrString[]
          ? { [L in keyof A]: FFITypeToArgsType[ToFFIType<A[L]>] }
          : // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
            [unknown] extends [Fns[K]["args"]]
            ? []
            : never
      ): [unknown] extends [Fns[K]["returns"]] // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
        ? undefined
        : FFITypeToReturnsType[ToFFIType<NonNullable<Fns[K]["returns"]>>];
      __ffi_function_callable: typeof FFIFunctionCallableSymbol;
    };
  };

  /**
   * Open a library using `"bun:ffi"`
   *
   * @param name The name of the library or file path. This will be passed to `dlopen()`
   * @param symbols Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
   *
   * @example
   *
   * ```js
   * import {dlopen} from 'bun:ffi';
   *
   * const lib = dlopen("duckdb.dylib", {
   *   get_version: {
   *     returns: "cstring",
   *     args: [],
   *   },
   * });
   * lib.symbols.get_version();
   * // "1.0.0"
   * ```
   *
   * This is powered by just-in-time compiling C wrappers
   * that convert JavaScript types to C types and back. Internally,
   * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
   * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
   *
   * @category FFI
   */
  function dlopen<Fns extends Record<string, FFIFunction>>(
    name: string | import("bun").BunFile | URL,
    symbols: Fns,
  ): Library<Fns>;

  /**
   * **Experimental:** Compile ISO C11 source code using TinyCC, and make {@link symbols} available as functions to JavaScript.
   *
   * @param options
   * @returns Library<Fns>
   *
   * @example
   * ## Hello, World!
   *
   * JavaScript:
   * ```js
   * import { cc } from "bun:ffi";
   * import source from "./hello.c" with {type: "file"};
   * const {symbols: {hello}} = cc({
   *   source,
   *   symbols: {
   *     hello: {
   *       returns: "cstring",
   *       args: [],
   *     },
   *   },
   * });
   * // "Hello, World!"
   * console.log(hello());
   * ```
   *
   * `./hello.c`:
   * ```c
   * #include <stdio.h>
   * const char* hello() {
   *   return "Hello, World!";
   * }
   * ```
   */
  function cc<Fns extends Record<string, FFIFunction>>(options: {
    /**
     * File path to an ISO C11 source file to compile and link
     */
    source: string | import("bun").BunFile | URL;

    /**
     * Library names to link against
     *
     * Equivalent to `-l` option in gcc/clang.
     */
    library?: string[] | string;

    /**
     * Include directories to pass to the compiler
     *
     * Equivalent to `-I` option in gcc/clang.
     */
    include?: string[] | string;

    /**
     * Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
     */
    symbols: Fns;

    /**
     * Map of symbols to define where the key is the symbol name and the value is the symbol value
     *
     * Equivalent to `-D` option in gcc/clang.
     *
     * @example
     * ```js
     * import { cc } from "bun:ffi";
     * import source from "./hello.c" with {type: "file"};
     * const {symbols: {hello}} = cc({
     *   source,
     *   define: {
     *     "NDEBUG": "1",
     *   },
     *   symbols: {
     *     hello: {
     *       returns: "cstring",
     *       args: [],
     *     },
     *   },
     * });
     * ```
     */
    define?: Record<string, string>;

    /**
     * Flags to pass to the compiler. Note: we do not make gurantees about which specific version of the compiler is used.
     *
     * @default "-std=c11 -Wl,--export-all-symbols -g -O2"
     *
     * This is useful for passing macOS frameworks to link against. Or if there are other options you want to pass to the compiler.
     *
     * @example
     * ```js
     * import { cc } from "bun:ffi";
     * import source from "./hello.c" with {type: "file"};
     * const {symbols: {hello}} = cc({
     *   source,
     *   flags: ["-framework CoreFoundation", "-framework Security"],
     *   symbols: {
     *     hello: {
     *       returns: "cstring",
     *       args: [],
     *     },
     *   },
     * });
     * ```
     */
    flags?: string | string[];
  }): Library<Fns>;

  /**
   * Turn a native library's function pointer into a JavaScript function
   *
   * Libraries using Node-API & bun:ffi in the same module could use this to skip an extra dlopen() step.
   *
   * @param fn {@link FFIFunction} declaration. `ptr` is required
   *
   * @example
   *
   * ```js
   * import {CFunction} from 'bun:ffi';
   *
   * const getVersion = new CFunction({
   *   returns: "cstring",
   *   args: [],
   *   ptr: myNativeLibraryGetVersion,
   * });
   * getVersion();
   * getVersion.close();
   * ```
   *
   * This is powered by just-in-time compiling C wrappers
   * that convert JavaScript types to C types and back. Internally,
   * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
   * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
   */
  function CFunction(fn: FFIFunction & { ptr: Pointer }): CallableFunction & {
    /**
     * Free the memory allocated by the wrapping function
     */
    close(): void;
  };

  /**
   * Link a map of symbols to JavaScript functions
   *
   * This lets you use native libraries that were already loaded somehow. You usually will want {@link dlopen} instead.
   *
   * You could use this with Node-API to skip loading a second time.
   *
   * @param symbols Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
   *
   * @example
   *
   * ```js
   * import { linkSymbols } from "bun:ffi";
   *
   * const [majorPtr, minorPtr, patchPtr] = getVersionPtrs();
   *
   * const lib = linkSymbols({
   *   // Unlike with dlopen(), the names here can be whatever you want
   *   getMajor: {
   *     returns: "cstring",
   *     args: [],
   *
   *     // Since this doesn't use dlsym(), you have to provide a valid ptr
   *     // That ptr could be a number or a bigint
   *     // An invalid pointer will crash your program.
   *     ptr: majorPtr,
   *   },
   *   getMinor: {
   *     returns: "cstring",
   *     args: [],
   *     ptr: minorPtr,
   *   },
   *   getPatch: {
   *     returns: "cstring",
   *     args: [],
   *     ptr: patchPtr,
   *   },
   * });
   *
   * const [major, minor, patch] = [
   *   lib.symbols.getMajor(),
   *   lib.symbols.getMinor(),
   *   lib.symbols.getPatch(),
   * ];
   * ```
   *
   * This is powered by just-in-time compiling C wrappers
   * that convert JavaScript types to C types and back. Internally,
   * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
   * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
   */
  function linkSymbols<Fns extends Record<string, FFIFunction>>(symbols: Fns): Library<Fns>;

  /**
   * Read a pointer as a {@link Buffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */
  function toBuffer(ptr: Pointer, byteOffset?: number, byteLength?: number): Buffer;

  /**
   * Read a pointer as an {@link ArrayBuffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */
  function toArrayBuffer(ptr: Pointer, byteOffset?: number, byteLength?: number): ArrayBuffer;

  namespace read {
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function u8(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function i8(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function u16(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function i16(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function u32(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function i32(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function f32(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function u64(ptr: Pointer, byteOffset?: number): bigint;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function i64(ptr: Pointer, byteOffset?: number): bigint;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function f64(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function ptr(ptr: Pointer, byteOffset?: number): number;
    /**
     * The read function behaves similarly to DataView,
     * but it's usually faster because it doesn't need to create a DataView or ArrayBuffer.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    function intptr(ptr: Pointer, byteOffset?: number): number;
  }

  /**
   * Get the pointer backing a {@link TypedArray} or {@link ArrayBuffer}
   *
   * Use this to pass {@link TypedArray} or {@link ArrayBuffer} to C functions.
   *
   * This is for use with FFI functions. For performance reasons, FFI will
   * not automatically convert typed arrays to C pointers.
   *
   * @param {TypedArray|ArrayBuffer|DataView} view the typed array or array buffer to get the pointer for
   * @param {number} byteOffset optional offset into the view in bytes
   *
   * @example
   *
   * From JavaScript:
   * ```js
   * const array = new Uint8Array(10);
   * const rawPtr = ptr(array);
   * myFFIFunction(rawPtr);
   * ```
   * To C:
   * ```c
   * void myFFIFunction(char* rawPtr) {
   *  // Do something with rawPtr
   * }
   * ```
   *
   * @category FFI
   */
  function ptr(view: NodeJS.TypedArray | ArrayBufferLike | DataView, byteOffset?: number): Pointer;

  /**
   * Get a string from a UTF-8 encoded C string
   * If `byteLength` is not provided, the string is assumed to be null-terminated.
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * console.log(new CString(ptr));
   * ```
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * // print the first 4 characters
   * console.log(new CString(ptr, 0, 4));
   * ```
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   *
   * @category FFI
   */
  class CString extends String {
    /**
     * Get a string from a UTF-8 encoded C string
     * If `byteLength` is not provided, the string is assumed to be null-terminated.
     *
     * @param ptr The pointer to the C string
     * @param byteOffset bytes to skip before reading
     * @param byteLength bytes to read
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * console.log(new CString(ptr));
     * ```
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * // print the first 4 characters
     * console.log(new CString(ptr, 0, 4));
     * ```
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    constructor(ptr: Pointer, byteOffset?: number, byteLength?: number);

    /**
     * The ptr to the C string
     *
     * This `CString` instance is a clone of the string, so it
     * is safe to continue using this instance after the `ptr` has been
     * freed.
     */
    ptr: Pointer;
    byteOffset?: number;
    byteLength?: number;

    /**
     * Get the {@link ptr} as an `ArrayBuffer`
     *
     * `null` or empty ptrs returns an `ArrayBuffer` with `byteLength` 0
     */
    get arrayBuffer(): ArrayBuffer;
  }

  /**
   * Pass a JavaScript function to FFI (Foreign Function Interface)
   */
  class JSCallback {
    /**
     * Enable a JavaScript callback function to be passed to C with bun:ffi
     *
     * @param callback The JavaScript function to be called
     * @param definition The C function definition
     */
    constructor(callback: (...args: any[]) => any, definition: FFIFunction);

    /**
     * The pointer to the C function
     *
     * Becomes `null` once {@link JSCallback.prototype.close} is called
     */
    readonly ptr: Pointer | null;

    /**
     * Can the callback be called from a different thread?
     */
    readonly threadsafe: boolean;

    /**
     * Free the memory allocated for the callback
     *
     * If called multiple times, does nothing after the first call.
     */
    close(): void;
  }

  /**
   * View the generated C code for FFI bindings
   *
   * You probably won't need this unless there's a bug in the FFI bindings
   * generator or you're just curious.
   */
  function viewSource(symbols: Symbols, is_callback?: false): string[];
  function viewSource(callback: FFIFunction, is_callback: true): string;

  /**
   * Platform-specific file extension name for dynamic libraries
   *
   * "." is not included
   *
   * @example
   * ```js
   * "dylib" // macOS
   * ```
   *
   * @example
   * ```js
   * "so" // linux
   * ```
   */
  const suffix: string;
}
