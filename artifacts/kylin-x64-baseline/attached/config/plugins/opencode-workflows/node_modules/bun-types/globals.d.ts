declare module "bun" {
  namespace __internal {
    type NodeCryptoWebcryptoCryptoKey = import("crypto").webcrypto.CryptoKey;
    type NodeCryptoWebcryptoCryptoKeyPair = import("crypto").webcrypto.CryptoKeyPair;

    type LibEmptyOrNodeCryptoWebcryptoSubtleCrypto = LibDomIsLoaded extends true
      ? {}
      : import("crypto").webcrypto.SubtleCrypto;

    type LibWorkerOrBunWorker = LibDomIsLoaded extends true ? {} : Bun.Worker;
    type LibEmptyOrBunWebSocket = LibDomIsLoaded extends true ? {} : Bun.WebSocket;

    type LibEmptyOrNodeStreamWebCompressionStream = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").CompressionStream;
    type LibEmptyOrNodeStreamWebDecompressionStream = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").DecompressionStream;

    type LibPerformanceOrNodePerfHooksPerformance = LibDomIsLoaded extends true
      ? {}
      : import("node:perf_hooks").Performance;
    type LibEmptyOrPerformanceEntry = LibDomIsLoaded extends true ? {} : import("node:perf_hooks").PerformanceEntry;
    type LibEmptyOrPerformanceMark = LibDomIsLoaded extends true ? {} : import("node:perf_hooks").PerformanceMark;
    type LibEmptyOrPerformanceMeasure = LibDomIsLoaded extends true ? {} : import("node:perf_hooks").PerformanceMeasure;
    type LibEmptyOrPerformanceObserver = LibDomIsLoaded extends true
      ? {}
      : import("node:perf_hooks").PerformanceObserver;
    type LibEmptyOrPerformanceObserverEntryList = LibDomIsLoaded extends true
      ? {}
      : import("node:perf_hooks").PerformanceObserverEntryList;
    type LibEmptyOrPerformanceResourceTiming = LibDomIsLoaded extends true
      ? {}
      : import("node:perf_hooks").PerformanceResourceTiming;

    type LibEmptyOrNodeUtilTextEncoder = LibDomIsLoaded extends true ? {} : import("node:util").TextEncoder;
    type LibEmptyOrNodeStreamWebTextEncoderStream = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").TextEncoderStream;

    type LibEmptyOrNodeUtilTextDecoder = LibDomIsLoaded extends true ? {} : import("node:util").TextDecoder;
    type LibEmptyOrNodeStreamWebTextDecoderStream = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").TextDecoderStream;

    type LibEmptyOrNodeReadableStream<T> = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").ReadableStream<T>;

    type LibEmptyOrNodeWritableStream<T> = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").WritableStream<T>;

    type LibEmptyOrNodeMessagePort = LibDomIsLoaded extends true ? {} : import("node:worker_threads").MessagePort;
    type LibEmptyOrBroadcastChannel = LibDomIsLoaded extends true ? {} : import("node:worker_threads").BroadcastChannel;
    type LibEmptyOrEventSource = LibDomIsLoaded extends true ? {} : import("undici-types").EventSource;

    type LibEmptyOrReadableByteStreamController = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").ReadableByteStreamController;

    type LibEmptyOrReadableStreamBYOBReader = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").ReadableStreamBYOBReader;

    type LibEmptyOrReadableStreamBYOBRequest = LibDomIsLoaded extends true
      ? {}
      : import("node:stream/web").ReadableStreamBYOBRequest;
  }
}

