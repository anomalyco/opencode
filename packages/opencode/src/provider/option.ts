import z from "zod"

export const TLS = z
  .object({
    key: z.string().optional().describe("Path to a PEM-encoded client key"),
    cert: z.string().optional().describe("Path to a PEM-encoded client certificate"),
    ca: z
      .union([
        z.string().describe("Path to a PEM-encoded certificate authority bundle"),
        z.array(z.string()).describe("Paths to PEM-encoded certificate authority bundles"),
      ])
      .optional(),
  })
  .meta({
    ref: "ProviderTLSConfig",
  })

export const Option = z
  .object({
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    tls: TLS.optional().describe("TLS client certificate settings for this provider"),
    enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
    setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
    timeout: z
      .union([
        z
          .number()
          .int()
          .positive()
          .describe(
            "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
          ),
        z.literal(false).describe("Disable timeout for this provider entirely."),
      ])
      .optional()
      .describe(
        "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
      ),
  })
  .catchall(z.any())
  .meta({
    ref: "ProviderOptions",
  })

export type Option = z.infer<typeof Option>
