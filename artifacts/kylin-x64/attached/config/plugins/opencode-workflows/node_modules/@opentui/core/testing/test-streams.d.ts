import { Writable } from "stream";
export declare class TestWriteStream extends Writable {
    readonly isTTY = true;
    readonly columns: number;
    readonly rows: number;
    constructor(columns?: number, rows?: number);
    _write(_chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
    getColorDepth(): number;
}
export type TestStdout = TestWriteStream & NodeJS.WriteStream;
export declare function createTestStdin(): NodeJS.ReadStream;
export declare function createTestStdout(columns?: number, rows?: number): NodeJS.WriteStream;