interface ReadableStream<R = any> extends Bun.__internal.LibEmptyOrNodeReadableStream<R> {}
declare var ReadableStream: Bun.__internal.UseLibDomIfAvailable<
  "ReadableStream",
  {
    prototype: ReadableStream;
    new <R = any>(underlyingSource?: Bun.UnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
    new <R = any>(underlyingSource?: Bun.DirectUnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
  }
>;

interface WritableStream<W = any> extends Bun.__internal.LibEmptyOrNodeWritableStream<W> {}
declare var WritableStream: Bun.__internal.UseLibDomIfAvailable<
  "WritableStream",
  {
    prototype: WritableStream;
    new <W = any>(underlyingSink?: Bun.UnderlyingSink<W>, strategy?: QueuingStrategy<W>): WritableStream<W>;
  }
>;

interface CompressionStream extends Bun.__internal.LibEmptyOrNodeStreamWebCompressionStream {}
declare var CompressionStream: Bun.__internal.UseLibDomIfAvailable<
  "CompressionStream",
  {
    prototype: CompressionStream;
    new (format: Bun.CompressionFormat): CompressionStream;
  }
>;

interface DecompressionStream extends Bun.__internal.LibEmptyOrNodeStreamWebDecompressionStream {}
declare var DecompressionStream: Bun.__internal.UseLibDomIfAvailable<
  "DecompressionStream",
  {
    prototype: DecompressionStream;
    new (format: Bun.CompressionFormat): DecompressionStream;
  }
>;

interface Worker extends Bun.__internal.LibWorkerOrBunWorker {}
declare var Worker: Bun.__internal.UseLibDomIfAvailable<
  "Worker",
  {
    prototype: Worker;
    new (scriptURL: string | URL, options?: Bun.WorkerOptions | undefined): Worker;
    /**
     * This is the cloned value of the `data` property passed to `new Worker()`
     *
     * This is Bun's equivalent of `workerData` in Node.js.
     */
    data: any;
  }
>;

/**
 * A WebSocket client implementation.
 */
interface WebSocket extends Bun.__internal.LibEmptyOrBunWebSocket {}
/**
 * A WebSocket client implementation
 */
declare var WebSocket: Bun.__internal.UseLibDomIfAvailable<
  "WebSocket",
  {
    prototype: WebSocket;

    /**
     * Creates a new WebSocket instance with the given URL and options.
     *
     * @param url The URL to connect to.
     * @param options The options to use for the connection.
     *
     * @example
     * ```ts
     * const ws = new WebSocket("wss://dev.local", {
     *  protocols: ["proto1", "proto2"],
     *  headers: {
     *    "Cookie": "session=123456",
     *  },
     * });
     * ```
     */
    new (url: string | URL, options?: Bun.WebSocketOptions): WebSocket;

    /**
     * Creates a new WebSocket instance with the given URL and protocols.
     *
     * @param url The URL to connect to.
     * @param protocols The protocols to use for the connection.
     *
     * @example
     * ```ts
     * const ws = new WebSocket("wss://dev.local");
     * const ws = new WebSocket("wss://dev.local", ["proto1", "proto2"]);
     * ```
     */
    new (url: string | URL, protocols?: string | string[]): WebSocket;

    /**
     * The connection is not yet open
     */
    readonly CONNECTING: 0;

    /**
     * The connection is open and ready to communicate
     */
    readonly OPEN: 1;

    /**
     * The connection is in the process of closing
     */
    readonly CLOSING: 2;

    /**
     * The connection is closed or couldn't be opened
     */
    readonly CLOSED: 3;
  }
>;

interface Crypto {
  readonly subtle: SubtleCrypto;

  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/getRandomValues) */
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;

  /**
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/randomUUID)
   */
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;

  timingSafeEqual: typeof import("node:crypto").timingSafeEqual;
}
declare var Crypto: {
  prototype: Crypto;
  new (): Crypto;
};
declare var crypto: Crypto;

/**
 * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextEncoder` API. All
 * instances of `TextEncoder` only support UTF-8 encoding.
 *
 * ```js
 * const encoder = new TextEncoder();
 * const uint8array = encoder.encode('this is some data');
 * ```
 */
interface TextEncoder extends Bun.__internal.LibEmptyOrNodeUtilTextEncoder {
  /**
   * UTF-8 encodes the `src` string to the `dest` Uint8Array and returns an object
   * containing the read Unicode code units and written UTF-8 bytes.
   *
   * ```js
   * const encoder = new TextEncoder();
   * const src = 'this is some data';
   * const dest = new Uint8Array(10);
   * const { read, written } = encoder.encodeInto(src, dest);
   * ```
   * @param src The text to encode.
   * @param dest The array to hold the encode result.
   */
  encodeInto(src?: string, dest?: Bun.BufferSource): import("node:util").TextEncoderEncodeIntoResult;
}
declare var TextEncoder: Bun.__internal.UseLibDomIfAvailable<
  "TextEncoder",
  {
    prototype: TextEncoder;
    new (encoding?: Bun.Encoding, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextEncoder;
  }
>;

/**
 * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextDecoder` API. All
 * instances of `TextDecoder` only support UTF-8 decoding.
 *
 * ```js
 * const decoder = new TextDecoder();
 * const uint8array = decoder.decode('this is some data');
 */
interface TextDecoder extends Bun.__internal.LibEmptyOrNodeUtilTextDecoder {}
declare var TextDecoder: Bun.__internal.UseLibDomIfAvailable<
  "TextDecoder",
  {
    prototype: TextDecoder;
    new (encoding?: Bun.Encoding, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoder;
  }
>;

interface Event {
  /** This is not used in Node.js and is provided purely for completeness. */
  readonly bubbles: boolean;
  /** Alias for event.stopPropagation(). This is not used in Node.js and is provided purely for completeness. */
  cancelBubble: boolean;
  /** True if the event was created with the cancelable option */
  readonly cancelable: boolean;
  /** This is not used in Node.js and is provided purely for completeness. */
  readonly composed: boolean;
  /** Returns an array containing the current EventTarget as the only entry or empty if the event is not being dispatched. This is not used in Node.js and is provided purely for completeness. */
  composedPath(): [EventTarget?];
  /** Alias for event.target. */
  readonly currentTarget: EventTarget | null;
  /** Is true if cancelable is true and event.preventDefault() has been called. */
  readonly defaultPrevented: boolean;
  /** This is not used in Node.js and is provided purely for completeness. */
  readonly eventPhase: number;
  /** The `AbortSignal` "abort" event is emitted with `isTrusted` set to `true`. The value is `false` in all other cases. */
  readonly isTrusted: boolean;
  /** Sets the `defaultPrevented` property to `true` if `cancelable` is `true`. */
  preventDefault(): void;
  /** This is not used in Node.js and is provided purely for completeness. */
  returnValue: boolean;
  /** Alias for event.target. */
  readonly srcElement: EventTarget | null;
  /** Stops the invocation of event listeners after the current one completes. */
  stopImmediatePropagation(): void;
  /** This is not used in Node.js and is provided purely for completeness. */
  stopPropagation(): void;
  /** The `EventTarget` dispatching the event */
  readonly target: EventTarget | null;
  /** The millisecond timestamp when the Event object was created. */
  readonly timeStamp: number;
  /** Returns the type of event, e.g. "click", "hashchange", or "submit". */
  readonly type: string;
}
declare var Event: {
  prototype: Event;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
  new (type: string, eventInitDict?: Bun.EventInit): Event;
};

interface EventTarget {
  /**
   * Adds a new handler for the `type` event. Any given `listener` is added only once per `type` and per `capture` option value.
   *
   * If the `once` option is true, the `listener` is removed after the next time a `type` event is dispatched.
   *
   * The `capture` option is not used by Node.js in any functional way other than tracking registered event listeners per the `EventTarget` specification.
   * Specifically, the `capture` option is used as part of the key when registering a `listener`.
   * Any individual `listener` may be added once with `capture = false`, and once with `capture = true`.
   */
  addEventListener(
    type: string,
    listener: EventListener | EventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  /** Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise. */
  dispatchEvent(event: Event): boolean;
  /** Removes the event listener in target's event listener list with the same type, callback, and options. */
  removeEventListener(
    type: string,
    listener: EventListener | EventListenerObject,
    options?: Bun.EventListenerOptions | boolean,
  ): void;
}
declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

interface File extends Blob {
  readonly lastModified: number;
  readonly name: string;
}
declare var File: Bun.__internal.UseLibDomIfAvailable<
  "File",
  {
    prototype: File;
    /**
     * Create a new [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
     *
     * @param `parts` - An array of strings, numbers, BufferSource, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
     * @param `name` - The name of the file
     * @param `options` - An object containing properties to be added to the [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
     */
    new (
      parts: Bun.BlobPart[],
      name: string,
      options?: BlobPropertyBag & { lastModified?: Date | number | undefined },
    ): File;
  }
>;

/**
 * ShadowRealms are a distinct global environment, with its own global object
 * containing its own intrinsics and built-ins (standard objects that are not
 * bound to global variables, like the initial value of Object.prototype).
 *
 * @example
 *
 * ```js
 * const red = new ShadowRealm();
 *
 * // realms can import modules that will execute within it's own environment.
 * // When the module is resolved, it captured the binding value, or creates a new
 * // wrapped function that is connected to the callable binding.
 * const redAdd = await red.importValue('./inside-code.js', 'add');
 *
 * // redAdd is a wrapped function exotic object that chains it's call to the
 * // respective imported binding.
 * let result = redAdd(2, 3);
 *
 * console.assert(result === 5); // yields true
 *
 * // The evaluate method can provide quick code evaluation within the constructed
 * // shadowRealm without requiring any module loading, while it still requires CSP
 * // relaxing.
 * globalThis.someValue = 1;
 * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
 * console.assert(globalThis.someValue === 1);
 *
 * // The wrapped functions can also wrap other functions the other way around.
 * const setUniqueValue =
 * await red.importValue('./inside-code.js', 'setUniqueValue');
 *
 * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
 *
 * result = setUniqueValue((x) => x ** 3);
 *
 * console.assert(result === 16); // yields true
 * ```
 */
interface ShadowRealm {
  /**
   * Creates a new [ShadowRealm](https://github.com/tc39/proposal-shadowrealm/blob/main/explainer.md#introduction)
   *
   * @example
   *
   * ```js
   * const red = new ShadowRealm();
   *
   * // realms can import modules that will execute within it's own environment.
   * // When the module is resolved, it captured the binding value, or creates a new
   * // wrapped function that is connected to the callable binding.
   * const redAdd = await red.importValue('./inside-code.js', 'add');
   *
   * // redAdd is a wrapped function exotic object that chains it's call to the
   * // respective imported binding.
   * let result = redAdd(2, 3);
   *
   * console.assert(result === 5); // yields true
   *
   * // The evaluate method can provide quick code evaluation within the constructed
   * // shadowRealm without requiring any module loading, while it still requires CSP
   * // relaxing.
   * globalThis.someValue = 1;
   * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
   * console.assert(globalThis.someValue === 1);
   *
   * // The wrapped functions can also wrap other functions the other way around.
   * const setUniqueValue =
   * await red.importValue('./inside-code.js', 'setUniqueValue');
   *
   * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
   *
   * result = setUniqueValue((x) => x ** 3);
   *
   * console.assert(result === 16); // yields true
   * ```
   */
  importValue(specifier: string, bindingName: string): Promise<any>;
  evaluate(sourceText: string): any;
}

declare var ShadowRealm: {
  prototype: ShadowRealm;
  new (): ShadowRealm;
};

declare function queueMicrotask(callback: (...args: any[]) => void): void;
/**
 * Log an error using the default exception handler
 * @param error Error or string
 */
declare function reportError(error: any): void;

interface Timer {
  ref(): Timer;
  unref(): Timer;
  hasRef(): boolean;
  refresh(): Timer;

  [Symbol.toPrimitive](): number;
}

/**
 * Cancel a repeating timer by its timer ID.
 * @param id timer id
 */
declare function clearInterval(id?: number | Timer): void;
/**
 * Cancel a delayed function call by its timer ID.
 * @param id timer id
 */
declare function clearTimeout(id?: number | Timer): void;
/**
 * Cancel an immediate function call by its immediate ID.
 * @param id immediate id
 */
declare function clearImmediate(id?: number | Timer): void;
/**
 * Run a function immediately after main event loop is vacant
 * @param handler function to call
 */
declare function setImmediate(handler: Bun.TimerHandler, ...arguments: any[]): Timer;
/**
 * Run a function every `interval` milliseconds
 * @param handler function to call
 * @param interval milliseconds to wait between calls
 */
declare function setInterval(handler: Bun.TimerHandler, interval?: number, ...arguments: any[]): Timer;
/**
 * Run a function after `timeout` (milliseconds)
 * @param handler function to call
 * @param timeout milliseconds to wait between calls
 */
declare function setTimeout(handler: Bun.TimerHandler, timeout?: number, ...arguments: any[]): Timer;

declare function addEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | AddEventListenerOptions,
): void;
declare function addEventListener(
  type: string,
  listener: Bun.EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void;
declare function removeEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | Bun.EventListenerOptions,
): void;
declare function removeEventListener(
  type: string,
  listener: Bun.EventListenerOrEventListenerObject,
  options?: boolean | Bun.EventListenerOptions,
): void;

/**
 * Events providing information related to errors in scripts or in files.
 */
interface ErrorEvent extends Event {
  readonly colno: number;
  readonly error: any;
  readonly filename: string;
  readonly lineno: number;
  readonly message: string;
}

declare var ErrorEvent: {
  prototype: ErrorEvent;
  new (type: string, eventInitDict?: Bun.ErrorEventInit): ErrorEvent;
};

/** A CloseEvent is sent to clients using WebSockets when the connection is closed. This is delivered to the listener indicated by the WebSocket object's onclose attribute. */
interface CloseEvent extends Event {
  /** Returns the WebSocket connection close code provided by the server. */
  readonly code: number;
  /** Returns the WebSocket connection close reason provided by the server. */
  readonly reason: string;
  /** Returns true if the connection closed cleanly; false otherwise. */
  readonly wasClean: boolean;
}

declare var CloseEvent: {
  prototype: CloseEvent;
  new (type: string, eventInitDict?: Bun.CloseEventInit): CloseEvent;
};

interface MessageEvent<T = any> extends Bun.MessageEvent<T> {}
declare var MessageEvent: Bun.__internal.UseLibDomIfAvailable<
  "MessageEvent",
  {
    prototype: MessageEvent;
    new <T>(type: string, eventInitDict?: Bun.MessageEventInit<T>): MessageEvent<any>;
  }
>;

interface CustomEvent<T = any> extends Event {
  /** Returns any custom data event was created with. Typically used for synthetic events. */
  readonly detail: T;
}

declare var CustomEvent: {
  prototype: CustomEvent;
  new <T>(type: string, eventInitDict?: Bun.CustomEventInit<T>): CustomEvent<T>;
};

interface EventListener {
  (evt: Event): void;
}

interface EventListenerObject {
  handleEvent(object: Event): void;
}

interface FetchEvent extends Event {
  readonly request: Request;
  readonly url: string;

  waitUntil(promise: Promise<any>): void;
  respondWith(response: Response | Promise<Response>): void;
}

interface EventMap {
  fetch: FetchEvent;
  message: MessageEvent;
  messageerror: MessageEvent;
  // exit: Event;
}

interface AddEventListenerOptions extends Bun.EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

/**
 * Low-level JavaScriptCore API for accessing the native ES Module loader (not a Bun API)
 *
 * Before using this, be aware of a few things:
 *
 * **Using this incorrectly will crash your application**.
 *
 * This API may change any time JavaScriptCore is updated.
 *
 * Bun may rewrite ESM import specifiers to point to bundled code. This will
 * be confusing when using this API, as it will return a string like
 * "/node_modules.server.bun".
 *
 * Bun may inject additional imports into your code. This usually has a `bun:` prefix.
 */
declare var Loader: {
  /**
   * ESM module registry
   *
   * This lets you implement live reload in Bun. If you
   * delete a module specifier from this map, the next time it's imported, it
   * will be re-transpiled and loaded again.
   *
   * The keys are the module specifiers and the
   * values are metadata about the module.
   *
   * The keys are an implementation detail for Bun that will change between
   * versions.
   *
   * - Userland modules are an absolute file path
   * - Virtual modules have a `bun:` prefix or `node:` prefix
   * - JS polyfills start with `"/bun-vfs/"`. `"buffer"` is an example of a JS polyfill
   * - If you have a `node_modules.bun` file, many modules will point to that file
   *
   * Virtual modules and JS polyfills are embedded in bun's binary. They don't
   * point to anywhere in your local filesystem.
   */
  registry: Map<
    string,
    {
      key: string;
      /**
       * This refers to the state the ESM module is in
       *
       * TODO: make an enum for this number
       */
      state: number;
      fetch: Promise<any>;
      instantiate: Promise<any>;
      satisfy: Promise<any>;
      dependencies: Array<(typeof Loader)["registry"] extends Map<any, infer V> ? V : any>;
      /**
       * Your application will probably crash if you mess with this.
       */
      module: {
        dependenciesMap: (typeof Loader)["registry"];
      };
      linkError?: any;
      linkSucceeded: boolean;
      evaluated: boolean;
      then?: any;
      isAsync: boolean;
    }
  >;
  /**
   * For an already-evaluated module, return the dependencies as module specifiers
   *
   * This list is already sorted and uniqued.
   *
   * @example
   *
   * For this code:
   * ```js
   * // /foo.js
   * import classNames from 'classnames';
   * import React from 'react';
   * import {createElement} from 'react';
   * ```
   *
   * This would return:
   * ```js
   * Loader.dependencyKeysIfEvaluated("/foo.js")
   * ["bun:wrap", "/path/to/node_modules/classnames/index.js", "/path/to/node_modules/react/index.js"]
   * ```
   *
   * @param specifier - module specifier as it appears in transpiled source code
   */
  dependencyKeysIfEvaluated: (specifier: string) => string[];
  /**
   * The function JavaScriptCore internally calls when you use an import statement.
   *
   * This may return a path to `node_modules.server.bun`, which will be confusing.
   *
   * Consider {@link Bun.resolve} or {@link ImportMeta.resolve}
   * instead.
   *
   * @param specifier - module specifier as it appears in transpiled source code
   * @param referrer - module specifier that is resolving this specifier
   */
  resolve: (specifier: string, referrer: string) => string;
};

interface QueuingStrategy<T = any> {
  highWaterMark?: number;
  size?: QueuingStrategySize<T>;
}

interface QueuingStrategyInit {
  /**
   * Creates a new ByteLengthQueuingStrategy with the provided high water mark.
   *
   * Note that the provided high water mark will not be validated ahead of time. Instead, if it is negative, NaN, or not a number, the resulting ByteLengthQueuingStrategy will cause the corresponding stream constructor to throw.
   */
  highWaterMark: number;
}

/** This Streams API interface provides a built-in byte length queuing strategy that can be used when constructing streams. */
interface ByteLengthQueuingStrategy extends QueuingStrategy<ArrayBufferView> {
  readonly highWaterMark: number;
  // changed from QueuingStrategySize<BufferSource>
  // to avoid conflict with lib.dom.d.ts
  readonly size: QueuingStrategySize<ArrayBufferView>;
}

declare var ByteLengthQueuingStrategy: {
  prototype: ByteLengthQueuingStrategy;
  new (init: QueuingStrategyInit): ByteLengthQueuingStrategy;
};

interface ReadableStreamDefaultController<R = any> {
  readonly desiredSize: number | null;
  close(): void;
  enqueue(chunk?: R): void;
  error(e?: any): void;
}

interface ReadableStreamDirectController {
  close(error?: Error): void;
  write(data: Bun.BufferSource | ArrayBuffer | string): number | Promise<number>;
  end(): number | Promise<number>;
  flush(): number | Promise<number>;
  start(): void;
}

declare var ReadableStreamDefaultController: {
  prototype: ReadableStreamDefaultController;
  new (): ReadableStreamDefaultController;
};

interface ReadableStreamDefaultReader<R = any> extends ReadableStreamGenericReader {
  read(): Promise<Bun.ReadableStreamDefaultReadResult<R>>;
  /**
   * Only available in Bun. If there are multiple chunks in the queue, this will return all of them at the same time.
   * Will only return a promise if the data is not immediately available.
   */
  readMany(): Promise<Bun.ReadableStreamDefaultReadManyResult<R>> | Bun.ReadableStreamDefaultReadManyResult<R>;
  releaseLock(): void;
}

declare var ReadableStreamDefaultReader: {
  prototype: ReadableStreamDefaultReader;
  new <R = any>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R>;
};

interface ReadableStreamGenericReader {
  readonly closed: Promise<void>;
  cancel(reason?: any): Promise<void>;
}

interface ReadableStreamDefaultReadDoneResult {
  done: true;
  value?: undefined;
}

interface ReadableStreamDefaultReadValueResult<T> {
  done: false;
  value: T;
}

interface ReadableWritablePair<R = any, W = any> {
  readable: ReadableStream<R>;
  /**
   * Provides a convenient, chainable way of piping this readable stream through a transform stream (or any other { writable, readable } pair). It simply pipes the stream into the writable side of the supplied pair, and returns the readable side for further use.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   */
  writable: WritableStream<W>;
}

interface WritableStreamDefaultController {
  error(e?: any): void;
}

declare var WritableStreamDefaultController: {
  prototype: WritableStreamDefaultController;
  new (): WritableStreamDefaultController;
};

/** This Streams API interface is the object returned by WritableStream.getWriter() and once created locks the < writer to the WritableStream ensuring that no other streams can write to the underlying sink. */
interface WritableStreamDefaultWriter<W = any> {
  readonly closed: Promise<void>;
  readonly desiredSize: number | null;
  readonly ready: Promise<void>;
  abort(reason?: any): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
  write(chunk?: W): Promise<void>;
}

declare var WritableStreamDefaultWriter: {
  prototype: WritableStreamDefaultWriter;
  new <W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
};

interface TransformStream<I = any, O = any> {
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
}

declare var TransformStream: {
  prototype: TransformStream;
  new <I = any, O = any>(
    transformer?: Transformer<I, O>,
    writableStrategy?: QueuingStrategy<I>,
    readableStrategy?: QueuingStrategy<O>,
  ): TransformStream<I, O>;
};

interface TransformStreamDefaultController<O = any> {
  readonly desiredSize: number | null;
  enqueue(chunk?: O): void;
  error(reason?: any): void;
  terminate(): void;
}

declare var TransformStreamDefaultController: {
  prototype: TransformStreamDefaultController;
  new (): TransformStreamDefaultController;
};

interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  /**
   * Pipes this readable stream to a given writable stream destination. The way in which the piping process behaves under various error conditions can be customized with a number of passed options. It returns a promise that fulfills when the piping process completes successfully, or rejects if any errors were encountered.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   *
   * Errors and closures of the source and destination streams propagate as follows:
   *
   * An error in this source readable stream will abort destination, unless preventAbort is truthy. The returned promise will be rejected with the source's error, or with any error that occurs during aborting the destination.
   *
   * An error in destination will cancel this source readable stream, unless preventCancel is truthy. The returned promise will be rejected with the destination's error, or with any error that occurs during canceling the source.
   *
   * When this source readable stream closes, destination will be closed, unless preventClose is truthy. The returned promise will be fulfilled once this process completes, unless an error is encountered while closing the destination, in which case it will be rejected with that error.
   *
   * If destination starts out closed or closing, this source readable stream will be canceled, unless preventCancel is true. The returned promise will be rejected with an error indicating piping to a closed stream failed, or with any error that occurs during canceling the source.
   *
   * The signal option can be set to an AbortSignal to allow aborting an ongoing pipe operation via the corresponding AbortController. In this case, this source readable stream will be canceled, and destination aborted, unless the respective options preventCancel or preventAbort are set.
   */
  preventClose?: boolean;
  signal?: AbortSignal;
}

/** This Streams API interface provides a built-in byte length queuing strategy that can be used when constructing streams. */
interface CountQueuingStrategy extends QueuingStrategy {
  readonly highWaterMark: number;
  readonly size: QueuingStrategySize;
}

declare var CountQueuingStrategy: {
  prototype: CountQueuingStrategy;
  new (init: QueuingStrategyInit): CountQueuingStrategy;
};

interface QueuingStrategySize<T = any> {
  (chunk?: T): number;
}

interface Transformer<I = any, O = any> {
  flush?: Bun.TransformerFlushCallback<O>;
  readableType?: undefined;
  start?: Bun.TransformerStartCallback<O>;
  transform?: Bun.TransformerTransformCallback<I, O>;
  writableType?: undefined;
}

interface Dict<T> {
  [key: string]: T | undefined;
}

interface ReadOnlyDict<T> {
  readonly [key: string]: T | undefined;
}

interface ErrnoException extends Error {
  errno?: number | undefined;
  code?: string | undefined;
  path?: string | undefined;
  syscall?: string | undefined;
}

/**
 * An abnormal event (called an exception) which occurs as a result of calling a
 * method or accessing a property of a web API
 */
interface DOMException extends Error {
  readonly message: string;
  readonly name: string;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
}
declare var DOMException: {
  prototype: DOMException;
  new (message?: string, name?: string): DOMException;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
};

declare function alert(message?: string): void;
declare function confirm(message?: string): boolean;
declare function prompt(message?: string, _default?: string): string | null;

interface SubtleCrypto extends Bun.__internal.LibEmptyOrNodeCryptoWebcryptoSubtleCrypto {}
declare var SubtleCrypto: {
  prototype: SubtleCrypto;
  new (): SubtleCrypto;
};

interface CryptoKey extends Bun.__internal.NodeCryptoWebcryptoCryptoKey {}
declare var CryptoKey: {
  prototype: CryptoKey;
  new (): CryptoKey;
};

interface CryptoKeyPair extends Bun.__internal.NodeCryptoWebcryptoCryptoKeyPair {}

interface Position {
  lineText: string;
  file: string;
  namespace: string;
  line: number;
  column: number;
  length: number;
  offset: number;
}

declare class ResolveMessage {
  readonly name: "ResolveMessage";
  readonly position: Position | null;
  readonly code: string;
  readonly message: string;
  readonly referrer: string;
  readonly specifier: string;
  readonly importKind:
    | "entry_point"
    | "stmt"
    | "require"
    | "import"
    | "dynamic"
    | "require_resolve"
    | "at"
    | "at_conditional"
    | "url"
    | "internal";
  readonly level: "error" | "warning" | "info" | "debug" | "verbose";

  toString(): string;
}

declare class BuildMessage {
  readonly name: "BuildMessage";
  readonly position: Position | null;
  readonly message: string;
  readonly level: "error" | "warning" | "info" | "debug" | "verbose";
}

interface ErrorOptions {
  /**
   * The cause of the error.
   */
  cause?: unknown;
}

interface Error {
  /**
   * The cause of the error.
   */
  cause?: unknown;
}

interface ErrorConstructor {
  new (message?: string, options?: ErrorOptions): Error;

  /**
   * Check if a value is an instance of Error
   *
   * @param value - The value to check
   * @returns True if the value is an instance of Error, false otherwise
   */
  isError(value: unknown): value is Error;

  /**
   * Create .stack property on a target object
   */
  captureStackTrace(targetObject: object, constructorOpt?: Function): void;

  /**
   * The maximum number of stack frames to capture.
   */
  stackTraceLimit: number;
}

interface ArrayBufferConstructor {
  new (byteLength: number, options: { maxByteLength?: number }): ArrayBuffer;
}

interface ArrayBuffer {
  /**
   * Read-only. The length of the ArrayBuffer (in bytes).
   */
  readonly byteLength: number;

  /**
   * Resize an ArrayBuffer in-place.
   */
  resize(byteLength: number): ArrayBuffer;

  /**
   * Returns a section of an ArrayBuffer.
   */
  slice(begin: number, end?: number): ArrayBuffer;
}

interface SharedArrayBuffer {
  /**
   * Grow the SharedArrayBuffer in-place.
   */
  grow(size: number): SharedArrayBuffer;
}

interface ArrayConstructor {
  /**
   * Create an array from an iterable or async iterable object.
   * Values from the iterable are awaited.
   *
   * ```ts
   * await Array.fromAsync([1]); // [1]
   * await Array.fromAsync([Promise.resolve(1)]); // [1]
   * await Array.fromAsync((async function*() { yield 1 })()); // [1]
   * ```
   *
   * @param arrayLike - The iterable or async iterable to convert to an array.
   * @returns A {@link Promise} whose fulfillment is a new {@link Array} instance containing the values from the iterator.
   */
  fromAsync<T>(arrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>): Promise<Awaited<T>[]>;

  /**
   * Create an array from an iterable or async iterable object.
   * Values from the iterable are awaited. Results of the map function are also awaited.
   *
   * ```ts
   * await Array.fromAsync([1]); // [1]
   * await Array.fromAsync([Promise.resolve(1)]); // [1]
   * await Array.fromAsync((async function*() { yield 1 })()); // [1]
   * await Array.fromAsync([1], (n) => n + 1); // [2]
   * await Array.fromAsync([1], (n) => Promise.resolve(n + 1)); // [2]
   * ```
   *
   * @param arrayLike - The iterable or async iterable to convert to an array.
   * @param mapFn - A mapper function that transforms each element of `arrayLike` after awaiting them.
   * @param thisArg - The `this` to which `mapFn` is bound.
   * @returns A {@link Promise} whose fulfillment is a new {@link Array} instance containing the values from the iterator.
   */
  fromAsync<T, U>(
    arrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>,
    mapFn?: (value: T, index: number) => U,
    thisArg?: any,
  ): Promise<Awaited<U>[]>;
}

interface ConsoleOptions {
  stdout: import("stream").Writable;
  stderr?: import("stream").Writable;
  ignoreErrors?: boolean;
  colorMode?: boolean | "auto";
  inspectOptions?: import("util").InspectOptions;
  groupIndentation?: number;
}

interface Console {
  /**
   * Asynchronously read lines from standard input (fd 0)
   *
   * ```ts
   * for await (const line of console) {
   *   console.log(line);
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<string>;

  /**
   * Write text or bytes to stdout
   *
   * Unlike {@link console.log}, this does no formatting and doesn't add a
   * newline or spaces between arguments. You can pass it strings or bytes or
   * any combination of the two.
   *
   * ```ts
   * console.write("hello world!", "\n"); // "hello world\n"
   * ```
   *
   * @param data - The data to write
   * @returns The number of bytes written
   *
   * This function is not available in the browser.
   */
  write(...data: Array<string | ArrayBufferView | ArrayBuffer>): number;

  /**
   * Clear the console
   */
  clear(): void;

  assert(condition?: boolean, ...data: any[]): void;

  /**
   * Increment a [count](https://www.youtube.com/watch?v=2AoxCkySv34&t=22s)
   * @param label label counter
   */
  count(label?: string): void;
  countReset(label?: string): void;
  debug(...data: any[]): void;
  dir(item?: any, options?: any): void;
  dirxml(...data: any[]): void;
  /**
   * Log to stderr in your terminal
   *
   * Appears in red
   *
   * @param data something to display
   */
  error(...data: any[]): void;
  /** Does nothing currently */
  group(...data: any[]): void;
  /** Does nothing currently */
  groupCollapsed(...data: any[]): void;
  /** Does nothing currently */
  groupEnd(): void;
  info(...data: any[]): void;
  log(...data: any[]): void;
  /**
   * Try to construct a table with the columns of the properties of `tabularData` (or use `properties`) and rows of `tabularData` and log it. Falls back to just
   * logging the argument if it can't be parsed as tabular.
   *
   * ```js
   * // These can't be parsed as tabular data
   * console.table(Symbol());
   * // Symbol()
   *
   * console.table(undefined);
   * // undefined
   *
   * console.table([{ a: 1, b: 'Y' }, { a: 'Z', b: 2 }]);
   * // ┌────┬─────┬─────┐
   * // │    │  a  │  b  │
   * // ├────┼─────┼─────┤
   * // │  0 │  1  │ 'Y' │
   * // │  1 │ 'Z' │  2  │
   * // └────┴─────┴─────┘
   *
   * console.table([{ a: 1, b: 'Y' }, { a: 'Z', b: 2 }], ['a']);
   * // ┌────┬─────┐
   * // │    │  a  │
   * // ├────┼─────┤
   * // │ 0  │  1  │
   * // │ 1  │ 'Z' │
   * // └────┴─────┘
   * ```
   * @param properties Alternate properties for constructing the table.
   */
  table(tabularData?: any, properties?: string[]): void;
  /**
   * Begin a timer to log with {@link console.timeEnd}
   *
   * @param label - The label to use for the timer
   *
   * ```ts
   *  console.time("how long????");
   * for (let i = 0; i < 999999; i++) {
   *    // do stuff
   *    let x = i * i;
   * }
   * console.timeEnd("how long????");
   * ```
   */
  time(label?: string): void;
  /**
   * End a timer to log with {@link console.time}
   *
   * @param label - The label to use for the timer
   *
   * ```ts
   *  console.time("how long????");
   * for (let i = 0; i < 999999; i++) {
   *  // do stuff
   *  let x = i * i;
   * }
   * console.timeEnd("how long????");
   * ```
   */
  timeEnd(label?: string): void;
  timeLog(label?: string, ...data: any[]): void;
  timeStamp(label?: string): void;
  trace(...data: any[]): void;
  warn(...data: any[]): void;

  /**
   * Creates a new Console with one or two writable stream instances. stdout is a writable stream to print log or info output. stderr is used for warning or error output. If stderr is not provided, stdout is used for stderr.
   */
  // Console: {
  //   new (options: ConsoleOptions): Console;
  //   new (
  //     stdout: import("stream").Writable,
  //     stderr?: import("stream").Writable,
  //     ignoreErrors?: boolean,
  //   ): Console;
  // };
}

declare var console: Console;

interface ImportMetaEnv {
  [key: string]: string | undefined;
}

interface ImportMeta {
  /**
   * `file://` url string for the current module.
   *
   * @example
   * ```ts
   * console.log(import.meta.url);
   * "file:///Users/me/projects/my-app/src/my-app.ts"
   * ```
   */
  url: string;
  /**
   * Absolute path to the source file
   */
  readonly path: string;
  /**
   * Absolute path to the directory containing the source file.
   *
   * Does not have a trailing slash
   */
  readonly dir: string;
  /**
   * Filename of the source file
   */
  readonly file: string;
  /**
   * The environment variables of the process
   *
   * ```ts
   * import.meta.env === process.env
   * ```
   */
  readonly env: Bun.Env & NodeJS.ProcessEnv & ImportMetaEnv;

  /**
   * @deprecated Use `require.resolve` or `Bun.resolveSync(moduleId, path.dirname(parent))` instead
   *
   * Resolve a module ID the same as if you imported it
   *
   * The `parent` argument is optional, and defaults to the current module's path.
   */
  resolveSync(moduleId: string, parent?: string): string;

  /**
   * Load a CommonJS module within an ES Module. Bun's transpiler rewrites all
   * calls to `require` with `import.meta.require` when transpiling ES Modules
   * for the runtime.
   *
   * Warning: **This API is not stable** and may change or be removed in the
   * future. Use at your own risk.
   */
  require: NodeJS.Require;

  /**
   * Did the current file start the process?
   *
   * @example
   * ```ts
   * if (import.meta.main) {
   *  console.log("I started the process!");
   * }
   * ```
   *
   * @example
   * ```ts
   * console.log(
   *   import.meta.main === (import.meta.path === Bun.main)
   * )
   * ```
   */
  main: boolean;

  /** Alias of `import.meta.dir`. Exists for Node.js compatibility */
  dirname: string;

  /** Alias of `import.meta.path`. Exists for Node.js compatibility */
  filename: string;
}

/**
 * NodeJS-style `require` function
 *
 * @param moduleId - The module ID to resolve
 */
declare var require: NodeJS.Require;

/** Same as module.exports */
declare var exports: any;

interface NodeModule {
  exports: any;
}

declare var module: NodeModule;

/**
 * Creates a deep clone of an object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/structuredClone)
 */
declare function structuredClone<T>(value: T, options?: Bun.StructuredSerializeOptions): T;

/**
 * Post a message to the parent thread.
 *
 * Only useful in a worker thread; calling this from the main thread does nothing.
 */
declare function postMessage(message: any, transfer?: Bun.Transferable[]): void;

interface EventSourceInit {
  withCredentials?: boolean;
}

interface PromiseConstructor {
  /**
   * Create a deferred promise, with exposed `resolve` and `reject` methods which can be called
   * separately.
   *
   * This is useful when you want to return a Promise and have code outside the Promise
   * resolve or reject it.
   *
   * @example
   * ```ts
   * const { promise, resolve, reject } = Promise.withResolvers();
   *
   * setTimeout(() => {
   *  resolve("Hello world!");
   * }, 1000);
   *
   * await promise; // "Hello world!"
   * ```
   */
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value?: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  };

  /**
   * Try to run a function and return the result.
   * If the function throws, return the result of the `catch` function.
   *
   * @param fn - The function to run
   * @param args - The arguments to pass to the function. This is similar to `setTimeout` and avoids the extra closure.
   * @returns The result of the function or the result of the `catch` function
   */
  try<T, A extends any[] = []>(fn: (...args: A) => T | PromiseLike<T>, ...args: A): Promise<T>;
}

interface Navigator {
  readonly userAgent: string;
  readonly platform: "MacIntel" | "Win32" | "Linux x86_64";
  readonly hardwareConcurrency: number;
}

declare var navigator: Navigator;

interface BlobPropertyBag {
  /** Set a default "type". Not yet implemented. */
  type?: string;
  /** Not implemented in Bun yet. */
  // endings?: "transparent" | "native";
}

interface WorkerOptions extends Bun.WorkerOptions {}

interface Blob {
  /**
   * The size of this Blob in bytes
   */
  readonly size: number;

  /**
   * The MIME type of this Blob
   */
  readonly type: string;

  /**
   * Read the data from the blob as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   */
  json(): Promise<any>;

  /**
   * Wrap this blob in a {@link Bun.Image} pipeline. Equivalent to
   * `new Bun.Image(this, options)` — the constructor is synchronous (the
   * underlying read happens lazily when an Image terminal is awaited), so
   * this works on `Bun.file()`, `Bun.s3()`, fd-backed and in-memory blobs
   * alike:
   *
   * ```ts
   * await Bun.file("photo.jpg").image().resize(400).webp().write("thumb.webp");
   * ```
   */
  image(options?: Bun.Image.ConstructorOptions): Bun.Image;

  /**
   * Read the data from the blob as a {@link FormData} object.
   *
   * This first decodes the data from UTF-8, then parses it as a
   * `multipart/form-data` body or a `application/x-www-form-urlencoded` body.
   *
   * The `type` property of the blob is used to determine the format of the
   * body.
   *
   * This is a non-standard addition to the `Blob` API, to make it conform more
   * closely to the `BodyMixin` API.
   */
  formData(): Promise<FormData>;

  /**
   * Returns a promise that resolves to the contents of the blob as a string
   */
  text(): Promise<string>;

  /**
   * Returns a promise that resolves to the contents of the blob as an ArrayBuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Returns a promise that resolves to the contents of the blob as a Uint8Array (array of bytes) its the same as `new Uint8Array(await blob.arrayBuffer())`
   */
  bytes(): Promise<Uint8Array<ArrayBuffer>>;

  /**
   * Returns a readable stream of the blob's contents
   */
  stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
}

declare var Blob: Bun.__internal.UseLibDomIfAvailable<
  "Blob",
  {
    prototype: Blob;
    new (blobParts?: Bun.BlobPart[], options?: BlobPropertyBag): Blob;
  }
>;

interface Uint8Array {
  /**
   * Convert the Uint8Array to a base64 encoded string
   * @returns The base64 encoded string representation of the Uint8Array
   */
  toBase64(options?: { alphabet?: "base64" | "base64url"; omitPadding?: boolean }): string;

  /**
   * Set the contents of the Uint8Array from a base64 encoded string
   * @param base64 The base64 encoded string to decode into the array
   * @param offset Optional starting index to begin setting the decoded bytes (default: 0)
   */
  setFromBase64(
    base64: string,
    offset?: number,
  ): {
    /**
     * The number of bytes read from the base64 string
     */
    read: number;
    /**
     * The number of bytes written to the Uint8Array
     * Will never be greater than the `.byteLength` of this Uint8Array
     */
    written: number;
  };

  /**
   * Convert the Uint8Array to a hex encoded string
   * @returns The hex encoded string representation of the Uint8Array
   */
  toHex(): string;

  /**
   * Set the contents of the Uint8Array from a hex encoded string
   * @param hex The hex encoded string to decode into the array. The string must have
   * an even number of characters, be valid hexadecimal characters and contain no whitespace.
   */
  setFromHex(hex: string): {
    /**
     * The number of bytes read from the hex string
     */
    read: number;
    /**
     * The number of bytes written to the Uint8Array
     * Will never be greater than the `.byteLength` of this Uint8Array
     */
    written: number;
  };
}

interface Uint8ArrayConstructor {
  /**
   * Create a new Uint8Array from a base64 encoded string
   * @param base64 The base64 encoded string to convert to a Uint8Array
   * @param options Optional options for decoding the base64 string
   * @returns A new Uint8Array containing the decoded data
   */
  fromBase64(
    base64: string,
    options?: {
      alphabet?: "base64" | "base64url";
      lastChunkHandling?: "loose" | "strict" | "stop-before-partial";
    },
  ): Uint8Array<ArrayBuffer>;

  /**
   * Create a new Uint8Array from a hex encoded string
   * @param hex The hex encoded string to convert to a Uint8Array
   * @returns A new Uint8Array containing the decoded data
   */
  fromHex(hex: string): Uint8Array<ArrayBuffer>;
}

interface BroadcastChannel extends Bun.__internal.LibEmptyOrBroadcastChannel {}
declare var BroadcastChannel: Bun.__internal.UseLibDomIfAvailable<
  "BroadcastChannel",
  typeof import("node:worker_threads").BroadcastChannel
>;

declare var URL: Bun.__internal.UseLibDomIfAvailable<
  "URL",
  {
    prototype: URL;
    new (url: string | URL, base?: string | URL): URL;
    /**
     * Check if a URL can be parsed.
     *
     * @param url - The URL to check.
     * @param base - The base URL to use.
     */
    canParse(url: string, base?: string): boolean;
    /**
     * Create a URL from an object.
     *
     * @param object - The object to create a URL from.
     */
    createObjectURL(object: Blob): `blob:${string}`;
    /**
     * Revoke a URL.
     *
     * @param url - The URL to revoke.
     */
    revokeObjectURL(url: string): void;
    /**
     * Parse a URL.
     *
     * @param url - The URL to parse.
     * @param base - The base URL to use.
     */
    parse(url: string, base?: string): URL | null;
  }
>;

/**
 * The **`AbortController`** interface represents a controller object that allows you to abort one or more Web requests as and when desired.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortController)
 */
interface AbortController {
  readonly signal: AbortSignal;
  abort(reason?: any): void;
}
declare var AbortController: Bun.__internal.UseLibDomIfAvailable<
  "AbortController",
  {
    prototype: AbortController;
    new (): AbortController;
  }
>;

interface AbortSignal extends EventTarget {
  readonly aborted: boolean;
  onabort: ((this: AbortSignal, ev: Event) => any) | null;
  readonly reason: any;
  throwIfAborted(): void;
}
declare var AbortSignal: Bun.__internal.UseLibDomIfAvailable<
  "AbortSignal",
  {
    prototype: AbortSignal;
    new (): AbortSignal;
    /**
     * Create an AbortSignal that will be aborted after a timeout
     * @param ms The timeout in milliseconds
     * @returns An AbortSignal that will be aborted after the timeout
     */
    timeout(ms: number): AbortSignal;
    /**
     * Create an immediately-aborted AbortSignal
     * @param reason The reason for the abort
     * @returns An AbortSignal that is already aborted
     */
    abort(reason?: any): AbortSignal;
    /**
     * Create an AbortSignal that will be aborted if any of the signals are aborted
     * @param signals The signals to combine
     * @returns An AbortSignal that will be aborted if any of the signals are aborted
     */
    any(signals: AbortSignal[]): AbortSignal;
  }
>;

interface FormData {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/append) */
  append(name: string, value: string | Blob): void;
  append(name: string, value: string): void;
  append(name: string, blobValue: Blob, filename?: string): void;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/delete) */
  delete(name: string): void;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/get) */
  get(name: string): Bun.FormDataEntryValue | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/getAll) */
  getAll(name: string): Bun.FormDataEntryValue[];
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/has) */
  has(name: string): boolean;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/set) */
  set(name: string, value: string | Blob): void;
  set(name: string, value: string): void;
  set(name: string, blobValue: Blob, filename?: string): void;
  forEach(callbackfn: (value: Bun.FormDataEntryValue, key: string, parent: FormData) => void, thisArg?: any): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  entries(): IterableIterator<[string, string]>;
}
declare var FormData: Bun.__internal.UseLibDomIfAvailable<"FormData", { prototype: FormData; new (): FormData }>;

