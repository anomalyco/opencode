import { checksum } from "@opencode-ai/core/util/encode"

export function fileContentCacheKey(path: string, contents: string): string {
  return `${path}:${contents.length}:${checksum(contents) ?? "0"}`
}
