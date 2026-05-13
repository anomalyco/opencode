import z from "zod";
export declare namespace File {
    const Info: z.ZodObject<{
        path: z.ZodString;
        added: z.ZodNumber;
        removed: z.ZodNumber;
        status: z.ZodEnum<{
            added: "added";
            deleted: "deleted";
            modified: "modified";
        }>;
    }, z.core.$strip>;
    type Info = z.infer<typeof Info>;
    const Node: z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
        absolute: z.ZodString;
        type: z.ZodEnum<{
            directory: "directory";
            file: "file";
        }>;
        ignored: z.ZodBoolean;
    }, z.core.$strip>;
    type Node = z.infer<typeof Node>;
    const Content: z.ZodObject<{
        type: z.ZodEnum<{
            binary: "binary";
            text: "text";
        }>;
        content: z.ZodString;
        diff: z.ZodOptional<z.ZodString>;
        patch: z.ZodOptional<z.ZodObject<{
            oldFileName: z.ZodString;
            newFileName: z.ZodString;
            oldHeader: z.ZodOptional<z.ZodString>;
            newHeader: z.ZodOptional<z.ZodString>;
            hunks: z.ZodArray<z.ZodObject<{
                oldStart: z.ZodNumber;
                oldLines: z.ZodNumber;
                newStart: z.ZodNumber;
                newLines: z.ZodNumber;
                lines: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
            index: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        encoding: z.ZodOptional<z.ZodLiteral<"base64">>;
        mimeType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    type Content = z.infer<typeof Content>;
    const Event: {
        Edited: any;
    };
    function init(): void;
    function status(): Promise<{
        added: number;
        removed: number;
        status: "added" | "deleted" | "modified";
        path: string;
    }[]>;
    function read(file: string): Promise<Content>;
    /** No host project directory is exposed; listing is not supported. */
    function list(_dir?: string): Promise<{
        name: string;
        path: string;
        absolute: string;
        type: "directory" | "file";
        ignored: boolean;
    }[]>;
    function search(input: {
        query: string;
        limit?: number;
        dirs?: boolean;
        type?: "file" | "directory";
    }): Promise<string[]>;
    function write(filepath: string, content: Uint8Array): Promise<Node>;
    function mkdir(dirpath: string): Promise<Node>;
    function remove(filepath: string, recursive?: boolean): Promise<void>;
}