interface EventSource extends Bun.__internal.LibEmptyOrEventSource {}
declare var EventSource: Bun.__internal.UseLibDomIfAvailable<
  "EventSource",
  { prototype: EventSource; new (): EventSource }
>;

interface Performance extends Bun.__internal.LibPerformanceOrNodePerfHooksPerformance {}
declare var performance: Bun.__internal.UseLibDomIfAvailable<"performance", Performance>;
declare var Performance: Bun.__internal.UseLibDomIfAvailable<
  "Performance",
  { new (): Performance; prototype: Performance }
>;

interface PerformanceEntry extends Bun.__internal.LibEmptyOrPerformanceEntry {}
declare var PerformanceEntry: Bun.__internal.UseLibDomIfAvailable<
  "PerformanceEntry",
  { prototype: PerformanceEntry; new (): PerformanceEntry }
>;

interface PerformanceMark extends Bun.__internal.LibEmptyOrPerformanceMark {}
declare var PerformanceMark: Bun.__internal.UseLibDomIfAvailable<
  "PerformanceMark",
  { prototype: PerformanceMark; new (): PerformanceMark }
>;

interface PerformanceMeasure extends Bun.__internal.LibEmptyOrPerformanceMeasure {}
declare var PerformanceMeasure: Bun.__internal.UseLibDomIfAvailable<
  "PerformanceMeasure",
  { prototype: PerformanceMeasure; new (): PerformanceMeasure }
