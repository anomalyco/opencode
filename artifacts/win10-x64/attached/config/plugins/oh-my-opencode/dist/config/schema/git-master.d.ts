import { z } from "zod";
export declare const GitMasterConfigSchema: z.ZodObject<{
    commit_footer: z.ZodDefault<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
    include_co_authored_by: z.ZodDefault<z.ZodBoolean>;
    git_env_prefix: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>;
