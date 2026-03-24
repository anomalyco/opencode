import path from "path"
import os from "os"
import fs from "fs/promises"
import type { Config } from "../config/config"

export namespace VoiceCheck {
  export interface Result {
    sox: string | undefined
    whisper: string | undefined
    model: string | undefined
    errors: string[]
  }

  type VoiceCfg = NonNullable<Config.Info["voice"]>

  async function exists(p: string) {
    return fs.access(p).then(
      () => true,
      () => false,
    )
  }

  async function binary(name: string, configured?: string): Promise<string | undefined> {
    if (configured) {
      if (await exists(configured)) return configured
      return undefined
    }
    const found = Bun.which(name)
    return found ?? undefined
  }

  async function model(cfg: VoiceCfg, whisper?: string): Promise<string | undefined> {
    if (cfg.model_path) {
      if (await exists(cfg.model_path)) return cfg.model_path
      return undefined
    }

    const name = cfg.model ?? "base.en"
    const file = `ggml-${name}.bin`

    const dirs = [
      "/opt/homebrew/share/whisper-cpp",
      "/usr/local/share/whisper-cpp",
      path.join(os.homedir(), ".local/share/whisper-cpp/models"),
      path.join(os.homedir(), ".cache/whisper"),
    ]

    if (whisper) {
      const dir = path.dirname(whisper)
      dirs.push(path.join(dir, "models"))
      dirs.push(path.join(dir, "..", "share/whisper-cpp"))
    }

    for (const dir of dirs) {
      const p = path.join(dir, file)
      if (await exists(p)) return p
    }

    return undefined
  }

  function instructions() {
    if (process.platform === "darwin") {
      return {
        sox: "brew install sox",
        whisper: "brew install whisper-cpp",
      }
    }
    return {
      sox: "sudo apt install sox (or your package manager)",
      whisper: "Build from source: https://github.com/ggerganov/whisper.cpp",
    }
  }

  export async function run(cfg?: VoiceCfg): Promise<Result> {
    const resolved = cfg ?? { backend: "local" as const, model: "base.en", language: "en", max_duration: 60 }
    const errors: string[] = []
    const inst = instructions()

    const sox = await binary("rec", resolved.sox_path)
    if (!sox) {
      errors.push(`'rec' (sox) not found. Install it: ${inst.sox}`)
    }

    let whisper: string | undefined
    let mdl: string | undefined

    if (resolved.backend !== "openai") {
      whisper = await binary("whisper-cli", resolved.whisper_path)
      if (!whisper) {
        errors.push(`'whisper-cli' not found. Install it: ${inst.whisper}`)
      }

      mdl = await model(resolved, whisper)
      if (!mdl && whisper) {
        const name = resolved.model ?? "base.en"
        errors.push(
          `Whisper model '${name}' not found. Download it:\n  curl -L -o ~/.local/share/whisper-cpp/models/ggml-${name}.bin \\\n    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`,
        )
      }
    }

    return { sox, whisper, model: mdl, errors }
  }
}
