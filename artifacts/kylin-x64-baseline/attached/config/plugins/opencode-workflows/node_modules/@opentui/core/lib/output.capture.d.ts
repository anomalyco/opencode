import { Writable } from "stream";
import { EventEmitter } from "events";
export type CapturedOutput = {
    stream: "stdout" | "stderr";
    output: string;
};
export declare class Capture extends EventEmitter {
    private output;
    constructor();
    get size(): number;
    write(stream: "stdout" | "stderr", data: string): void;
    claimOutput(): string;
    private clear;
}
export declare class CapturedWritableStream extends Writable {
    private stream;
    private capture;
    isTTY: boolean;
    columns: number;
    rows: number;
    constructor(stream: "stdout" | "stderr", capture: Capture);
    _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
    getColorDepth(): number;
}
