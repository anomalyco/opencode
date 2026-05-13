import z from "zod";
export declare namespace Vcs {
    const Event: {
        BranchUpdated: any;
    };
    const Info: z.ZodObject<{
        branch: z.ZodString;
    }, z.core.$strip>;
    type Info = z.infer<typeof Info>;
    function init(): Promise<{
        branch: () => Promise<any>;
        unsubscribe: any;
    }>;
    function branch(): Promise<any>;
}
