import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

const bin = () => process.env.PENNYLANE_CLI_BIN || "pennylane"

function isPennylaneConfigured(plugins: string[]): boolean {
  return plugins.some((p) => {
    const name = Config.getPluginName(p)
    return name === "pennylane" || p.toLowerCase().includes("pennylane")
  })
}

async function checkPennylaneHealth(): Promise<{ healthy: boolean; error?: string }> {
  const proc = Bun.spawn([bin(), "health"], {
    cwd: Instance.worktree || Instance.directory,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited

  if (code !== 0) {
    let message = err.trim()
    try {
      const parsed = JSON.parse(err)
      if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
        message = parsed.message
      }
    } catch {
      // use raw stderr
    }
    return { healthy: false, error: message || `pennylane health failed with exit code ${code}` }
  }

  return { healthy: true }
}

const PennylaneHealthSchema = z.object({
  healthy: z.boolean(),
  error: z.string().optional(),
})

export const PluginRoutes = lazy(() =>
  new Hono()
    .get(
      "/pennylane/health",
      describeRoute({
        summary: "Get Pennylane health",
        description: "Check Pennylane API/CLI connection status. Returns healthy only when the Pennylane plugin is configured and the health check succeeds.",
        operationId: "plugin.pennylane.health",
        responses: {
          200: {
            description: "Pennylane health status",
            content: {
              "application/json": {
                schema: resolver(PennylaneHealthSchema),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        if (!isPennylaneConfigured(plugins)) {
          return c.json({ healthy: false, error: "not configured" })
        }

        try {
          const result = await checkPennylaneHealth()
          return c.json(result)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ healthy: false, error: message })
        }
      },
    ),
)
