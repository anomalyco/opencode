import type { Agent } from "../agent/agent";
export declare namespace Truncate {
    const MAX_LINES = 2000;
    const MAX_BYTES: number;
    const DIR: string;
    const GLOB: string;
    type Result = {
        content: string;
        truncated: false;
    } | {
        content: string;
        truncated: true;
        outputPath: string;
    };
    interface Options {
        maxLines?: number;
        maxBytes?: number;
        direction?: "head" | "tail";
    }
    function init(): void;
    function cleanup(): Promise<void>;
    function output(text: string, options?: Options, agent?: Agent.Info): Promise<Result>;
}
