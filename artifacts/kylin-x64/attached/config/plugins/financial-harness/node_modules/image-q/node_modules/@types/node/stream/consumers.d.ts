// Duplicates of interface in lib.dom.ts.
// Duplicated here rather than referencing lib.dom.ts because doing so causes lib.dom.ts to be loaded for "test-all"
// Which in turn causes tests to pass that shouldn't pass.
//
// This interface is not, and should not be, exported.
interface Blob {
    readonly size: number;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
    slice(start?: number, end?: number, contentType?: string): Blob;
    stream(): NodeJS.ReadableStream;
    text(): Promise<string>;
}
declare module 'stream/consumers' {
    import { Readable } from 'node:stream';
    function buffer(stream: NodeJS.ReadableStream | Readable | AsyncIterator<any>): Promise<Buffer>;
    function text(stream: NodeJS.ReadableStream | Readable | AsyncIterator<any>): Promise<string>;
    function arrayBuffer(stream: NodeJS.ReadableStream | Readable | AsyncIterator<any>): Promise<ArrayBuffer>;
    function blob(stream: NodeJS.ReadableStream | Readable | AsyncIterator<any>): Promise<Blob>;
    function json(stream: NodeJS.ReadableStream | Readable | AsyncIterator<any>): Promise<unknown>;
}
declare module 'node:stream/consumers' {
    export * from 'stream/consumers';
}
