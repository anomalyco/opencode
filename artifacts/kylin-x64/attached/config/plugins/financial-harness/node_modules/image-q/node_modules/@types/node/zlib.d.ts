/**
 * The `zlib` module provides compression functionality implemented using Gzip,
 * Deflate/Inflate, and Brotli.
 *
 * To access it:
 *
 * ```js
 * const zlib = require('zlib');
 * ```
 *
 * Compression and decompression are built around the Node.js `Streams API`.
 *
 * Compressing or decompressing a stream (such as a file) can be accomplished by
 * piping the source stream through a `zlib` `Transform` stream into a destination
 * stream:
 *
 * ```js
 * const { createGzip } = require('zlib');
 * const { pipeline } = require('stream');
 * const {
 *   createReadStream,
 *   createWriteStream
 * } = require('fs');
 *
 * const gzip = createGzip();
 * const source = createReadStream('input.txt');
 * const destination = createWriteStream('input.txt.gz');
 *
 * pipeline(source, gzip, destination, (err) => {
 *   if (err) {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   }
 * });
 *
 * // Or, Promisified
 *
 * const { promisify } = require('util');
 * const pipe = promisify(pipeline);
 *
 * async function do_gzip(input, output) {
 *   const gzip = createGzip();
 *   const source = createReadStream(input);
 *   const destination = createWriteStream(output);
 *   await pipe(source, gzip, destination);
 * }
 *
 * do_gzip('input.txt', 'input.txt.gz')
 *   .catch((err) => {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   });
 * ```
 *
 * It is also possible to compress or decompress data in a single step:
 *
 * ```js
 * const { deflate, unzip } = require('zlib');
 *
 * const input = '.................................';
 * deflate(input, (err, buffer) => {
 *   if (err) {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   }
 *   console.log(buffer.toString('base64'));
 * });
 *
 * const buffer = Buffer.from('eJzT0yMAAGTvBe8=', 'base64');
 * unzip(buffer, (err, buffer) => {
 *   if (err) {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   }
 *   console.log(buffer.toString());
 * });
 *
 * // Or, Promisified
 *
 * const { promisify } = require('util');
 * const do_unzip = promisify(unzip);
 *
 * do_unzip(buffer)
 *   .then((buf) => console.log(buf.toString()))
 *   .catch((err) => {
 *     console.error('An error occurred:', err);
 *     process.exitCode = 1;
 *   });
 * ```
 * @since v0.5.8
 * @see [source](https://github.com/nodejs/node/blob/v16.7.0/lib/zlib.js)
 */