>;

interface PerformanceObserver extends Bun.__internal.LibEmptyOrPerformanceObserver {}
declare var PerformanceObserver: Bun.__internal.UseLibDomIfAvailable<
  "PerformanceObserver",
  { prototype: PerformanceObserver; new (): PerformanceObserver }
>;

interface PerformanceObserverEntryList extends Bun.__internal.LibEmptyOrPerformanceObserverEntryList {}
declare var PerformanceObserverEntryList: Bun.__internal.UseLibDomIfAvailable<
  "PerformanceObserverEntryList",
  { prototype: PerformanceObserverEntryList; new (): PerformanceObserverEntryList }
>;

interface PerformanceResourceTiming extends Bun.__internal.LibEmptyOrPerformanceResourceTiming {}
declare var PerformanceResourceTiming: Bun.__internal.UseLibDomIfAvailable<
  "PerformanceResourceTiming",
  { prototype: PerformanceResourceTiming; new (): PerformanceResourceTiming }
>;

interface ReadableByteStreamController extends Bun.__internal.LibEmptyOrReadableByteStreamController {}
declare var ReadableByteStreamController: Bun.__internal.UseLibDomIfAvailable<
  "ReadableByteStreamController",
  { prototype: ReadableByteStreamController; new (): ReadableByteStreamController }
