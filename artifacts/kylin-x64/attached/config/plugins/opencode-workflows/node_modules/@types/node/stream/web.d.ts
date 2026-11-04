type _ByteLengthQueuingStrategy = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ByteLengthQueuingStrategy;
type _CompressionStream = typeof globalThis extends { onmessage: any; ReportingObserver: any } ? {}
    : import("stream/web").CompressionStream;
type _CountQueuingStrategy = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").CountQueuingStrategy;
type _DecompressionStream = typeof globalThis extends { onmessage: any; ReportingObserver: any } ? {}
    : import("stream/web").DecompressionStream;
type _QueuingStrategy<T = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").QueuingStrategy<T>;
type _ReadableByteStreamController = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ReadableByteStreamController;
type _ReadableStream<R = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ReadableStream<R>;
type _ReadableStreamBYOBReader = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ReadableStreamBYOBReader;
type _ReadableStreamBYOBRequest = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ReadableStreamBYOBRequest;
type _ReadableStreamDefaultController<R = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ReadableStreamDefaultController<R>;
type _ReadableStreamDefaultReader<R = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").ReadableStreamDefaultReader<R>;
type _TextDecoderStream = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").TextDecoderStream;
type _TextEncoderStream = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").TextEncoderStream;
type _TransformStream<I = any, O = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").TransformStream<I, O>;
type _TransformStreamDefaultController<O = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").TransformStreamDefaultController<O>;
type _WritableStream<W = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").WritableStream<W>;
type _WritableStreamDefaultController = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").WritableStreamDefaultController;
type _WritableStreamDefaultWriter<W = any> = typeof globalThis extends { onmessage: any } ? {}
    : import("stream/web").WritableStreamDefaultWriter<W>;

