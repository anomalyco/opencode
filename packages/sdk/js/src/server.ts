import { spawn } from "node:child_process"

export type ServerConfig = {
  hostname?: string
  port?: number
  signal?: AbortSignal
  timeout?: number
}

export async function createOpencodeServer(config?: ServerConfig) {
  config = Object.assign(
    {
      hostname: "127.0.0.1",
      port: 4096,
      timeout: 5000,
    },
    config ?? {},
  )

  const proc = spawn(`opencode`, [`serve`, `--hostname=${config.hostname}`, `--port=${config.port}`], {
    signal: config.signal,
  })

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after ${config.timeout}ms`))
    }, config.timeout)
    let output = ""
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      const lines = output.split("\n")
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            throw new Error(`Failed to parse server url from output: ${line}`)
          }
          clearTimeout(id)
          resolve(match[1])
          return
        }
      }
    })
    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
    })
    proc.on("exit", (code) => {
      clearTimeout(id)
      let msg = `Server exited with code ${code}`
      if (output.trim()) {
        msg += `\nServer output: ${output}`
      }
      reject(new Error(msg))
    })
    proc.on("error", (error) => {
      clearTimeout(id)
      reject(error)
    })
    if (config.signal) {
      config.signal.addEventListener("abort", () => {
        clearTimeout(id)
        reject(new Error("Aborted"))
      })
    }
  })

  return {
    url,
    close() {
      proc.kill()
    },
  }
}
