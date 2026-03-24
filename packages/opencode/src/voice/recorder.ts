import { spawn, type ChildProcess } from "child_process"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { Shell } from "../shell/shell"
import { pcmToWav } from "./wav"

const RATE = 16000
const CHANNELS = 1
const BITS = 16
const BYTES_PER_SEC = RATE * CHANNELS * (BITS / 8)
const CHUNK_SECS = 5
const CHUNK_BYTES = BYTES_PER_SEC * CHUNK_SECS

export namespace Recorder {
  export interface Handle {
    stop(): Promise<string>
    abort(): void
  }

  interface Pending {
    seq: number
    file: string
    promise: Promise<string>
  }

  export function start(opts: {
    sox: string
    max: number
    whisper: string
    model: string
    language?: string
    onChunk?: (seq: number, text: string) => void
  }): Handle {
    const prefix = path.join(os.tmpdir(), `opencode-voice-${Date.now()}`)
    let recExited = false
    let seq = 0
    let buf = Buffer.alloc(0)
    const pending: Pending[] = []
    const whisperProcs: ChildProcess[] = []
    let aborted = false

    const rec = spawn(opts.sox, [
      "-q", "-t", "raw", "-r", String(RATE), "-e", "signed-integer",
      "-b", String(BITS), "-c", String(CHANNELS), "-",
    ], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: process.platform !== "win32",
    })

    rec.once("exit", () => { recExited = true })
    rec.once("error", () => { recExited = true })

    const timer = setTimeout(() => {
      if (!recExited) Shell.killTree(rec, { exited: () => recExited })
    }, opts.max * 1000)

    rec.stdout?.on("data", (chunk: Buffer) => {
      if (aborted) return
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= CHUNK_BYTES) {
        const pcm = buf.subarray(0, CHUNK_BYTES)
        buf = buf.subarray(CHUNK_BYTES)
        enqueue(pcm)
      }
    })

    function enqueue(pcm: Buffer) {
      const n = seq++
      const file = `${prefix}-${n}.wav`
      const wav = pcmToWav(pcm, RATE, CHANNELS, BITS)

      const promise = (async () => {
        await fs.writeFile(file, wav)
        const text = await transcribe(file)
        await fs.unlink(file).catch(() => {})
        if (!aborted && opts.onChunk) opts.onChunk(n, text)
        return text
      })()

      pending.push({ seq: n, file, promise })
    }

    function transcribe(file: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const args = ["-m", opts.model, "-f", file, "-nt", "-np"]
        if (opts.language) args.push("-l", opts.language)

        let stdout = ""
        let stderr = ""
        const proc = spawn(opts.whisper, args, {
          stdio: ["ignore", "pipe", "pipe"],
        })
        whisperProcs.push(proc)

        proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
        proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
        proc.once("exit", (code) => {
          const idx = whisperProcs.indexOf(proc)
          if (idx >= 0) whisperProcs.splice(idx, 1)
          if (code === 0) resolve(stdout.trim())
          else reject(new Error(`whisper-cli exited ${code}: ${stderr.trim()}`))
        })
        proc.once("error", (err) => {
          const idx = whisperProcs.indexOf(proc)
          if (idx >= 0) whisperProcs.splice(idx, 1)
          reject(err)
        })
      })
    }

    function cleanup() {
      clearTimeout(timer)
      for (const p of pending) fs.unlink(p.file).catch(() => {})
    }

    return {
      async stop() {
        if (!recExited) await Shell.killTree(rec, { exited: () => recExited })

        // Process remaining buffered audio as final chunk
        if (buf.length > 0) {
          enqueue(buf)
          buf = Buffer.alloc(0)
        }

        // Wait for all chunks to finish
        const results = await Promise.all(
          pending.map((p) => p.promise.catch(() => "")),
        )
        cleanup()
        return results.join(" ").trim()
      },

      abort() {
        aborted = true
        if (!recExited) void Shell.killTree(rec, { exited: () => recExited })
        for (const p of whisperProcs) {
          try { p.kill("SIGTERM") } catch {}
        }
        cleanup()
      },
    }
  }
}