declare module 'zlib' {
    import * as stream from 'node:stream';
    interface ZlibOptions {
        /**
         * @default constants.Z_NO_FLUSH
         */
        flush?: number | undefined;
        /**
         * @default constants.Z_FINISH
         */
        finishFlush?: number | undefined;
        /**
         * @default 16*1024
         */
        chunkSize?: number | undefined;
        windowBits?: number | undefined;
        level?: number | undefined; // compression only
        memLevel?: number | undefined; // compression only
        strategy?: number | undefined; // compression only
        dictionary?: NodeJS.ArrayBufferView | ArrayBuffer | undefined; // deflate/inflate only, empty dictionary by default
        info?: boolean | undefined;
        maxOutputLength?: number | undefined;
    }
    interface BrotliOptions {
        /**
         * @default constants.BROTLI_OPERATION_PROCESS
         */
        flush?: number | undefined;
        /**
         * @default constants.BROTLI_OPERATION_FINISH
         */
        finishFlush?: number | undefined;
        /**
         * @default 16*1024
         */
        chunkSize?: number | undefined;
        params?:
            | {
                  /**
                   * Each key is a `constants.BROTLI_*` constant.
                   */
                  [key: number]: boolean | number;
              }
            | undefined;
        maxOutputLength?: number | undefined;
    }
    interface Zlib {
        /** @deprecated Use bytesWritten instead. */
        readonly bytesRead: number;
        readonly bytesWritten: number;
        shell?: boolean | string | undefined;
        close(callback?: () => void): void;
        flush(kind?: number, callback?: () => void): void;
        flush(callback?: () => void): void;
    }
    interface ZlibParams {
        params(level: number, strategy: number, callback: () => void): void;
    }
    interface ZlibReset {
        reset(): void;
    }
    interface BrotliCompress extends stream.Transform, Zlib {}
    interface BrotliDecompress extends stream.Transform, Zlib {}
    interface Gzip extends stream.Transform, Zlib {}
    interface Gunzip extends stream.Transform, Zlib {}
    interface Deflate extends stream.Transform, Zlib, ZlibReset, ZlibParams {}
    interface Inflate extends stream.Transform, Zlib, ZlibReset {}
    interface DeflateRaw extends stream.Transform, Zlib, ZlibReset, ZlibParams {}
    interface InflateRaw extends stream.Transform, Zlib, ZlibReset {}
    interface Unzip extends stream.Transform, Zlib {}
    /**
     * Creates and returns a new `BrotliCompress` object.
     * @since v11.7.0, v10.16.0
     */
    function createBrotliCompress(options?: BrotliOptions): BrotliCompress;
    /**
     * Creates and returns a new `BrotliDecompress` object.
     * @since v11.7.0, v10.16.0
     */
    function createBrotliDecompress(options?: BrotliOptions): BrotliDecompress;
    /**
     * Creates and returns a new `Gzip` object.
     * See `example`.
     * @since v0.5.8
     */
    function createGzip(options?: ZlibOptions): Gzip;
    /**
     * Creates and returns a new `Gunzip` object.
     * @since v0.5.8
     */
    function createGunzip(options?: ZlibOptions): Gunzip;
    /**
     * Creates and returns a new `Deflate` object.
     * @since v0.5.8
     */
    function createDeflate(options?: ZlibOptions): Deflate;
    /**
     * Creates and returns a new `Inflate` object.
     * @since v0.5.8
     */
    function createInflate(options?: ZlibOptions): Inflate;
    /**
     * Creates and returns a new `DeflateRaw` object.
     *
     * An upgrade of zlib from 1.2.8 to 1.2.11 changed behavior when `windowBits`is set to 8 for raw deflate streams. zlib would automatically set `windowBits`to 9 if was initially set to 8\. Newer
     * versions of zlib will throw an exception,
     * so Node.js restored the original behavior of upgrading a value of 8 to 9,
     * since passing `windowBits = 9` to zlib actually results in a compressed stream
     * that effectively uses an 8-bit window only.
     * @since v0.5.8
     */
    function createDeflateRaw(options?: ZlibOptions): DeflateRaw;
    /**
     * Creates and returns a new `InflateRaw` object.
     * @since v0.5.8
     */
    function createInflateRaw(options?: ZlibOptions): InflateRaw;
    /**
     * Creates and returns a new `Unzip` object.
     * @since v0.5.8
     */
    function createUnzip(options?: ZlibOptions): Unzip;
    type InputType = string | ArrayBuffer | NodeJS.ArrayBufferView;
    type CompressCallback = (error: Error | null, result: Buffer) => void;
    /**
     * @since v11.7.0, v10.16.0
     */
    function brotliCompress(buf: InputType, options: BrotliOptions, callback: CompressCallback): void;
    function brotliCompress(buf: InputType, callback: CompressCallback): void;
    namespace brotliCompress {
        function __promisify__(buffer: InputType, options?: BrotliOptions): Promise<Buffer>;
    }
    /**
     * Compress a chunk of data with `BrotliCompress`.
     * @since v11.7.0, v10.16.0
     */
    function brotliCompressSync(buf: InputType, options?: BrotliOptions): Buffer;
    /**
     * @since v11.7.0, v10.16.0
     */
    function brotliDecompress(buf: InputType, options: BrotliOptions, callback: CompressCallback): void;
    function brotliDecompress(buf: InputType, callback: CompressCallback): void;
    namespace brotliDecompress {
        function __promisify__(buffer: InputType, options?: BrotliOptions): Promise<Buffer>;
    }
    /**
     * Decompress a chunk of data with `BrotliDecompress`.
     * @since v11.7.0, v10.16.0
     */
    function brotliDecompressSync(buf: InputType, options?: BrotliOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function deflate(buf: InputType, callback: CompressCallback): void;
    function deflate(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace deflate {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Compress a chunk of data with `Deflate`.
     * @since v0.11.12
     */
    function deflateSync(buf: InputType, options?: ZlibOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function deflateRaw(buf: InputType, callback: CompressCallback): void;
    function deflateRaw(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace deflateRaw {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Compress a chunk of data with `DeflateRaw`.
     * @since v0.11.12
     */
    function deflateRawSync(buf: InputType, options?: ZlibOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function gzip(buf: InputType, callback: CompressCallback): void;
    function gzip(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace gzip {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Compress a chunk of data with `Gzip`.
     * @since v0.11.12
     */
    function gzipSync(buf: InputType, options?: ZlibOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function gunzip(buf: InputType, callback: CompressCallback): void;
    function gunzip(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace gunzip {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Decompress a chunk of data with `Gunzip`.
     * @since v0.11.12
     */
    function gunzipSync(buf: InputType, options?: ZlibOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function inflate(buf: InputType, callback: CompressCallback): void;
    function inflate(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace inflate {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Decompress a chunk of data with `Inflate`.
     * @since v0.11.12
     */
    function inflateSync(buf: InputType, options?: ZlibOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function inflateRaw(buf: InputType, callback: CompressCallback): void;
    function inflateRaw(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace inflateRaw {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Decompress a chunk of data with `InflateRaw`.
     * @since v0.11.12
     */
    function inflateRawSync(buf: InputType, options?: ZlibOptions): Buffer;
    /**
     * @since v0.6.0
     */
    function unzip(buf: InputType, callback: CompressCallback): void;
    function unzip(buf: InputType, options: ZlibOptions, callback: CompressCallback): void;
    namespace unzip {
        function __promisify__(buffer: InputType, options?: ZlibOptions): Promise<Buffer>;
    }
    /**
     * Decompress a chunk of data with `Unzip`.
     * @since v0.11.12
     */
    function unzipSync(buf: InputType, options?: ZlibOptions): Buffer;
    namespace constants {
        const BROTLI_DECODE: number;
        const BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES: number;
        const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP: number;
        const BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES: number;
        const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1: number;
        const BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2: number;
        const BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS: number;
        const BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET: number;
        const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1: number;
        const BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2: number;
        const BROTLI_DECODER_ERROR_FORMAT_CL_SPACE: number;
        const BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT: number;
        const BROTLI_DECODER_ERROR_FORMAT_DICTIONARY: number;
        const BROTLI_DECODER_ERROR_FORMAT_DISTANCE: number;
        const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE: number;
        const BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE: number;
        const BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE: number;
        const BROTLI_DECODER_ERROR_FORMAT_PADDING_1: number;
        const BROTLI_DECODER_ERROR_FORMAT_PADDING_2: number;
        const BROTLI_DECODER_ERROR_FORMAT_RESERVED: number;
        const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET: number;
        const BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME: number;
        const BROTLI_DECODER_ERROR_FORMAT_TRANSFORM: number;
        const BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS: number;
        const BROTLI_DECODER_ERROR_INVALID_ARGUMENTS: number;
        const BROTLI_DECODER_ERROR_UNREACHABLE: number;
        const BROTLI_DECODER_NEEDS_MORE_INPUT: number;
        const BROTLI_DECODER_NEEDS_MORE_OUTPUT: number;
        const BROTLI_DECODER_NO_ERROR: number;
        const BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: number;
        const BROTLI_DECODER_PARAM_LARGE_WINDOW: number;
        const BROTLI_DECODER_RESULT_ERROR: number;
        const BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: number;
        const BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: number;
        const BROTLI_DECODER_RESULT_SUCCESS: number;
        const BROTLI_DECODER_SUCCESS: number;
        const BROTLI_DEFAULT_MODE: number;
        const BROTLI_DEFAULT_QUALITY: number;
        const BROTLI_DEFAULT_WINDOW: number;
        const BROTLI_ENCODE: number;
        const BROTLI_LARGE_MAX_WINDOW_BITS: number;
        const BROTLI_MAX_INPUT_BLOCK_BITS: number;
        const BROTLI_MAX_QUALITY: number;
        const BROTLI_MAX_WINDOW_BITS: number;
        const BROTLI_MIN_INPUT_BLOCK_BITS: number;
        const BROTLI_MIN_QUALITY: number;
        const BROTLI_MIN_WINDOW_BITS: number;
        const BROTLI_MODE_FONT: number;
        const BROTLI_MODE_GENERIC: number;
        const BROTLI_MODE_TEXT: number;
        const BROTLI_OPERATION_EMIT_METADATA: number;
        const BROTLI_OPERATION_FINISH: number;
        const BROTLI_OPERATION_FLUSH: number;
        const BROTLI_OPERATION_PROCESS: number;
        const BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: number;
        const BROTLI_PARAM_LARGE_WINDOW: number;
        const BROTLI_PARAM_LGBLOCK: number;
        const BROTLI_PARAM_LGWIN: number;
        const BROTLI_PARAM_MODE: number;
        const BROTLI_PARAM_NDIRECT: number;
        const BROTLI_PARAM_NPOSTFIX: number;
        const BROTLI_PARAM_QUALITY: number;
        const BROTLI_PARAM_SIZE_HINT: number;
        const DEFLATE: number;
        const DEFLATERAW: number;
        const GUNZIP: number;
        const GZIP: number;
        const INFLATE: number;
        const INFLATERAW: number;
        const UNZIP: number;
        // Allowed flush values.
        const Z_NO_FLUSH: number;
        const Z_PARTIAL_FLUSH: number;
        const Z_SYNC_FLUSH: number;
        const Z_FULL_FLUSH: number;
        const Z_FINISH: number;
        const Z_BLOCK: number;
        const Z_TREES: number;
        // Return codes for the compression/decompression functions.
        // Negative values are errors, positive values are used for special but normal events.
        const Z_OK: number;
        const Z_STREAM_END: number;
        const Z_NEED_DICT: number;
        const Z_ERRNO: number;
        const Z_STREAM_ERROR: number;
        const Z_DATA_ERROR: number;
        const Z_MEM_ERROR: number;
        const Z_BUF_ERROR: number;
        const Z_VERSION_ERROR: number;
        // Compression levels.
        const Z_NO_COMPRESSION: number;
        const Z_BEST_SPEED: number;
        const Z_BEST_COMPRESSION: number;
        const Z_DEFAULT_COMPRESSION: number;
        // Compression strategy.
        const Z_FILTERED: number;
        const Z_HUFFMAN_ONLY: number;
        const Z_RLE: number;
        const Z_FIXED: number;
        const Z_DEFAULT_STRATEGY: number;
        const Z_DEFAULT_WINDOWBITS: number;
        const Z_MIN_WINDOWBITS: number;
        const Z_MAX_WINDOWBITS: number;
        const Z_MIN_CHUNK: number;
        const Z_MAX_CHUNK: number;
        const Z_DEFAULT_CHUNK: number;
        const Z_MIN_MEMLEVEL: number;
        const Z_MAX_MEMLEVEL: number;
        const Z_DEFAULT_MEMLEVEL: number;
        const Z_MIN_LEVEL: number;
        const Z_MAX_LEVEL: number;
        const Z_DEFAULT_LEVEL: number;
        const ZLIB_VERNUM: number;
    }
    // Allowed flush values.
    /** @deprecated Use `constants.Z_NO_FLUSH` */
    const Z_NO_FLUSH: number;
    /** @deprecated Use `constants.Z_PARTIAL_FLUSH` */
    const Z_PARTIAL_FLUSH: number;
    /** @deprecated Use `constants.Z_SYNC_FLUSH` */
    const Z_SYNC_FLUSH: number;
    /** @deprecated Use `constants.Z_FULL_FLUSH` */
    const Z_FULL_FLUSH: number;
    /** @deprecated Use `constants.Z_FINISH` */
    const Z_FINISH: number;
    /** @deprecated Use `constants.Z_BLOCK` */
    const Z_BLOCK: number;
    /** @deprecated Use `constants.Z_TREES` */
    const Z_TREES: number;
    // Return codes for the compression/decompression functions.
    // Negative values are errors, positive values are used for special but normal events.
    /** @deprecated Use `constants.Z_OK` */
    const Z_OK: number;
    /** @deprecated Use `constants.Z_STREAM_END` */
    const Z_STREAM_END: number;
    /** @deprecated Use `constants.Z_NEED_DICT` */
    const Z_NEED_DICT: number;
    /** @deprecated Use `constants.Z_ERRNO` */
    const Z_ERRNO: number;
    /** @deprecated Use `constants.Z_STREAM_ERROR` */
    const Z_STREAM_ERROR: number;
    /** @deprecated Use `constants.Z_DATA_ERROR` */
    const Z_DATA_ERROR: number;
    /** @deprecated Use `constants.Z_MEM_ERROR` */
    const Z_MEM_ERROR: number;
    /** @deprecated Use `constants.Z_BUF_ERROR` */
    const Z_BUF_ERROR: number;
    /** @deprecated Use `constants.Z_VERSION_ERROR` */
    const Z_VERSION_ERROR: number;
    // Compression levels.
    /** @deprecated Use `constants.Z_NO_COMPRESSION` */
    const Z_NO_COMPRESSION: number;
    /** @deprecated Use `constants.Z_BEST_SPEED` */
    const Z_BEST_SPEED: number;
    /** @deprecated Use `constants.Z_BEST_COMPRESSION` */
    const Z_BEST_COMPRESSION: number;
    /** @deprecated Use `constants.Z_DEFAULT_COMPRESSION` */
    const Z_DEFAULT_COMPRESSION: number;
    // Compression strategy.
    /** @deprecated Use `constants.Z_FILTERED` */
    const Z_FILTERED: number;
    /** @deprecated Use `constants.Z_HUFFMAN_ONLY` */
    const Z_HUFFMAN_ONLY: number;
    /** @deprecated Use `constants.Z_RLE` */
    const Z_RLE: number;
    /** @deprecated Use `constants.Z_FIXED` */
    const Z_FIXED: number;
    /** @deprecated Use `constants.Z_DEFAULT_STRATEGY` */
    const Z_DEFAULT_STRATEGY: number;
    /** @deprecated */
    const Z_BINARY: number;
    /** @deprecated */
    const Z_TEXT: number;
    /** @deprecated */
    const Z_ASCII: number;
    /** @deprecated  */
    const Z_UNKNOWN: number;
    /** @deprecated */
    const Z_DEFLATED: number;
}
declare module 'node:zlib' {
    export * from 'zlib';
}
