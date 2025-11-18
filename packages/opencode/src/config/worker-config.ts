import z from "zod"

export namespace WorkerConfig {
  export const BackgroundValidation = z
    .object({
      enabled: z.boolean().default(true).describe("Enable background validation on file changes"),
      commands: z
        .array(z.string())
        .default(["bun run lint", "bun run typecheck", "bun run codereview"])
        .describe("Commands to run for validation"),
      debounceMs: z.number().default(2000).describe("Debounce delay in milliseconds"),
      include: z
        .array(z.string())
        .default(["**/*.{ts,tsx,js,jsx}", "**/package.json", "**/tsconfig*.json"])
        .describe("File patterns to include for validation"),
      exclude: z
        .array(z.string())
        .default(["**/node_modules/**", "**/dist/**", "**/*.d.ts"])
        .describe("File patterns to exclude from validation"),
    })
    .meta({ ref: "BackgroundValidationConfig" })

  export const PrefetchWorker = z
    .object({
      enabled: z.boolean().default(false).describe("Enable file prefetch based on context patterns"),
      maxConcurrent: z.number().default(3).describe("Maximum concurrent prefetch operations"),
      maxCacheSize: z
        .number()
        .default(100 * 1024 * 1024)
        .describe("Maximum cache size in bytes (100MB default)"),
      strategies: z
        .array(z.enum(["import", "test", "component", "related"]))
        .default(["import", "related"])
        .describe("Prefetch strategies to use"),
    })
    .meta({ ref: "PrefetchWorkerConfig" })

  export type BackgroundValidationInfo = z.infer<typeof BackgroundValidation>
  export type PrefetchWorkerInfo = z.infer<typeof PrefetchWorker>
}
