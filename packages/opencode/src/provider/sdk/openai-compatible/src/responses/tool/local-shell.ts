import { createProviderDefinedToolFactoryWithOutputSchema } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"

export const localShellInputSchema = z.object({
  action: z.object({
    type: z.literal("exec"),
    command: z.array(z.string()),
    timeoutMs: z.number().optional(),
    user: z.string().optional(),
    workingDirectory: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
})

export const localShellOutputSchema = z.object({
  output: z.string(),
})

export const localShell = createProviderDefinedToolFactoryWithOutputSchema<
  {
    /**
     * Execute a shell command on the server.
     */
    action: {
      type: "exec"

      /**
       * The command to run.
       */
      command: string[]

      /**
       * Optional timeout in milliseconds for the command.
       */
      timeoutMs?: number

      /**
       * Optional user to run the command as.
       */
      user?: string

      /**
       * Optional working directory to run the command in.
       */
      workingDirectory?: string

      /**
       * Environment variables to set for the command.
       */
      env?: Record<string, string>
    }
  },
  {
    /**
     * The output of local shell tool call.
     */
    output: string
  },
  {}
>({
  id: "openai.local_shell",
  name: "local_shell",
  inputSchema: localShellInputSchema,
  outputSchema: localShellOutputSchema,
})
