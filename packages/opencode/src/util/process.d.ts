import { type ChildProcess } from "child_process";
export declare namespace Process {
    type Stdio = "inherit" | "pipe" | "ignore";
    interface Options {
        cwd?: string;
        env?: NodeJS.ProcessEnv | null;
        stdin?: Stdio;
        stdout?: Stdio;
        stderr?: Stdio;
        abort?: AbortSignal;
        kill?: NodeJS.Signals | number;
        timeout?: number;
    }
    interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
        nothrow?: boolean;
    }
    interface Result {
        code: number;
        stdout: Buffer;
        stderr: Buffer;
    }
    interface TextResult extends Result {
        text: string;
    }
    class RunFailedError extends Error {
        readonly cmd: string[];
        readonly code: number;
        readonly stdout: Buffer;
        readonly stderr: Buffer;
        constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer);
    }
    type Child = ChildProcess & {
        exited: Promise<number>;
    };
    function spawn(cmd: string[], opts?: Options): Child;
    function run(cmd: string[], opts?: RunOptions): Promise<Result>;
    function text(cmd: string[], opts?: RunOptions): Promise<TextResult>;
    function lines(cmd: string[], opts?: RunOptions): Promise<string[]>;
}
