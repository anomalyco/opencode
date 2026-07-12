import { TuiConfig } from "@opencode-ai/tui/config/v1"
import { isRecord } from "@opencode-ai/tui/util/record"
import { Filesystem } from "@/util/filesystem"
import { Schema } from "effect"

export function resolveHostAttentionSoundPaths(
  root: string,
  sounds: unknown,
  options?: { trim?: boolean },
): TuiConfig.AttentionSoundPaths {
  if (!isRecord(sounds)) return {}
  return Object.fromEntries(
    Object.entries(sounds).flatMap(([name, file]) => {
      if (!Schema.is(TuiConfig.AttentionSoundName)(name)) return []
      if (typeof file !== "string") return []
      const value = options?.trim ? file.trim() : file
      if (!value) return []
      return [[name, Filesystem.resolveFilePath(root, value)]]
    }),
  )
}
