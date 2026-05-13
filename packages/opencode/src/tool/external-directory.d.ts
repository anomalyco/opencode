import type { Tool } from "./tool";
type Kind = "file" | "directory";
type Options = {
    bypass?: boolean;
    kind?: Kind;
};
export declare function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options): Promise<void>;
export {};