>;

interface ReadableStreamBYOBReader extends Bun.__internal.LibEmptyOrReadableStreamBYOBReader {}
declare var ReadableStreamBYOBReader: Bun.__internal.UseLibDomIfAvailable<
  "ReadableStreamBYOBReader",
  { prototype: ReadableStreamBYOBReader; new (): ReadableStreamBYOBReader }
>;

interface ReadableStreamBYOBRequest extends Bun.__internal.LibEmptyOrReadableStreamBYOBRequest {}
declare var ReadableStreamBYOBRequest: Bun.__internal.UseLibDomIfAvailable<
  "ReadableStreamBYOBRequest",
  { prototype: ReadableStreamBYOBRequest; new (): ReadableStreamBYOBRequest }
>;

interface TextDecoderStream extends Bun.__internal.LibEmptyOrNodeStreamWebTextDecoderStream {}
declare var TextDecoderStream: Bun.__internal.UseLibDomIfAvailable<
  "TextDecoderStream",
  { prototype: TextDecoderStream; new (): TextDecoderStream }
>;

interface TextEncoderStream extends Bun.__internal.LibEmptyOrNodeStreamWebTextEncoderStream {}
declare var TextEncoderStream: Bun.__internal.UseLibDomIfAvailable<
  "TextEncoderStream",
  { prototype: TextEncoderStream; new (): TextEncoderStream }
