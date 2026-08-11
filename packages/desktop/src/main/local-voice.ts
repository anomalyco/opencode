import { availableParallelism } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { open, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { LocalVoiceModel, LocalVoicePlatform, LocalVoiceState } from "@opencode-ai/app/voice"

const MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1"
const MODEL_ROOT = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}`
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const MAX_PROCESS_OUTPUT = 1024 * 1024

const models = {
  tiny: {
    file: "ggml-tiny.bin",
    size: 77_691_713,
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  },
  base: {
    file: "ggml-base.bin",
    size: 147_951_465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  },
  small: {
    file: "ggml-small.bin",
    size: 487_601_967,
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
  },
  "large-v3-turbo-q5": {
    file: "ggml-large-v3-turbo-q5_0.bin",
    size: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
  },
} as const satisfies Record<LocalVoiceModel, { file: string; size: number; sha256: string }>

type Download = {
  abort: AbortController
  received: number
  reported: number
  promise: Promise<void>
}

export function createLocalVoice(input: {
  root: string
  runtime: string
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>
}): LocalVoicePlatform & { dispose(): void } {
  const downloads = new Map<LocalVoiceModel, Download>()
  const listeners = new Set<(state: LocalVoiceState) => void>()
  let transcription: { abort: AbortController; promise: Promise<string> } | undefined
  let emitting = false
  let pendingEmission = false
  const ready = rm(join(input.root, "tmp"), { recursive: true, force: true })
  const modelPath = (model: LocalVoiceModel) => join(input.root, "models", models[model].file)
  const exists = (path: string, size?: number) =>
    stat(path).then(
      (value) => value.isFile() && (size === undefined || value.size === size),
      () => false,
    )
  const state = async (): Promise<LocalVoiceState> => ({
    runtime: await exists(input.runtime),
    transcribing: transcription !== undefined,
    models: Object.fromEntries(
      await Promise.all(
        Object.entries(models).map(async ([id, info]) => {
          const model = id as LocalVoiceModel
          const download = downloads.get(model)
          return [
            model,
            {
              size: info.size,
              installed: await exists(modelPath(model), info.size),
              ...(download ? { download: { received: download.received, total: info.size } } : {}),
            },
          ] as const
        }),
      ),
    ) as LocalVoiceState["models"],
  })
  const emit = () => {
    if (emitting) {
      pendingEmission = true
      return
    }
    emitting = true
    void state()
      .then((next) =>
        listeners.forEach((listener) => {
          try {
            listener(next)
          } catch {
            // A renderer callback must not prevent future state delivery.
          }
        }),
      )
      .finally(() => {
        emitting = false
        if (!pendingEmission) return
        pendingEmission = false
        emit()
      })
  }

  const download = (model: LocalVoiceModel) => {
    if (!Object.hasOwn(models, model)) return Promise.reject(new Error("Unknown local transcription model"))
    const active = downloads.get(model)
    if (active) return active.promise
    const abort = new AbortController()
    const entry: Download = { abort, received: 0, reported: 0, promise: Promise.resolve() }
    entry.promise = downloadModel(model, entry)
      .catch((error) => {
        if (abort.signal.aborted) return
        throw error
      })
      .finally(() => {
        downloads.delete(model)
        emit()
      })
    downloads.set(model, entry)
    emit()
    return entry.promise
  }

  const transcribe = (request: { model: LocalVoiceModel; audio: ArrayBuffer }) => {
    if (!Object.hasOwn(models, request.model)) return Promise.reject(new Error("Unknown local transcription model"))
    if (transcription) return Promise.reject(new Error("Local transcription is already running"))
    if (!isWave(request.audio) || request.audio.byteLength > MAX_AUDIO_BYTES) {
      return Promise.reject(new Error("Invalid WAV audio"))
    }
    const abort = new AbortController()
    const operation = runTranscription(request, abort.signal).finally(() => {
      transcription = undefined
      emit()
    })
    transcription = { abort, promise: operation }
    emit()
    return operation
  }

  async function downloadModel(model: LocalVoiceModel, entry: Download) {
    const info = models[model]
    const destination = modelPath(model)
    if (await exists(destination, info.size)) return
    await mkdir(join(input.root, "models"), { recursive: true })
    const temporary = `${destination}.part`
    await rm(temporary, { force: true })
    await writeDownload(`${MODEL_ROOT}/${info.file}`, temporary, info, entry).catch(async (error) => {
      await rm(temporary, { force: true })
      throw error
    })
    try {
      entry.abort.signal.throwIfAborted()
      await rm(destination, { force: true })
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async function writeDownload(
    url: string,
    destination: string,
    expected: { size: number; sha256: string },
    entry: Download,
  ) {
    const response = await input.fetch(url, { signal: entry.abort.signal })
    if (!response.ok || !response.body) throw new Error(`Model download failed with status ${response.status}`)
    const reader = response.body.getReader()
    const file = await open(destination, "wx", 0o600)
    const hash = createHash("sha256")
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (entry.received + chunk.value.byteLength > expected.size) throw new Error("Model download exceeded size")
        await file.writeFile(chunk.value)
        hash.update(chunk.value)
        entry.received += chunk.value.byteLength
        if (entry.received - entry.reported >= Math.max(1024 * 1024, Math.floor(expected.size / 100))) {
          entry.reported = entry.received
          emit()
        }
      }
    } finally {
      reader.releaseLock()
      await file.close()
    }
    entry.abort.signal.throwIfAborted()
    if (entry.received !== expected.size) throw new Error("Model download size mismatch")
    if (hash.digest("hex") !== expected.sha256) throw new Error("Model download checksum mismatch")
  }

  async function runTranscription(request: { model: LocalVoiceModel; audio: ArrayBuffer }, signal: AbortSignal) {
    await ready
    if (!(await exists(input.runtime))) throw new Error("Local transcription runtime is unavailable")
    if (!(await exists(modelPath(request.model), models[request.model].size))) {
      throw new Error("Local transcription model is not installed")
    }
    signal.throwIfAborted()
    const directory = join(input.root, "tmp", randomUUID())
    const audio = join(directory, "audio.wav")
    const output = join(directory, "transcript")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(audio, new Uint8Array(request.audio), { mode: 0o600 })
      signal.throwIfAborted()
      return await executeWhisper(request.model, audio, output, signal)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async function executeWhisper(model: LocalVoiceModel, audio: string, output: string, signal: AbortSignal) {
    const child = spawn(
      input.runtime,
      [
        "--model",
        modelPath(model),
        "--file",
        audio,
        "--language",
        "auto",
        "--threads",
        String(Math.max(1, Math.min(8, availableParallelism() - 1))),
        "--no-timestamps",
        "--output-txt",
        "--output-file",
        output,
      ],
      { windowsHide: true },
    )
    child.stdout.resume()
    let stderr = ""
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_PROCESS_OUTPUT) stderr += data.toString().slice(0, MAX_PROCESS_OUTPUT - stderr.length)
    })
    const cancel = () => child.kill()
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject)
        child.once("exit", (code, exitSignal) => {
          if (code === 0) return resolve()
          reject(new Error(`whisper-cli exited with ${exitSignal ?? code}: ${stderr.trim()}`))
        })
      })
      signal.throwIfAborted()
      return (await readFile(`${output}.txt`, "utf8")).trim()
    } finally {
      signal.removeEventListener("abort", cancel)
    }
  }

  return {
    state,
    subscribe(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    download,
    async cancelDownload(model) {
      if (!Object.hasOwn(models, model)) return
      downloads.get(model)?.abort.abort()
    },
    async remove(model) {
      if (!Object.hasOwn(models, model)) return
      if (transcription) throw new Error("Cannot remove a model while local transcription is running")
      downloads.get(model)?.abort.abort()
      await downloads.get(model)?.promise.catch(() => undefined)
      await rm(modelPath(model), { force: true })
      emit()
    },
    transcribe,
    async cancelTranscription() {
      transcription?.abort.abort()
    },
    dispose() {
      downloads.forEach((entry) => entry.abort.abort())
      transcription?.abort.abort()
      listeners.clear()
    },
  }
}

function isWave(audio: ArrayBuffer) {
  if (audio.byteLength < 44) return false
  const header = new Uint8Array(audio, 0, 12)
  return String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8)) === "WAVE"
}
