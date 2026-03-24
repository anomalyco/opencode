import type { Config } from "../config/config"
import { VoiceCheck } from "./check"
import { Recorder } from "./recorder"
import { Transcribe } from "./transcribe"

export { VoiceCheck } from "./check"

export namespace Voice {
  type Cfg = NonNullable<Config.Info["voice"]>

  export type CheckResult = VoiceCheck.Result
  export type RecordHandle = Recorder.Handle

  export async function check(cfg?: Cfg) {
    return VoiceCheck.run(cfg)
  }

  export function record(cfg?: Cfg) {
    const resolved = cfg ?? { backend: "local" as const, model: "base.en", language: "en", max_duration: 60 }
    return Recorder.start({
      sox: resolved.sox_path ?? "rec",
      max: resolved.max_duration ?? 60,
    })
  }

  export async function transcribe(file: string, deps: VoiceCheck.Result, cfg?: Cfg) {
    const resolved = cfg ?? { backend: "local" as const, model: "base.en", language: "en", max_duration: 60 }

    if (resolved.backend === "openai") {
      const key = resolved.openai_api_key ?? process.env.OPENAI_API_KEY
      if (!key) throw new Error("OpenAI API key not configured. Set voice.openai_api_key or OPENAI_API_KEY env var")
      const result = await Transcribe.openai({
        file,
        key,
        language: resolved.language,
      })
      return result.text
    }

    if (!deps.whisper) throw new Error("whisper-cli not found")
    if (!deps.model) throw new Error("Whisper model not found")

    const result = await Transcribe.local({
      whisper: deps.whisper,
      model: deps.model,
      file,
      language: resolved.language,
    })
    return result.text
  }
}
