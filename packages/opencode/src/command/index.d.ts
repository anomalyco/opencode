import z from "zod";
export declare namespace Command {
    const Event: {
        Executed: any;
    };
    const Info: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodEnum<{
            command: "command";
            mcp: "mcp";
            skill: "skill";
        }>>;
        template: z.ZodUnion<[z.ZodPromise<z.ZodString>, z.ZodString]>;
        subtask: z.ZodOptional<z.ZodBoolean>;
        hints: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    type Info = Omit<z.infer<typeof Info>, "template"> & {
        template: Promise<string> | string;
    };
    function hints(template: string): string[];
    const Default: {
        readonly INIT: "init";
        readonly REVIEW: "review";
    };
    function get(name: string): Promise<Info>;
    function list(): Promise<Info[]>;
}
