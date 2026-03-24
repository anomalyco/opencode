import { spawn } from "child_process"
import fs from "fs/promises"

export namespace Transcribe {
  export interface Result {
    text: string
  }

  export async function local(opts: {
    whisper: string
    model: string
    file: string
    language?: string
  }): Promise<Result> {
    const args = ["-m", opts.model, "-f", opts.file, "-nt", "-np"]
    if (opts.language) args.push("-l", opts.language)

    const text = await new Promise<string>((resolve, reject) => {
      let stdout = ""
      let stderr = ""

      const proc = spawn(opts.whisper, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.once("exit", (code) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(`whisper-cli exited with code ${code}: ${stderr.trim()}`))
      })
      proc.once("error", reject)
    })

    // Clean up the wav file after transcription
    await fs.unlink(opts.file).catch(() => {})

    return { text }
  }

  export async function openai(opts: {
    file: string
    key: string
    language?: string
  }): Promise<Result> {
    const data = await fs.readFile(opts.file)
    const blob = new Blob([new Uint8Array(data)], { type: "audio/wav" })

    const form = new FormData()
    form.append("file", blob, "recording.wav")
    form.append("model", "whisper-1")
    form.append("response_format", "text")
    if (opts.language) form.append("language", opts.language)

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.key}`,
      },
      body: form,
    })

    // Clean up the wav file after transcription
    await fs.unlink(opts.file).catch(() => {})

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`OpenAI Whisper API error (${res.status}): ${body}`)
    }

    const text = await res.text()
    return { text: text.trim() }
  }
}
