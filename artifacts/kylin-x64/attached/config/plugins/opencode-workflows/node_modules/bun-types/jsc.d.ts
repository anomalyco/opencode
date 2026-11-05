declare module "bun:jsc" {
  /**
   * This used to be called "describe" but it could be confused with the test runner.
   */
  function jscDescribe(value: any): string;
  function jscDescribeArray(args: any[]): string;
  function gcAndSweep(): number;
  function fullGC(): number;
  function edenGC(): number;
  function heapSize(): number;
  function heapStats(): HeapStats;
  function memoryUsage(): MemoryUsage;
  function getRandomSeed(): number;
  function setRandomSeed(value: number): void;
  function isRope(input: string): boolean;
  function callerSourceOrigin(): string;
  function noFTL(func: (...args: any[]) => any): (...args: any[]) => any;
  function noOSRExitFuzzing(func: (...args: any[]) => any): (...args: any[]) => any;
  function optimizeNextInvocation(func: (...args: any[]) => any): void;
  function numberOfDFGCompiles(func: (...args: any[]) => any): number;
  function releaseWeakRefs(): void;
  function totalCompileTime(func: (...args: any[]) => any): number;
  function reoptimizationRetryCount(func: (...args: any[]) => any): number;
  function drainMicrotasks(): void;

  /**
   * Convert a JavaScript value to a binary representation that can be sent to another Bun instance.
   *
   * Internally, this uses the serialization format from WebKit/Safari.
   *
   * @param value A JavaScript value, usually an object or array, to be converted.
   * @returns A SharedArrayBuffer that can be sent to another Bun instance.
   */
  function serialize(value: any, options?: { binaryType?: "arraybuffer" }): SharedArrayBuffer;

  /**
   * Convert a JavaScript value to a binary representation that can be sent to another Bun instance.
   *
   * Internally, this uses the serialization format from WebKit/Safari.
   *
   * @param value A JavaScript value, usually an object or array, to be converted.
   * @returns A Buffer that can be sent to another Bun instance.
   */
  function serialize(value: any, options?: { binaryType: "nodebuffer" }): Buffer;

  /**
   * Convert an ArrayBuffer or Buffer to a JavaScript value compatible with the HTML Structured Clone Algorithm.
   *
   * @param value A serialized value, usually an ArrayBuffer or Buffer, to be converted.
   */
  function deserialize(value: ArrayBufferLike | NodeJS.TypedArray | Buffer): any;

  /**
   * Set the timezone used by Intl, Date, etc.
   *
   * @param timeZone A string representing the time zone to use, such as "America/Los_Angeles"
   *
   * @returns The normalized time zone string
   *
   * You can also set process.env.TZ to the time zone you want to use.
   * You can also view the current timezone with `Intl.DateTimeFormat().resolvedOptions().timeZone`
   */
  function setTimeZone(timeZone: string): string;

  interface HeapStats {
    heapSize: number;
    heapCapacity: number;
    extraMemorySize: number;
    objectCount: number;
    protectedObjectCount: number;
    globalObjectCount: number;
    protectedGlobalObjectCount: number;
    objectTypeCounts: Record<string, number>;
    protectedObjectTypeCounts: Record<string, number>;
  }

  interface MemoryUsage {
    current: number;
    peak: number;
    currentCommit: number;
    peakCommit: number;
    pageFaults: number;
  }

  interface SamplingProfile {
    /**
     * A formatted summary of the top functions
     *
     * Example output:
     * ```js
     *
     * Sampling rate: 100.000000 microseconds. Total samples: 6858
     * Top functions as <numSamples  'functionName#hash:sourceID'>
     * 2948    '#<nil>:8'
     * 393    'visit#<nil>:8'
     * 263    'push#<nil>:8'
     * 164    'scan_ref_scoped#<nil>:8'
     * 164    'walk#<nil>:8'
     * 144    'pop#<nil>:8'
     * 107    'extract_candidates#<nil>:8'
     *  94    'get#<nil>:8'
     *  82    'Function#<nil>:4294967295'
     *  79    'set#<nil>:8'
     *  67    'forEach#<nil>:5'
     *  58    'collapse#<nil>:8'
     * ```
     */
    functions: string;
    /**
     * A formatted summary of the top bytecodes
     *
     * Example output:
     * ```js
     * Tier breakdown:
     * -----------------------------------
     * LLInt:                   106  (1.545640%)
     * Baseline:               2355  (34.339458%)
     * DFG:                    3290  (47.973170%)
     * FTL:                     833  (12.146398%)
     * js builtin:              132  (1.924759%)
     * Wasm:                      0  (0.000000%)
     * Host:                    111  (1.618548%)
     * RegExp:                   15  (0.218723%)
     * C/C++:                     0  (0.000000%)
     * Unknown Executable:      148  (2.158064%)
     *
     * Hottest bytecodes as <numSamples   'functionName#hash:JITType:bytecodeIndex'>
     * 273    'visit#<nil>:DFG:bc#63'
     * 121    'walk#<nil>:DFG:bc#7'
     * 119    '#<nil>:Baseline:bc#1'
     * 82    'Function#<nil>:None:<nil>'
     * 66    '#<nil>:DFG:bc#11'
     * 65    '#<nil>:DFG:bc#33'
     * 58    '#<nil>:Baseline:bc#7'
     * 53    '#<nil>:Baseline:bc#23'
     * 50    'forEach#<nil>:DFG:bc#83'
     * 49    'pop#<nil>:FTL:bc#65'
     * 47    '#<nil>:DFG:bc#99'
     * 45    '#<nil>:DFG:bc#16'
     * 44    '#<nil>:DFG:bc#7'
     * 44    '#<nil>:Baseline:bc#30'
     * 44    'push#<nil>:FTL:bc#214'
     * 41    '#<nil>:DFG:bc#50'
     * 39    'get#<nil>:DFG:bc#27'
     * 39    '#<nil>:Baseline:bc#0'
     * 36    '#<nil>:DFG:bc#27'
     * 36    'Dictionary#<nil>:DFG:bc#41'
     * 36    'visit#<nil>:DFG:bc#81'
     * 36    'get#<nil>:FTL:bc#11'
     * 32    'push#<nil>:FTL:bc#49'
     * 31    '#<nil>:DFG:bc#76'
     * 31    '#<nil>:DFG:bc#10'
     * 31    '#<nil>:DFG:bc#73'
     * 29    'set#<nil>:DFG:bc#28'
     * 28    'in_boolean_context#<nil>:DFG:bc#104'
     * 28    '#<nil>:Baseline:<nil>'
     * 28    'regExpSplitFast#<nil>:None:<nil>'
     * 26    'visit#<nil>:DFG:bc#95'
     * 26    'pop#<nil>:FTL:bc#120'
     * 25    '#<nil>:DFG:bc#23'
     * 25    'push#<nil>:FTL:bc#152'
     * 24    'push#<nil>:FTL:bc#262'
     * 24    '#<nil>:FTL:bc#10'
     * 23    'is_identifier_char#<nil>:DFG:bc#22'
     * 23    'visit#<nil>:DFG:bc#22'
     * 22    '#<nil>:FTL:bc#27'
     * 22    'indexOf#<nil>:None:<nil>'
     * ```
     */
    bytecodes: string;

    /**
     * Stack traces of the top functions
     */
    stackTraces: string[];
  }

  /**
   * Run JavaScriptCore's sampling profiler for a particular function
   *
   * This is pretty low-level.
   *
   * Things to know:
   * - LLint means "Low Level Interpreter", which is the interpreter that runs before any JIT compilation
   * - Baseline is the first JIT compilation tier. It's the least optimized, but the fastest to compile
   * - DFG means "Data Flow Graph", which is the second JIT compilation tier. It has some optimizations, but is slower to compile
   * - FTL means "Faster Than Light", which is the third JIT compilation tier. It has the most optimizations, but is the slowest to compile
   */
  function profile<T extends (...args: any[]) => any>(
    callback: T,
    sampleInterval?: number,
    ...args: Parameters<T>
  ): ReturnType<T> extends Promise<infer U> ? Promise<SamplingProfile> : SamplingProfile;

  /**
   * This returns objects which native code has explicitly protected from being
   * garbage collected
   *
   * By calling this function you create another reference to the object, which
   * will further prevent it from being garbage collected
   *
   * This function is mostly a debugging tool for bun itself.
   *
   * Warning: not all objects returned are supposed to be observable from JavaScript
   */
  function getProtectedObjects(): any[];

  /**
   * Start a remote debugging socket server on the given port.
   *
   * This exposes JavaScriptCore's built-in debugging server.
   *
   * This is untested. May not be supported yet on macOS
   */
  function startRemoteDebugger(host?: string, port?: number): void;

  /**
   * Run JavaScriptCore's sampling profiler
   */
  function startSamplingProfiler(optionalDirectory?: string): void;

  /**
   * Non-recursively estimate the memory usage of an object, excluding the memory usage of
   * properties or other objects it references. For more accurate per-object
   * memory usage, use {@link Bun.generateHeapSnapshot}.
   *
   * This is a best-effort estimate. It may not be 100% accurate. When it's
   * wrong, it may mean the memory is non-contiguous (such as a large array).
   *
   * Passing a primitive type that isn't heap allocated returns 0.
   */
  function estimateShallowMemoryUsageOf(value: object | CallableFunction | bigint | symbol | string): number;
}
