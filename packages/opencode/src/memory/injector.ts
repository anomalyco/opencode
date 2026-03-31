import { Log } from "../util/log"
import { MemoryFile } from "./memory-file"

const log = Log.create({ service: "memory.injector" })

export namespace MemoryInjector {
  export async function inject(projectDir: string, maxLines: number): Promise<string[]> {
    try {
      const content = await MemoryFile.readMemoryFile(projectDir)
      if (!content) return []

      const lines = content.split("\n")
      if (lines.length > maxLines) {
        const trimmed = lines.slice(0, maxLines).join("\n")
        log.debug("memory file trimmed", { original: lines.length, max: maxLines })
        return [`Memory from previous sessions:\n${trimmed}`]
      }

      return [`Memory from previous sessions:\n${content}`]
    } catch (err) {
      log.warn("failed to inject memory", { error: String(err) })
      return []
    }
  }
}
