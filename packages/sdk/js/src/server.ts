import { spawn } from "node:child_process"

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
