import { Server } from "../../server/server"
import type { CommandModule } from "yargs"

type Args = {
  httpapi: boolean
  hono: boolean
}

export const GenerateCommand = {
  command: "generate",
  builder: (yargs) =>
    yargs
      .option("httpapi", {
        type: "boolean",
        default: false,
        description:
          "Generate OpenAPI from the Effect HttpApi contract (default; flag retained for backwards compatibility)",
      })
      .option("hono", {
        type: "boolean",
        default: false,
        description: "Generate OpenAPI from the legacy Hono backend (parity-diff only; will be removed)",
      }),
  handler: async (args) => {
    const specs = args.hono ? await Server.openapiHono() : await Server.openapi()
    for (const item of Object.values(specs.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        if (!operation?.operationId) continue
        operation["x-codeSamples"] = [
          {
            lang: "js",
            source: [
              `import { createOpencodeClient } from "@opencode-ai/sdk`,
              ``,
              `const client = createOpencodeClient()`,
              `await client.${operation.operationId}({`,
              `  ...`,
              `})`,
            ].join("\n"),
          },
        ]
      }
    }
    const raw = JSON.stringify(specs, null, 2)

    // Format through prettier so output is byte-identical to committed file
    // regardless of whether ./script/format.ts runs afterward.
    const prettier = await import("prettier")
    const babel = await import("prettier/plugins/babel")
    const estree = await import("prettier/plugins/estree")
    const format = prettier.format ?? prettier.default?.format
    const json = await format(raw, {
      parser: "json",
      plugins: [babel.default ?? babel, estree.default ?? estree],
      printWidth: 120,
    })

    // Wait for stdout to finish writing before process.exit() is called
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule<object, Args>
