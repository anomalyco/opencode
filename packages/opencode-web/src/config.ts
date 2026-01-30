import { z } from "zod"

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  // Database
  DATABASE_URL: z.string().default("postgres://opencode:opencode@localhost:5432/opencode"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT
  JWT_SECRET: z.string().min(32).default("development-secret-key-change-in-production"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // Docker
  DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  SANDBOX_IMAGE: z.string().default("opencode-sandbox:latest"),
  SANDBOX_MEMORY_LIMIT: z.coerce.number().default(2 * 1024 * 1024 * 1024), // 2GB
  SANDBOX_CPU_LIMIT: z.coerce.number().default(2), // 2 CPUs
  SANDBOX_IDLE_TIMEOUT: z.coerce.number().default(30 * 60 * 1000), // 30 minutes

  // Workspace
  WORKSPACE_BASE_PATH: z.string().default("/var/lib/opencode/workspaces"),
})

export type Config = z.infer<typeof envSchema>

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors)
    throw new Error("Invalid environment variables")
  }
  return result.data
}

export const config = loadConfig()
