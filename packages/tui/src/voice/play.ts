import { spawn, type ChildProcess } from "node:child_process"
import { writeFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { voiceLogStage } from "./log"

let player: ChildProcess | undefined

export function stopMp3() {
  if (!player) return
  voiceLogStage("PLAY", "stop player")
  player.kill("SIGKILL")
  player = undefined
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    stopMp3()
    voiceLogStage("PLAY", `spawn ${command} ${args.join(" ")}`)
    const child = spawn(command, args, { stdio: "ignore" })
    player = child
    child.on("error", (error) => {
      if (player === child) player = undefined
      voiceLogStage("PLAY", `spawn error ${error.message}`)
      reject(error)
    })
    child.on("exit", (code, signal) => {
      if (player === child) player = undefined
      if (code === 0 || code === null || signal === "SIGTERM" || signal === "SIGKILL") {
        voiceLogStage("PLAY", `${command} exit ok`)
        resolve()
        return
      }
      voiceLogStage("PLAY", `${command} exit code=${code}`)
      reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

export async function playMp3(bytes: Uint8Array) {
  const file = join(tmpdir(), `opencode-voice-${Date.now()}.mp3`)
  voiceLogStage("PLAY", `write ${bytes.length} bytes → ${file}`)
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
        } catch (error) {
          voiceLogStage("PLAY", `${command} failed ${error instanceof Error ? error.message : error}`)
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
