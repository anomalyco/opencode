import z from "zod";
export declare namespace Snapshot {
    function init(): void;
    function cleanup(): Promise<void>;
    function track(): Promise<any>;
    const Patch: z.ZodObject<{
        hash: z.ZodString;
        files: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    type Patch = z.infer<typeof Patch>;
    function patch(hash: string): Promise<Patch>;
    function restore(snapshot: string): Promise<void>;
    function revert(patches: Patch[]): Promise<void>;
    function diff(hash: string): Promise<any>;
    const FileDiff: z.ZodObject<{
        file: z.ZodString;
        before: z.ZodString;
        after: z.ZodString;
        additions: z.ZodNumber;
        deletions: z.ZodNumber;
        status: z.ZodOptional<z.ZodEnum<{
            added: "added";
            deleted: "deleted";
            modified: "modified";
        }>>;
    }, z.core.$strip>;
    type FileDiff = z.infer<typeof FileDiff>;
    function diffFull(from: string, to: string): Promise<FileDiff[]>;
}
