import { z } from "zod/v4";
export declare const localShellInputSchema: z.ZodObject<{
    action: z.ZodObject<{
        type: z.ZodLiteral<"exec">;
        command: z.ZodArray<z.ZodString>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        user: z.ZodOptional<z.ZodString>;
        workingDirectory: z.ZodOptional<z.ZodString>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const localShellOutputSchema: z.ZodObject<{
    output: z.ZodString;
}, z.core.$strip>;
export declare const localShell: import("@ai-sdk/provider-utils").ProviderDefinedToolFactoryWithOutputSchema<{
    /**
     * Execute a shell command on the server.
     */
    action: {
        type: "exec";
        /**
         * The command to run.
         */
        command: string[];
        /**
         * Optional timeout in milliseconds for the command.
         */
        timeoutMs?: number | undefined;
        /**
         * Optional user to run the command as.
         */
        user?: string | undefined;
        /**
         * Optional working directory to run the command in.
         */
        workingDirectory?: string | undefined;
        /**
         * Environment variables to set for the command.
         */
        env?: Record<string, string> | undefined;
    };
}, {
    /**
     * The output of local shell tool call.
     */
    output: string;
}, {}>;
