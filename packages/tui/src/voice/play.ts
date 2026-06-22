import { spawn } from "node:child_process"
import { writeFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

export async function playMp3(bytes: Uint8Array) {
  const file = join(tmpdir(), `opencode-voice-${Date.now()}.mp3`)
  await writeFile(file, bytes)
  try {
    if (process.platform === "darwin") {
      await run("afplay", [file])
      return
    }
    if (process.platform === "linux") {
      for (const command of ["mpv", "ffplay"]) {
        try {
          await run(command, ["--really-quiet", file])
          return
        } catch {
          // try next player
        }
      }
    }
    throw new Error("could not play voice audio — install afplay, mpv, or ffplay")
  } finally {
    await unlink(file).catch(() => {})
  }
}

export function voiceSidecarBaseUrl() {
  const explicit = process.env.VOICE_SIDECAR_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  const port = process.env.VOXCODE_VOICE_PORT ?? process.env.VOICE_SIDECAR_PORT ?? "8765"
  return `http://127.0.0.1:${port}`
}
