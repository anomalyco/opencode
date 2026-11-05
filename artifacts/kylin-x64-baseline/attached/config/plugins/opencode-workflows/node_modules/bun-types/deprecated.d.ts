declare module "bun" {
  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type Platform =
    | "aix"
    | "android"
    | "darwin"
    | "freebsd"
    | "haiku"
    | "linux"
    | "openbsd"
    | "sunos"
    | "win32"
    | "cygwin"
    | "netbsd";

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type Architecture = "arm" | "arm64" | "ia32" | "mips" | "mipsel" | "ppc" | "ppc64" | "s390" | "s390x" | "x64";

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type UncaughtExceptionListener = (error: Error, origin: UncaughtExceptionOrigin) => void;

  /**
   * Most of the time the unhandledRejection will be an Error, but this should not be relied upon
   * as *anything* can be thrown/rejected, it is therefore unsafe to assume that the value is an Error.
   *
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type UnhandledRejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type MultipleResolveListener = (type: MultipleResolveType, promise: Promise<unknown>, value: unknown) => void;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single {@link ArrayBuffer}.
   *
   * Each chunk must be a TypedArray or an ArrayBuffer. If you need to support
   * chunks of different types, consider {@link readableStreamToBlob}
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks or the concatenated chunks as a {@link Uint8Array}.
   *
   * @deprecated Use {@link ReadableStream.bytes}
   */
  function readableStreamToBytes(
    stream: ReadableStream<ArrayBufferView | ArrayBufferLike>,
  ): Promise<Uint8Array<ArrayBuffer>> | Uint8Array<ArrayBuffer>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single {@link Blob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link Blob}.
   *
   * @deprecated Use {@link ReadableStream.blob}
   */
  function readableStreamToBlob(stream: ReadableStream): Promise<Blob>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   *
   * @deprecated Use {@link ReadableStream.text}
   */
  function readableStreamToText(stream: ReadableStream): Promise<string>;

  /**
   * Consume all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenate the chunks into a single string and parse as JSON. Chunks must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   *
   * @deprecated Use {@link ReadableStream.json}
   */
  function readableStreamToJSON(stream: ReadableStream): Promise<any>;

  interface BunMessageEvent<T> {
    /**
     * @deprecated
     */
    initMessageEvent(
      type: string,
      bubbles?: boolean,
      cancelable?: boolean,
      data?: any,
      origin?: string,
      lastEventId?: string,
      source?: null,
    ): void;
  }

  /**
   * @deprecated Use {@link Serve.Options Bun.Serve.Options<T, R>} instead
   */
  type ServeOptions<T = undefined, R extends string = never> = Serve.Options<T, R>;

  /** @deprecated Use {@link SQL.Query Bun.SQL.Query} */
  type SQLQuery<T = any> = SQL.Query<T>;

  /** @deprecated Use {@link SQL.TransactionContextCallback Bun.SQL.TransactionContextCallback} */
  type SQLTransactionContextCallback<T> = SQL.TransactionContextCallback<T>;

  /** @deprecated Use {@link SQL.SavepointContextCallback Bun.SQL.SavepointContextCallback} */
  type SQLSavepointContextCallback<T> = SQL.SavepointContextCallback<T>;

  /** @deprecated Use {@link SQL.Options Bun.SQL.Options} */
  type SQLOptions = SQL.Options;

  /**
   * @deprecated Renamed to `ErrorLike`
   */
  type Errorlike = ErrorLike;

  /** @deprecated This is unused in Bun's types and may be removed in the future */
  type ShellFunction = (input: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

  interface TLSOptions {
    /**
     * File path to a TLS key
     *
     * To enable TLS, this option is required.
     *
     * @deprecated since v0.6.3 - Use `key: Bun.file(path)` instead.
     */
    keyFile?: string;

    /**
     * File path to a TLS certificate
     *
     * To enable TLS, this option is required.
     *
     * @deprecated since v0.6.3 - Use `cert: Bun.file(path)` instead.
     */
    certFile?: string;

    /**
     *  File path to a .pem file for a custom root CA
     *
     * @deprecated since v0.6.3 - Use `ca: Bun.file(path)` instead.
     */
    caFile?: string;
  }

  /** @deprecated This type is unused in Bun's declarations and may be removed in the future */
  type ReadableIO = ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined;
}

declare namespace NodeJS {
  interface Process {
    /**
     * @deprecated This is deprecated; use the "node:assert" module instead.
     */
    assert(value: unknown, message?: string | Error): asserts value;
  }
}

interface CustomEvent<T = any> {
  /** @deprecated */
  initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
}

interface DOMException {
  /** @deprecated */
  readonly code: number;
}

/**
 * @deprecated Renamed to `BuildMessage`
 */
declare var BuildError: typeof BuildMessage;

/**
 * @deprecated Renamed to `ResolveMessage`
 */
declare var ResolveError: typeof ResolveMessage;