declare module "stream/web" {
    // stub module, pending copy&paste from .d.ts or manual impl
    // copy from lib.dom.d.ts
    interface ReadableWritablePair<R = any, W = any> {
        readable: ReadableStream<R>;
        /**
         * Provides a convenient, chainable way of piping this readable stream
         * through a transform stream (or any other { writable, readable }
         * pair). It simply pipes the stream into the writable side of the
         * supplied pair, and returns the readable side for further use.
         *
         * Piping a stream will lock it for the duration of the pipe, preventing
         * any other consumer from acquiring a reader.
         */
        writable: WritableStream<W>;
    }
    interface StreamPipeOptions {
        preventAbort?: boolean;
        preventCancel?: boolean;
        /**
         * Pipes this readable stream to a given writable stream destination.
         * The way in which the piping process behaves under various error
         * conditions can be customized with a number of passed options. It
         * returns a promise that fulfills when the piping process completes
         * successfully, or rejects if any errors were encountered.
         *
         * Piping a stream will lock it for the duration of the pipe, preventing
         * any other consumer from acquiring a reader.
         *
         * Errors and closures of the source and destination streams propagate
         * as follows:
         *
         * An error in this source readable stream will abort destination,
         * unless preventAbort is truthy. The returned promise will be rejected
         * with the source's error, or with any error that occurs during
         * aborting the destination.
         *
         * An error in destination will cancel this source readable stream,
         * unless preventCancel is truthy. The returned promise will be rejected
         * with the destination's error, or with any error that occurs during
         * canceling the source.
         *
         * When this source readable stream closes, destination will be closed,
         * unless preventClose is truthy. The returned promise will be fulfilled
         * once this process completes, unless an error is encountered while
         * closing the destination, in which case it will be rejected with that
         * error.
         *
         * If destination starts out closed or closing, this source readable
         * stream will be canceled, unless preventCancel is true. The returned
         * promise will be rejected with an error indicating piping to a closed
         * stream failed, or with any error that occurs during canceling the
         * source.
         *
         * The signal option can be set to an AbortSignal to allow aborting an
         * ongoing pipe operation via the corresponding AbortController. In this
         * case, this source readable stream will be canceled, and destination
         * aborted, unless the respective options preventCancel or preventAbort
         * are set.
         */
        preventClose?: boolean;
        signal?: AbortSignal;
    }
    interface ReadableStreamGenericReader {
        readonly closed: Promise<void>;
        cancel(reason?: any): Promise<void>;
    }
    type ReadableStreamController<T> = ReadableStreamDefaultController<T>;
    interface ReadableStreamReadValueResult<T> {
        done: false;
        value: T;
    }
    interface ReadableStreamReadDoneResult<T> {
        done: true;
        value: T | undefined;
    }
    type ReadableStreamReadResult<T> = ReadableStreamReadValueResult<T> | ReadableStreamReadDoneResult<T>;
    interface ReadableByteStreamControllerCallback {
        (controller: ReadableByteStreamController): void | PromiseLike<void>;
    }
    interface UnderlyingSinkAbortCallback {
        (reason?: any): void | PromiseLike<void>;
    }
    interface UnderlyingSinkCloseCallback {
        (): void | PromiseLike<void>;
    }
    interface UnderlyingSinkStartCallback {
        (controller: WritableStreamDefaultController): any;
    }
    interface UnderlyingSinkWriteCallback<W> {
        (chunk: W, controller: WritableStreamDefaultController): void | PromiseLike<void>;
    }
    interface UnderlyingSourceCancelCallback {
        (reason?: any): void | PromiseLike<void>;
    }
    interface UnderlyingSourcePullCallback<R> {
        (controller: ReadableStreamController<R>): void | PromiseLike<void>;
    }
    interface UnderlyingSourceStartCallback<R> {
        (controller: ReadableStreamController<R>): any;
    }
    interface TransformerFlushCallback<O> {
        (controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
    }
    interface TransformerStartCallback<O> {
        (controller: TransformStreamDefaultController<O>): any;
    }
    interface TransformerTransformCallback<I, O> {
        (chunk: I, controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
    }
    interface UnderlyingByteSource {
        autoAllocateChunkSize?: number;
        cancel?: ReadableStreamErrorCallback;
        pull?: ReadableByteStreamControllerCallback;
        start?: ReadableByteStreamControllerCallback;
        type: "bytes";
    }
    interface UnderlyingSource<R = any> {
        cancel?: UnderlyingSourceCancelCallback;
        pull?: UnderlyingSourcePullCallback<R>;
        start?: UnderlyingSourceStartCallback<R>;
        type?: undefined;
    }
    interface UnderlyingSink<W = any> {
        abort?: UnderlyingSinkAbortCallback;
        close?: UnderlyingSinkCloseCallback;
        start?: UnderlyingSinkStartCallback;
        type?: undefined;
        write?: UnderlyingSinkWriteCallback<W>;
    }
    interface ReadableStreamErrorCallback {
        (reason: any): void | PromiseLike<void>;
    }
    interface ReadableStreamAsyncIterator<T> extends NodeJS.AsyncIterator<T, NodeJS.BuiltinIteratorReturn, unknown> {
        [Symbol.asyncIterator](): ReadableStreamAsyncIterator<T>;
    }
    /** This Streams API interface represents a readable stream of byte data. */
    interface ReadableStream<R = any> {
        readonly locked: boolean;
        cancel(reason?: any): Promise<void>;
        getReader(options: { mode: "byob" }): ReadableStreamBYOBReader;
        getReader(): ReadableStreamDefaultReader<R>;
        getReader(options?: ReadableStreamGetReaderOptions): ReadableStreamReader<R>;
        pipeThrough<T>(transform: ReadableWritablePair<T, R>, options?: StreamPipeOptions): ReadableStream<T>;
        pipeTo(destination: WritableStream<R>, options?: StreamPipeOptions): Promise<void>;
        tee(): [ReadableStream<R>, ReadableStream<R>];
        values(options?: { preventCancel?: boolean }): ReadableStreamAsyncIterator<R>;
        [Symbol.asyncIterator](): ReadableStreamAsyncIterator<R>;
    }
    const ReadableStream: {
        prototype: ReadableStream;
        from<T>(iterable: Iterable<T> | AsyncIterable<T>): ReadableStream<T>;
        new(underlyingSource: UnderlyingByteSource, strategy?: QueuingStrategy<Uint8Array>): ReadableStream<Uint8Array>;
        new<R = any>(underlyingSource?: UnderlyingSource<R>, strategy?: QueuingStrategy<R>): ReadableStream<R>;
    };
    type ReadableStreamReaderMode = "byob";
    interface ReadableStreamGetReaderOptions {
        /**
         * Creates a ReadableStreamBYOBReader and locks the stream to the new reader.
         *
         * This call behaves the same way as the no-argument variant, except that it only works on readable byte streams, i.e. streams which were constructed specifically with the ability to handle "bring your own buffer" reading. The returned BYOB reader provides the ability to directly read individual chunks from the stream via its read() method, into developer-supplied buffers, allowing more precise control over allocation.
         */
        mode?: ReadableStreamReaderMode;
    }
    type ReadableStreamReader<T> = ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader;
    interface ReadableStreamDefaultReader<R = any> extends ReadableStreamGenericReader {
        read(): Promise<ReadableStreamReadResult<R>>;
        releaseLock(): void;
    }
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader) */
    interface ReadableStreamBYOBReader extends ReadableStreamGenericReader {
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/read) */
        read<T extends ArrayBufferView>(
            view: T,
            options?: {
                min?: number;
            },
        ): Promise<ReadableStreamReadResult<T>>;
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/releaseLock) */
        releaseLock(): void;
    }
    const ReadableStreamDefaultReader: {
        prototype: ReadableStreamDefaultReader;
        new<R = any>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R>;
    };
    const ReadableStreamBYOBReader: {
        prototype: ReadableStreamBYOBReader;
        new(stream: ReadableStream): ReadableStreamBYOBReader;
    };
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest) */
    interface ReadableStreamBYOBRequest {
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/view) */
        readonly view: ArrayBufferView | null;
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/respond) */
        respond(bytesWritten: number): void;
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/respondWithNewView) */
        respondWithNewView(view: ArrayBufferView): void;
    }
    const ReadableStreamBYOBRequest: {
        prototype: ReadableStreamBYOBRequest;
        new(): ReadableStreamBYOBRequest;
    };
    interface ReadableByteStreamController {
        readonly byobRequest: ReadableStreamBYOBRequest | null;
        readonly desiredSize: number | null;
        close(): void;
        enqueue(chunk: ArrayBufferView): void;
        error(error?: any): void;
    }
    const ReadableByteStreamController: {
        prototype: ReadableByteStreamController;
        new(): ReadableByteStreamController;
    };
    interface ReadableStreamDefaultController<R = any> {
        readonly desiredSize: number | null;
        close(): void;
        enqueue(chunk: R): void;
        error(e?: any): void;
    }
    const ReadableStreamDefaultController: {
        prototype: ReadableStreamDefaultController;
        new(): ReadableStreamDefaultController;
    };
    interface Transformer<I = any, O = any> {
        flush?: TransformerFlushCallback<O>;
        readableType?: undefined;
        start?: TransformerStartCallback<O>;
        transform?: TransformerTransformCallback<I, O>;
        writableType?: undefined;
    }
    interface TransformStream<I = any, O = any> {
        readonly readable: ReadableStream<O>;
        readonly writable: WritableStream<I>;
    }
    const TransformStream: {
        prototype: TransformStream;
        new<I = any, O = any>(
            transformer?: Transformer<I, O>,
            writableStrategy?: QueuingStrategy<I>,
            readableStrategy?: QueuingStrategy<O>,
        ): TransformStream<I, O>;
    };
    interface TransformStreamDefaultController<O = any> {
        readonly desiredSize: number | null;
        enqueue(chunk: O): void;
        error(reason?: any): void;
        terminate(): void;
    }
    const TransformStreamDefaultController: {
        prototype: TransformStreamDefaultController;
        new(): TransformStreamDefaultController;
    };
    /**
     * This Streams API interface provides a standard abstraction for writing
     * streaming data to a destination, known as a sink. This object comes with
     * built-in back pressure and queuing.
     */
    interface WritableStream<W = any> {
        readonly locked: boolean;
        abort(reason?: any): Promise<void>;
        close(): Promise<void>;
        getWriter(): WritableStreamDefaultWriter<W>;
    }
    const WritableStream: {
        prototype: WritableStream;
        new<W = any>(underlyingSink?: UnderlyingSink<W>, strategy?: QueuingStrategy<W>): WritableStream<W>;
    };
    /**
     * This Streams API interface is the object returned by
     * WritableStream.getWriter() and once created locks the < writer to the
     * WritableStream ensuring that no other streams can write to the underlying
     * sink.
     */
    interface WritableStreamDefaultWriter<W = any> {
        readonly closed: Promise<void>;
        readonly desiredSize: number | null;
        readonly ready: Promise<void>;
        abort(reason?: any): Promise<void>;
        close(): Promise<void>;
        releaseLock(): void;
        write(chunk: W): Promise<void>;
    }
    const WritableStreamDefaultWriter: {
        prototype: WritableStreamDefaultWriter;
        new<W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
    };
    /**
     * This Streams API interface represents a controller allowing control of a
     * WritableStream's state. When constructing a WritableStream, the
     * underlying sink is given a corresponding WritableStreamDefaultController
     * instance to manipulate.
     */
    interface WritableStreamDefaultController {
        error(e?: any): void;
    }
    const WritableStreamDefaultController: {
        prototype: WritableStreamDefaultController;
        new(): WritableStreamDefaultController;
    };
    interface QueuingStrategy<T = any> {
        highWaterMark?: number;
        size?: QueuingStrategySize<T>;
    }
    interface QueuingStrategySize<T = any> {
        (chunk: T): number;
    }
    interface QueuingStrategyInit {
        /**
         * Creates a new ByteLengthQueuingStrategy with the provided high water
         * mark.
         *
         * Note that the provided high water mark will not be validated ahead of
         * time. Instead, if it is negative, NaN, or not a number, the resulting
         * ByteLengthQueuingStrategy will cause the corresponding stream
         * constructor to throw.
         */
        highWaterMark: number;
    }
    /**
     * This Streams API interface provides a built-in byte length queuing
     * strategy that can be used when constructing streams.
     */
    interface ByteLengthQueuingStrategy extends QueuingStrategy<ArrayBufferView> {
        readonly highWaterMark: number;
        readonly size: QueuingStrategySize<ArrayBufferView>;
    }
    const ByteLengthQueuingStrategy: {
        prototype: ByteLengthQueuingStrategy;
        new(init: QueuingStrategyInit): ByteLengthQueuingStrategy;
    };
    /**
     * This Streams API interface provides a built-in byte length queuing
     * strategy that can be used when constructing streams.
     */
    interface CountQueuingStrategy extends QueuingStrategy {
        readonly highWaterMark: number;
        readonly size: QueuingStrategySize;
    }
    const CountQueuingStrategy: {
        prototype: CountQueuingStrategy;
        new(init: QueuingStrategyInit): CountQueuingStrategy;
    };
    interface TextEncoderStream {
        /** Returns "utf-8". */
        readonly encoding: "utf-8";
        readonly readable: ReadableStream<Uint8Array>;
        readonly writable: WritableStream<string>;
        readonly [Symbol.toStringTag]: string;
    }
    const TextEncoderStream: {
        prototype: TextEncoderStream;
        new(): TextEncoderStream;
    };
    interface TextDecoderOptions {
        fatal?: boolean;
        ignoreBOM?: boolean;
    }
    type BufferSource = ArrayBufferView | ArrayBuffer;
    interface TextDecoderStream {
        /** Returns encoding's name, lower cased. */
        readonly encoding: string;
        /** Returns `true` if error mode is "fatal", and `false` otherwise. */
        readonly fatal: boolean;
        /** Returns `true` if ignore BOM flag is set, and `false` otherwise. */
        readonly ignoreBOM: boolean;
        readonly readable: ReadableStream<string>;
        readonly writable: WritableStream<BufferSource>;
        readonly [Symbol.toStringTag]: string;
    }
    const TextDecoderStream: {
        prototype: TextDecoderStream;
        new(encoding?: string, options?: TextDecoderOptions): TextDecoderStream;
    };
    interface CompressionStream {
        readonly readable: ReadableStream;
        readonly writable: WritableStream;
    }
    const CompressionStream: {
        prototype: CompressionStream;
        new(format: "deflate" | "deflate-raw" | "gzip"): CompressionStream;
    };
    interface DecompressionStream {
        readonly writable: WritableStream;
        readonly readable: ReadableStream;
    }
    const DecompressionStream: {
        prototype: DecompressionStream;
        new(format: "deflate" | "deflate-raw" | "gzip"): DecompressionStream;
    };

    global {
        interface ByteLengthQueuingStrategy extends _ByteLengthQueuingStrategy {}
        var ByteLengthQueuingStrategy: typeof globalThis extends { onmessage: any; ByteLengthQueuingStrategy: infer T }
            ? T
            : typeof import("stream/web").ByteLengthQueuingStrategy;

        interface CompressionStream extends _CompressionStream {}
        var CompressionStream: typeof globalThis extends {
            onmessage: any;
            // CompressionStream, DecompressionStream and ReportingObserver was introduced in the same commit.
            // If ReportingObserver check is removed, the type here will form a circular reference in TS5.0+lib.dom.d.ts
            ReportingObserver: any;
            CompressionStream: infer T;
        } ? T
            // TS 4.8, 4.9, 5.0
            : typeof globalThis extends { onmessage: any; TransformStream: { prototype: infer T } } ? {
                    prototype: T;
                    new(format: "deflate" | "deflate-raw" | "gzip"): T;
                }
            : typeof import("stream/web").CompressionStream;

        interface CountQueuingStrategy extends _CountQueuingStrategy {}
        var CountQueuingStrategy: typeof globalThis extends { onmessage: any; CountQueuingStrategy: infer T } ? T
            : typeof import("stream/web").CountQueuingStrategy;

        interface DecompressionStream extends _DecompressionStream {}
        var DecompressionStream: typeof globalThis extends {
            onmessage: any;
            // CompressionStream, DecompressionStream and ReportingObserver was introduced in the same commit.
            // If ReportingObserver check is removed, the type here will form a circular reference in TS5.0+lib.dom.d.ts
            ReportingObserver: any;
            DecompressionStream: infer T;
        } ? T
            // TS 4.8, 4.9, 5.0
            : typeof globalThis extends { onmessage: any; TransformStream: { prototype: infer T } } ? {
                    prototype: T;
                    new(format: "deflate" | "deflate-raw" | "gzip"): T;
                }
            : typeof import("stream/web").DecompressionStream;

        interface QueuingStrategy<T = any> extends _QueuingStrategy<T> {}

        interface ReadableByteStreamController extends _ReadableByteStreamController {}
        var ReadableByteStreamController: typeof globalThis extends
            { onmessage: any; ReadableByteStreamController: infer T } ? T
            : typeof import("stream/web").ReadableByteStreamController;

        interface ReadableStream<R = any> extends _ReadableStream<R> {}
        var ReadableStream: typeof globalThis extends { onmessage: any; ReadableStream: infer T } ? T
            : typeof import("stream/web").ReadableStream;

        interface ReadableStreamBYOBReader extends _ReadableStreamBYOBReader {}
        var ReadableStreamBYOBReader: typeof globalThis extends { onmessage: any; ReadableStreamBYOBReader: infer T }
            ? T
            : typeof import("stream/web").ReadableStreamBYOBReader;

        interface ReadableStreamBYOBRequest extends _ReadableStreamBYOBRequest {}
        var ReadableStreamBYOBRequest: typeof globalThis extends { onmessage: any; ReadableStreamBYOBRequest: infer T }
            ? T
            : typeof import("stream/web").ReadableStreamBYOBRequest;

        interface ReadableStreamDefaultController<R = any> extends _ReadableStreamDefaultController<R> {}
        var ReadableStreamDefaultController: typeof globalThis extends
            { onmessage: any; ReadableStreamDefaultController: infer T } ? T
            : typeof import("stream/web").ReadableStreamDefaultController;

        interface ReadableStreamDefaultReader<R = any> extends _ReadableStreamDefaultReader<R> {}
        var ReadableStreamDefaultReader: typeof globalThis extends
            { onmessage: any; ReadableStreamDefaultReader: infer T } ? T
            : typeof import("stream/web").ReadableStreamDefaultReader;

        interface TextDecoderStream extends _TextDecoderStream {}
        var TextDecoderStream: typeof globalThis extends { onmessage: any; TextDecoderStream: infer T } ? T
            : typeof import("stream/web").TextDecoderStream;

        interface TextEncoderStream extends _TextEncoderStream {}
        var TextEncoderStream: typeof globalThis extends { onmessage: any; TextEncoderStream: infer T } ? T
            : typeof import("stream/web").TextEncoderStream;

        interface TransformStream<I = any, O = any> extends _TransformStream<I, O> {}
        var TransformStream: typeof globalThis extends { onmessage: any; TransformStream: infer T } ? T
            : typeof import("stream/web").TransformStream;

        interface TransformStreamDefaultController<O = any> extends _TransformStreamDefaultController<O> {}
        var TransformStreamDefaultController: typeof globalThis extends
            { onmessage: any; TransformStreamDefaultController: infer T } ? T
            : typeof import("stream/web").TransformStreamDefaultController;

        interface WritableStream<W = any> extends _WritableStream<W> {}
        var WritableStream: typeof globalThis extends { onmessage: any; WritableStream: infer T } ? T
            : typeof import("stream/web").WritableStream;

        interface WritableStreamDefaultController extends _WritableStreamDefaultController {}
        var WritableStreamDefaultController: typeof globalThis extends
            { onmessage: any; WritableStreamDefaultController: infer T } ? T
            : typeof import("stream/web").WritableStreamDefaultController;

        interface WritableStreamDefaultWriter<W = any> extends _WritableStreamDefaultWriter<W> {}
        var WritableStreamDefaultWriter: typeof globalThis extends
            { onmessage: any; WritableStreamDefaultWriter: infer T } ? T
            : typeof import("stream/web").WritableStreamDefaultWriter;
    }
}
declare module "node:stream/web" {
    export * from "stream/web";
}
