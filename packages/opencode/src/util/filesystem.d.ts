import { statSync } from "fs";
import { Readable } from "stream";
export declare namespace Filesystem {
    function exists(p: string): Promise<boolean>;
    function isDir(p: string): Promise<boolean>;
    function stat(p: string): ReturnType<typeof statSync> | undefined;
    function size(p: string): Promise<number>;
    function readText(p: string): Promise<string>;
    function readJson<T = any>(p: string): Promise<T>;
    function readBytes(p: string): Promise<Buffer>;
    function readArrayBuffer(p: string): Promise<ArrayBuffer>;
    function write(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void>;
    function writeJson(p: string, data: unknown, mode?: number): Promise<void>;
    function writeStream(p: string, stream: ReadableStream<Uint8Array> | Readable, mode?: number): Promise<void>;
    function mimeType(p: string): string;
    /**
     * On Windows, normalize a path to its canonical casing using the filesystem.
     * This is needed because Windows paths are case-insensitive but LSP servers
     * may return paths with different casing than what we send them.
     */
    function normalizePath(p: string): string;
    function resolve(p: string): string;
    function windowsPath(p: string): string;
    function overlaps(a: string, b: string): boolean;
    function contains(parent: string, child: string): boolean;
    function findUp(target: string, start: string, stop?: string): Promise<string[]>;
    function up(options: {
        targets: string[];
        start: string;
        stop?: string;
    }): AsyncGenerator<string, void, unknown>;
    function globUp(pattern: string, start: string, stop?: string): Promise<string[]>;
}
