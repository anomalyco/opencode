import z from "zod"
import path from "node:path"
import { validateAuthConfig } from "@opencode-ai/fork-auth"
import { AuthConfig } from "@opencode-ai/fork-auth/config"

export type ForkConfigInfo = {
  workspace?: {
    root?: string
  }
  auth?: z.infer<typeof AuthConfig>
  [key: string]: unknown
}

export type ForkFilesystem = {
  exists: (path: string) => Promise<boolean>
}

export function extendForkServerConfig<T extends z.ZodRawShape>(server: z.ZodObject<T>) {
  return server.extend({
    uiUrl: z
      .string()
      .url()
      .optional()
      .describe("Base URL for the web UI proxy (defaults to https://app.opencode.ai)"),
  })
}

export function extendForkInfoConfig<T extends z.ZodRawShape>(info: z.ZodObject<T>) {
  return info.extend({
    workspace: z
      .object({
        root: z.string().optional().describe("Workspace root for cloning repositories"),
      })
      .optional(),
    auth: AuthConfig.optional().describe("Authentication configuration for multi-user access"),
  })
}

export function applyForkConfigDefaults(result: ForkConfigInfo, opts: { home: string }): void {
  result.workspace = result.workspace || {}
  if (!result.workspace.root) {
    result.workspace.root = path.join(opts.home, "opencode")
  }
}

export async function validateForkConfig(args: {
  auth: ForkConfigInfo["auth"]
  filesystem: ForkFilesystem
  log: { info: (message: string, data?: unknown) => void }
  onMissingPam: (input: { service: string; path: string }) => Error
}): Promise<void> {
  await validateAuthConfig({
    auth: args.auth,
    filesystem: args.filesystem,
    log: args.log,
    onMissingPam: args.onMissingPam,
  })
}
