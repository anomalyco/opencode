import { spawn } from "node:child_process"
import { readFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function startVoiceInput(): Promise<string> {
  const file = join(tmpdir(), `opencode-voice-${Date.now()}.wav`)
  try {
    await record(file)
    return await transcribe(file)
  } finally {
    await unlink(file).catch(() => {})
  }
}

function record(outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Record from default mic; stop after 2s of silence below 3% threshold.
    // Requires sox: brew install sox
    const proc = spawn("sox", [
      "-t",
      "coreaudio",
      "default",
      "-t",
      "wav",
      outputFile,
      "silence",
      "1",
      "0.5",
      "3%",
      "1",
      "2.0",
      "3%",
    ])
    proc.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`sox exited with code ${code}`))
    })
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoError).code === "ENOENT") {
        reject(new Error("sox not found — install with: brew install sox"))
      } else {
        reject(err)
      }
    })
  })
}

async function transcribe(file: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) throw new Error("XAI_API_KEY environment variable not set")

  const audioData = await readFile(file)
  const formData = new FormData()
  formData.append("file", new Blob([audioData], { type: "audio/wav" }), "voice.wav")
  formData.append("model", "whisper-1")

  const response = await fetch("https://api.x.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`STT API error ${response.status}: ${text}`)
  }

  const result = (await response.json()) as { text: string }
  return result.text.trim()
}