>;

interface URLSearchParams {}
declare var URLSearchParams: Bun.__internal.UseLibDomIfAvailable<
  "URLSearchParams",
  {
    prototype: URLSearchParams;
    new (
      init?:
        | URLSearchParams
        | string
        | Record<string, string | readonly string[]>
        | Iterable<[string, string]>
        | ReadonlyArray<[string, string]>,
    ): URLSearchParams;
  }
>;

interface MessageChannel {
  /**
   * Returns the first MessagePort object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageChannel/port1)
   */
  readonly port1: MessagePort;
  /**
   * Returns the second MessagePort object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageChannel/port2)
   */
  readonly port2: MessagePort;
}
declare var MessageChannel: Bun.__internal.UseLibDomIfAvailable<
  "MessageChannel",
  { prototype: MessageChannel; new (): MessageChannel }
>;

interface MessagePort extends Bun.__internal.LibEmptyOrNodeMessagePort {}
declare var MessagePort: Bun.__internal.UseLibDomIfAvailable<
  "MessagePort",
  {
    prototype: MessagePort;
    new (): MessagePort;
  }
>;

//#region Fetch
interface RequestInit extends Bun.__internal.LibOrFallbackRequestInit {}
interface ResponseInit extends Bun.__internal.LibOrFallbackResponseInit {}

