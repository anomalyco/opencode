import z from "zod";
export declare namespace Identifier {
    const prefixes: {
        readonly session: "ses";
        readonly message: "msg";
        readonly permission: "per";
        readonly question: "que";
        readonly user: "usr";
        readonly part: "prt";
        readonly tool: "tool";
    };
    export function schema(prefix: keyof typeof prefixes): z.ZodString;
    export function ascending(prefix: keyof typeof prefixes, given?: string): string;
    export function descending(prefix: keyof typeof prefixes, given?: string): string;
    export function create(prefix: keyof typeof prefixes, descending: boolean, timestamp?: number): string;
    /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
    export function timestamp(id: string): number;
    export {};
}
