export * as ConfigLSP from "./lsp"

import z from "zod"
import * as LSPServer from "../lsp/server"

export const Disabled = z.object({
  disabled: z.literal(true),
})

export const Entry = z.union([
  Disabled,
  z.object({
    command: z.array(z.string()),
    extensions: z.array(z.string()).optional(),
    disabled: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    initialization: z.record(z.string(), z.any()).optional(),
  }),
])

export const Info = z.union([z.boolean(), z.record(z.string(), Entry)]).refine(
  (data) => {
    if (typeof data === "boolean") return true
    const serverIds = new Set(Object.values(LSPServer).map((server) => server.id))

    return Object.entries(data).every(([id, config]) => {
      if (config.disabled) return true
      if (serverIds.has(id)) return true
      return Boolean(config.extensions)
    })
  },
  {
    error: "For custom LSP servers, 'extensions' array is required.",
  },
)

export type Info = z.infer<typeof Info>