interface Headers extends Bun.__internal.BunHeadersOverride {}
declare var Headers: Bun.__internal.UseLibDomIfAvailable<
  "Headers",
  {
    prototype: Headers;
    new (init?: Bun.HeadersInit): Headers;
  }
>;

interface Request extends Bun.__internal.BunRequestOverride {}
declare var Request: Bun.__internal.UseLibDomIfAvailable<
  "Request",
  {
    prototype: Request;
    new (requestInfo: string, init?: RequestInit): Request;
    new (requestInfo: RequestInit & { url: string }): Request;
    new (requestInfo: Request, init?: RequestInit): Request;
  }
>;

interface Response extends Bun.__internal.BunResponseOverride {}
declare var Response: Bun.__internal.UseLibDomIfAvailable<
  "Response",
  {
    new (body?: Bun.BodyInit | null | undefined, init?: ResponseInit | undefined): Response;
    /**
     * Create a new {@link Response} with a JSON body
     *
     * @param body - The body of the response
     * @param options - options to pass to the response
     *
     * @example
     *
     * ```ts
     * const response = Response.json({hi: "there"});
     * console.assert(
     *   await response.text(),
     *   `{"hi":"there"}`
     * );
     * ```
     * -------
     *
     * This is syntactic sugar for:
     * ```js
     *  new Response(JSON.stringify(body), {headers: { "Content-Type": "application/json" }})
     * ```
     * @link https://github.com/whatwg/fetch/issues/1389
     */
    json(body?: any, init?: ResponseInit | number): Response;

    /**
     * Create a new {@link Response} that redirects to url
     *
     * @param url - the URL to redirect to
     * @param status - the HTTP status code to use for the redirect
     */
    redirect(url: string, status?: number): Response;

    /**
     * Create a new {@link Response} that redirects to url
     *
     * @param url - the URL to redirect to
     * @param options - options to pass to the response
     */
    redirect(url: string, init?: ResponseInit): Response;

    /**
     * Create a new {@link Response} that has a network error
     */
    error(): Response;
  }
