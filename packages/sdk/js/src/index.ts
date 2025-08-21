import { createClient } from "./gen/client/client.js"
import { type Config } from "./gen/client/types.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export * from "./gen/types.gen.js"
import { spawn } from "child_process"

export function createOpencodeClient(config?: Config) {
  const client = createClient(config)
  return new OpencodeClient({ client })
}

export type ServerConfig = {
  host?: string
  port?: number
}

export async function createOpencodeServer(config?: ServerConfig) {
  config = Object.assign(
    {
      host: "127.0.0.1",
      port: 4096,
    },
    config ?? {},
  )

  const proc = spawn(`opencode`, [`serve`, `--host=${config.host}`, `--port=${config.port}`])
  const url = `http://${config.host}:${config.port}`

  return {
    url,
    close() {
      proc.kill()
    },
  }
}
