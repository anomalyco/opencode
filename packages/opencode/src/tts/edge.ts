import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EdgeTTS } from "node-edge-tts"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { isRecord } from "@/util/record"

const defaults = {
  voice: "en-US-MichelleNeural",
  lang: "en-US",
  output_format: "audio-24khz-48kbitrate-mono-mp3",
  timeout_ms: 30_000,
}

export async function synth(text: string) {
  if (!text.trim()) throw new Error("Empty text")
  // Use global config — TTS settings are not per-project and the
  // /tts/edge route is mounted before the Instance middleware.
  const cfg = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  const raw = cfg as unknown
  const edge = isRecord(raw) && isRecord(raw.voice) && isRecord(raw.voice.edge) ? raw.voice.edge : undefined
  // Only disable when explicitly set to false; undefined/missing = enabled
  if (edge?.enabled === false) throw new Error("Edge TTS is disabled")

  const dir = await mkdtemp(path.join(tmpdir(), "opencode-tts-"))
  const file = path.join(dir, `voice-${Date.now()}.mp3`)
  const tts = new EdgeTTS({
    voice: typeof edge?.voice === "string" ? edge.voice : defaults.voice,
    lang: typeof edge?.lang === "string" ? edge.lang : defaults.lang,
    outputFormat: typeof edge?.output_format === "string" ? edge.output_format : defaults.output_format,
    rate: typeof edge?.rate === "string" ? edge.rate : undefined,
    pitch: typeof edge?.pitch === "string" ? edge.pitch : undefined,
    volume: typeof edge?.volume === "string" ? edge.volume : undefined,
    timeout: typeof edge?.timeout_ms === "number" ? edge.timeout_ms : defaults.timeout_ms,
  })

  return (async () => {
    await tts.ttsPromise(text, file)
    const info = await stat(file)
    if (!info.size) throw new Error("Edge TTS produced empty audio file")
    const audio = await Bun.file(file).arrayBuffer()
    return new Uint8Array(audio)
  })().finally(() => rm(dir, { recursive: true, force: true }).catch(() => {}))
}