>;

/**
 * Extends Bun.TLSOptions with extra properties that are only supported in `fetch(url, {tls: ...})`
 */
interface BunFetchRequestInitTLS extends Bun.TLSOptions {
  /**
   * Custom function to check the server identity
   * @param hostname - The hostname of the server
   * @param cert - The certificate of the server
   * @returns An error if the server is unauthorized, otherwise undefined
   */
  checkServerIdentity?: NonNullable<import("node:tls").ConnectionOptions["checkServerIdentity"]>;
}

/**
 * BunFetchRequestInit represents additional options that Bun supports in `fetch()` only.
 *
 * Bun extends the `fetch` API with some additional options, except
 * this interface is not quite a `RequestInit`, because they won't work
 * if passed to `new Request()`. This is why it's a separate type.
 */
interface BunFetchRequestInit extends RequestInit {
  /**
   * Override the default TLS options
   */
  tls?: BunFetchRequestInitTLS;

  /**
   * Log the raw HTTP request & response to stdout. This API may be
   * removed in a future version of Bun without notice.
   * This is a custom property that is not part of the Fetch API specification.
   * It exists mostly as a debugging tool
   */
  verbose?: boolean;

  /**
   * Override http_proxy or HTTPS_PROXY
   * This is a custom property that is not part of the Fetch API specification.
   *
   * Can be a string URL or an object with `url` and optional `headers`.
   *
   * @example
   * ```js
   * // String format
   * const response = await fetch("http://example.com", {
   *  proxy: "https://username:password@127.0.0.1:8080"
   * });
   *
   * // Object format with custom headers sent to the proxy
   * const response = await fetch("http://example.com", {
   *  proxy: {
   *    url: "https://127.0.0.1:8080",
   *    headers: {
   *      "Proxy-Authorization": "Bearer token",
   *      "X-Custom-Proxy-Header": "value"
   *    }
   *  }
   * });
   * ```
   *
   * If a `Proxy-Authorization` header is provided in `proxy.headers`, it takes
   * precedence over credentials parsed from the proxy URL.
   */
  proxy?:
    | string
    | {
        /**
         * The proxy URL
         */
        url: string;
        /**
         * Custom headers to send to the proxy server.
         * These headers are sent in the CONNECT request (for HTTPS targets)
         * or in the proxy request (for HTTP targets).
         */
        headers?: Bun.HeadersInit;
      };

  /**
   * Override the default S3 options
   *
   * @example
   * ```js
   * const response = await fetch("s3://bucket/key", {
   *   s3: {
   *     accessKeyId: "AKIAIOSFODNN7EXAMPLE",
   *     secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
   *     region: "us-east-1",
   *   }
   * });
   * ```
   */
  s3?: Bun.S3Options;

  /**
   * Make the request over a Unix socket
   *
   * @example
   * ```js
   * const response = await fetch("http://example.com", { unix: "/path/to/socket" });
   * ```
   */
  unix?: string;

  /**
   * Force the underlying HTTP version. `"http2"` advertises only `h2` in
   * the TLS ALPN list and the request fails with `HTTP2Unsupported` if the
   * server doesn't select it. `"http1.1"` pins the request to HTTP/1.1,
   * overriding `--experimental-http2-fetch` /
   * `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT` if set. Omit to use the
   * default (h2 is offered iff the flag is on).
   *
   * Requires `https`. This is a custom property that is not part of the
   * Fetch API specification.
   * @experimental
   */
  protocol?: "http2" | "http1.1" | "h2" | "h1";

  /**
   * Control automatic decompression of the response body.
   * When set to `false`, the response body will not be automatically decompressed,
   * and the `Content-Encoding` header will be preserved. This can improve performance
   * when you need to handle compressed data manually or forward it as-is.
   * This is a custom property that is not part of the Fetch API specification.
   *
   * @default true
   * @example
   * ```js
   * // Disable automatic decompression for a proxy server
   * const response = await fetch("https://example.com/api", {
   *   decompress: false
   * });
   * // response.headers.get('content-encoding') might be 'gzip' or 'br'
   * ```
   */
  decompress?: boolean;
}

/**
 * Send a HTTP(s) request
 *
 * @param input URL string or Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(input: string | URL | Request, init?: BunFetchRequestInit): Promise<Response>;

/**
 * Bun's extensions of the `fetch` API
 *
 * @see {@link fetch} The `fetch` function itself
 */
declare namespace fetch {
  /**
   * Preconnect to a URL. This can be used to improve performance by pre-resolving the DNS and establishing a TCP connection before the request is made.
   *
   * This is a custom property that is not part of the Fetch API specification.
   *
   * @param url - The URL to preconnect to
   * @param options - Options for the preconnect
   */
  export function preconnect(
    url: string | URL,
    options?: {
      /** Preconnect to the DNS of the URL */
      dns?: boolean;
      /** Preconnect to the TCP connection of the URL */
      tcp?: boolean;
      /** Preconnect to the HTTP connection of the URL */
      http?: boolean;
      /** Preconnect to the HTTPS connection of the URL */
      https?: boolean;
    },
  ): void;
}
//#endregion

interface RegExpConstructor {
  /**
   * Escapes any potential regex syntax characters in a string, and returns a
   * new string that can be safely used as a literal pattern for the RegExp()
   * constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape)
   *
   * @example
   * ```ts
   * const re = new RegExp(RegExp.escape("foo.bar"));
   * re.test("foo.bar"); // true
   * re.test("foo!bar"); // false
   * ```
   */
  escape(string: string): string;
}
