import { VoiceCheck } from "./check"
import { Recorder } from "./recorder"
import { Transcribe } from "./transcribe"

export { VoiceCheck } from "./check"

export namespace Voice {
  export type CheckResult = VoiceCheck.Result
  export type RecordHandle = Recorder.Handle

  export async function check(cfg?: VoiceCheck.Cfg) {
    return VoiceCheck.run(cfg)
  }

  export function record(cfg?: VoiceCheck.Cfg) {
    return Recorder.start({
      sox: cfg?.sox_path ?? "rec",
      max: cfg?.max_duration ?? 60,
    })
  }

  export async function transcribe(file: string, deps: VoiceCheck.Result, cfg?: VoiceCheck.Cfg) {
    if (cfg?.backend === "openai") {
      const key = cfg.openai_api_key ?? process.env.OPENAI_API_KEY
      if (!key) throw new Error("OpenAI API key not configured. Set voice.openai_api_key or OPENAI_API_KEY env var")
      const result = await Transcribe.openai({
        file,
        key,
        language: cfg.language,
      })
      return result.text
    }

    if (!deps.whisper) throw new Error("whisper-cli not found")
    if (!deps.model) throw new Error("Whisper model not found")

    const result = await Transcribe.local({
      whisper: deps.whisper,
      model: deps.model,
      file,
      language: cfg?.language,
    })
    return result.text
  }
}
