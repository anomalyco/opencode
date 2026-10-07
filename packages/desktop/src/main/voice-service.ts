import { ollamaURL } from "@opencode-ai/app/ollama/types"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"
import {
  localVoiceModel,
  voiceAdapter,
  voiceCapabilities,
  voiceRequestLanguage,
  validVoiceLanguage,
  validVoiceProvider,
  type VoiceConfig,
  type VoiceLocalState,
  type VoiceProviderConfig,
  type VoiceResult,
  type VoiceSnapshot,
  type VoiceTranscription,
} from "@opencode-ai/app/voice/types"
import { transcribeVoiceEndpoint } from "@opencode-ai/app/voice/transport"

const revision = "89e96d92ba34aca20b3e29fb10cc284097d1219f"
const files = [
  "chat_template.json",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "model.safetensors",
  "model.safetensors.index.json",
  "preprocessor_config.json",
  "tokenizer_config.json",
  "vocab.json",
]

type Store = { get(key: string): unknown; set(key: string, value: unknown): void; delete(key: string): void }
export function createVoiceService(input: {
  root: string
  workerPath: string
  supported: boolean
  store: Store
  encrypt(key: string): string
  decrypt(key: string): string
  emit(state: VoiceSnapshot): void
}) {
  const saved = input.store.get("config") as VoiceConfig | undefined
  const config: VoiceConfig =
    saved && Array.isArray(saved.providers)
      ? {
          providers: saved.providers.filter(validVoiceProvider),
          selected: saved.selected,
          language: validVoiceLanguage(saved.language) ? saved.language : "auto",
        }
      : { providers: [], language: "auto" }
  const local: VoiceLocalState = { supported: input.supported, phase: "uninstalled" }
  const jobs = new Map<string, AbortController>()
  const pending = new Map<string, (value: VoiceResult<string>) => void>()
  const runtime = {
    worker: undefined as ChildProcessWithoutNullStreams | undefined,
    installing: false,
    transcribing: false,
  }
  const modelPath = join(input.root, "model")
  const venv = join(input.root, "runtime")
  const python = join(venv, "bin", "python")
  const snapshot = (): VoiceSnapshot => ({ ...structuredClone(config), local: { ...local } })
  const emit = () => input.emit(snapshot())
  const persist = () => {
    input.store.set("config", config)
    emit()
    return snapshot()
  }
  const key = (id: string) => {
    const secret = input.store.get(`secret.${id}`)
    return typeof secret === "string" ? input.decrypt(secret) : undefined
  }
  const closeWorker = () => {
    runtime.worker?.kill()
    runtime.worker = undefined
    pending.forEach((resolve) => resolve({ ok: false, error: "cancelled" }))
    pending.clear()
  }
  const run = (command: string, args: string[], signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        signal,
        stdio: "ignore",
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      })
      child.once("error", reject)
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error("runtime"))))
    })
  const initialized = (async () => {
    const complete = await readFile(join(modelPath, ".complete"), "utf8").catch(() => "")
    if (complete === revision && (await stat(python).catch(() => undefined))) local.phase = "installed"
  })()
  return {
    ollamaConnection(id: string) {
      const provider = config.providers.find((item) => item.id === id && voiceAdapter(item) === "ollama-qwen")
      if (!provider) return undefined
      const secret = key(id)
      return {
        baseURL: ollamaURL(provider.baseURL),
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      }
    },
    async read() {
      await initialized
      return snapshot()
    },
    async save(provider: VoiceProviderConfig, apiKey?: string): Promise<VoiceResult<VoiceSnapshot>> {
      if (!validVoiceProvider(provider)) return { ok: false, error: "configuration" }
      try {
        const encrypted = apiKey?.trim() ? input.encrypt(apiKey.trim()) : undefined
        if (apiKey !== undefined) {
          if (encrypted) input.store.set(`secret.${provider.id}`, encrypted)
          if (!encrypted) input.store.delete(`secret.${provider.id}`)
        }
        const next = { ...provider, hasKey: !!input.store.get(`secret.${provider.id}`) }
        config.providers = [...config.providers.filter((item) => item.id !== next.id), next]
        return { ok: true, value: persist() }
      } catch {
        return { ok: false, error: "storage" }
      }
    },
    async remove(id: string) {
      config.providers = config.providers.filter((provider) => provider.id !== id)
      input.store.delete(`secret.${id}`)
      if (config.selected?.providerID === id) config.selected = undefined
      return persist()
    },
    async configure(selected: VoiceConfig["selected"], language: VoiceConfig["language"]) {
      await initialized
      const available =
        selected?.providerID === localVoiceModel.providerID
          ? input.supported &&
            selected.modelID === localVoiceModel.modelID &&
            ["installed", "ready"].includes(local.phase)
          : config.providers.some(
              (provider) =>
                provider.id === selected?.providerID &&
                provider.models.some((model) => model.id === selected?.modelID && model.visible),
            )
      config.selected = available ? selected : undefined
      config.language = validVoiceLanguage(language) ? language : "auto"
      return persist()
    },
    async test(id: string): Promise<VoiceResult<void>> {
      const provider = config.providers.find((item) => item.id === id)
      if (!provider) return { ok: false, error: "configuration" }
      try {
        const secret = key(id)
        const response = await fetch(
          voiceAdapter(provider) === "ollama-qwen"
            ? `${ollamaURL(provider.baseURL)}/api/tags`
            : `${provider.baseURL.replace(/\/+$/, "")}/models`,
          {
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: secret ? { Authorization: `Bearer ${secret}` } : {},
          },
        )
        if ([401, 403].includes(response.status)) return { ok: false, error: "authentication" }
        return response.ok ? { ok: true, value: undefined } : { ok: false, error: "response" }
      } catch {
        return { ok: false, error: "network" }
      }
    },
    async install(owner: string): Promise<VoiceResult<void>> {
      await initialized
      if (!input.supported) return { ok: false, error: "unsupported" }
      if (runtime.installing || runtime.transcribing) return { ok: false, error: "busy" }
      runtime.installing = true
      const controller = new AbortController()
      jobs.set(owner, controller)
      local.phase = "installing"
      local.error = undefined
      local.progress = undefined
      emit()
      try {
        await mkdir(input.root, { recursive: true, mode: 0o700 })
        if (!(await stat(python).catch(() => undefined))) {
          const commands = [
            process.env.OPENCODE_VOICE_PYTHON,
            "/opt/homebrew/bin/python3.11",
            "/opt/homebrew/bin/python3",
            "python3",
          ].filter((value): value is string => !!value)
          const results = await Promise.all(
            commands.map(async (command) => ({
              command,
              usable: await run(
                command,
                ["-c", "import sys; assert sys.version_info >= (3,10) and sys.version_info < (3,14)"],
                controller.signal,
              ).then(
                () => true,
                () => false,
              ),
            })),
          )
          const command = results.find((result) => result.usable)?.command
          if (!command) throw new Error("runtime")
          await run(command, ["-m", "venv", venv], controller.signal)
        }
        await run(python, ["-m", "pip", "install", "mlx-audio==0.5.7"], controller.signal)
        local.phase = "downloading"
        local.progress = 0
        emit()
        await mkdir(modelPath, { recursive: true, mode: 0o700 })
        for (const [index, file] of files.entries()) {
          const target = join(modelPath, file)
          const response = await fetch(
            `https://huggingface.co/${localVoiceModel.modelID}/resolve/${revision}/${file}`,
            { signal: controller.signal },
          )
          if (!response.ok || !response.body) throw new Error("runtime")
          const total = Number(response.headers.get("content-length"))
          const handle = await open(`${target}.partial`, "w", 0o600)
          let received = 0
          try {
            for await (const chunk of response.body) {
              await handle.write(chunk)
              received += chunk.byteLength
              local.progress = Math.min(
                99,
                Math.round(((index + (total > 0 ? received / total : 0)) / files.length) * 100),
              )
              emit()
            }
          } finally {
            await handle.close()
          }
          await rename(`${target}.partial`, target)
          local.progress = Math.round(((index + 1) / files.length) * 100)
          emit()
        }
        await writeFile(join(modelPath, ".complete"), revision, { mode: 0o600 })
        local.phase = "installed"
        local.progress = undefined
        emit()
        return { ok: true, value: undefined }
      } catch {
        local.phase = controller.signal.aborted ? "uninstalled" : "error"
        local.error = controller.signal.aborted ? undefined : "runtime"
        local.progress = undefined
        emit()
        return { ok: false, error: controller.signal.aborted ? "cancelled" : "runtime" }
      } finally {
        jobs.delete(owner)
        runtime.installing = false
      }
    },
    async deleteModel(): Promise<VoiceResult<void>> {
      if (runtime.installing || runtime.transcribing) return { ok: false, error: "busy" }
      closeWorker()
      await rm(modelPath, { recursive: true, force: true })
      local.phase = "uninstalled"
      local.error = undefined
      if (config.selected?.providerID === localVoiceModel.providerID) config.selected = undefined
      persist()
      return { ok: true, value: undefined }
    },
    async transcribe(request: VoiceTranscription, owner: string): Promise<VoiceResult<string>> {
      await initialized
      if (
        !(request.audio instanceof ArrayBuffer) ||
        !request.audio.byteLength ||
        request.audio.byteLength > 25 * 1024 * 1024
      )
        return { ok: false, error: "audio" }
      const job = `${owner}:${request.id}`
      if (jobs.has(job)) return { ok: false, error: "busy" }
      const controller = new AbortController()
      jobs.set(job, controller)
      const timeout = setTimeout(
        () => controller.abort(),
        voiceCapabilities(
          config.providers.find((provider) => provider.id === request.selection.providerID),
          request.selection.modelID,
        ).timeout,
      )
      try {
        if (request.selection.providerID !== localVoiceModel.providerID) {
          const provider = config.providers.find((item) => item.id === request.selection.providerID)
          if (!provider?.models.some((model) => model.id === request.selection.modelID && model.visible))
            return { ok: false, error: "configuration" }
          return await transcribeVoiceEndpoint({
            provider,
            modelID: request.selection.modelID,
            audio: request.audio,
            language: request.language,
            apiKey: key(provider.id),
            signal: controller.signal,
          })
        }
        if (!input.supported) return { ok: false, error: "unsupported" }
        if (runtime.transcribing || runtime.installing) return { ok: false, error: "busy" }
        if (request.selection.modelID !== localVoiceModel.modelID || !["installed", "ready"].includes(local.phase))
          return { ok: false, error: "configuration" }
        runtime.transcribing = true
        const path = join(input.root, `recording-${crypto.randomUUID()}.wav`)
        try {
          await writeFile(path, new Uint8Array(request.audio), { mode: 0o600 })
          if (controller.signal.aborted) return { ok: false, error: "cancelled" }
          if (!runtime.worker) {
            local.phase = "loading"
            emit()
            const worker = spawn(python, ["-u", input.workerPath, modelPath], { stdio: "pipe" })
            runtime.worker = worker
            worker.stderr.resume()
            createInterface({ input: worker.stdout }).on("line", (line) => {
              try {
                const result = JSON.parse(line) as VoiceResult<string> & { id: string }
                const resolve = pending.get(result.id)
                if (!resolve) return
                pending.delete(result.id)
                local.phase = result.ok ? "ready" : "installed"
                emit()
                resolve(result)
              } catch {
                /* Ignore library logs; only protocol records have matching IDs. */
              }
            })
            const failed = () => {
              if (runtime.worker !== worker) return
              runtime.worker = undefined
              local.phase = "installed"
              emit()
              pending.forEach((resolve) => resolve({ ok: false, error: "runtime" }))
              pending.clear()
            }
            worker.on("error", failed)
            worker.on("exit", failed)
          }
          const worker = runtime.worker
          return await new Promise<VoiceResult<string>>((resolve) => {
            pending.set(job, resolve)
            controller.signal.addEventListener("abort", closeWorker, { once: true })
            worker.stdin.write(
              `${JSON.stringify({ id: job, path, language: voiceRequestLanguage(voiceCapabilities(), request.language) })}\n`,
            )
          })
        } finally {
          runtime.transcribing = false
          if (local.phase === "loading") {
            local.phase = "installed"
            emit()
          }
          await rm(path, { force: true })
        }
      } catch {
        return { ok: false, error: controller.signal.aborted ? "cancelled" : "runtime" }
      } finally {
        clearTimeout(timeout)
        jobs.delete(job)
      }
    },
    cancel(owner: string, id: string) {
      jobs.get(id === "install" ? owner : `${owner}:${id}`)?.abort()
    },
    close() {
      jobs.forEach((controller) => controller.abort())
      closeWorker()
    },
  }
}
