import { Config } from "../config/config"
import { Log } from "../util/log"
import { Bus } from "../bus"

const log = Log.create({ service: "rlm" })

// Threshold for automatic RLM activation (100KB)
const RLM_CONTEXT_THRESHOLD = 100_000

export namespace RLM {
  export interface ContextInfo {
    isLarge: boolean
    totalLength: number
    fileCount: number
    largestFile: { name: string; size: number } | null
  }

  /**
   * Analyze input parts to determine if RLM mode should be activated
   */
  export function analyzeContext(parts: Array<{ type: string; text?: string; filename?: string }>): ContextInfo {
    let totalLength = 0
    let fileCount = 0
    let largestFile: { name: string; size: number } | null = null

    for (const part of parts) {
      if (part.type === "text" && part.text) {
        totalLength += part.text.length
      }
      if (part.type === "file" && part.filename) {
        fileCount++
      }
    }

    return {
      isLarge: totalLength > RLM_CONTEXT_THRESHOLD,
      totalLength,
      fileCount,
      largestFile,
    }
  }

  /**
   * Check if RLM is enabled in config
   */
  export async function isEnabled(): Promise<boolean> {
    const config = await Config.get()
    return config.experimental?.repl_tool === true
  }

  /**
   * Generate RLM activation message for the model
   */
  export function generateActivationPrompt(info: ContextInfo): string {
    const sizeKB = Math.round(info.totalLength / 1024)
    return `
<rlm-context-loaded>
A large context (${sizeKB}KB) has been loaded into the REPL environment.
The context is available as the \`context\` variable.

To process this context, use the \`repl\` tool with Python code:
\`\`\`python
# First, probe what you're working with
info = probe_context()
print(f"Context: {info['length']} chars, {info['lines']} lines")

# Then use smart_chunk, llm_query_parallel, etc. to analyze
\`\`\`

Use the REPL tool - do NOT try to process this context directly in your response.
</rlm-context-loaded>
`.trim()
  }

  /**
   * Emit event when RLM mode is activated
   */
  export function notifyActivation(sessionId: string, info: ContextInfo) {
    log.info("RLM mode activated", {
      sessionId,
      totalLength: info.totalLength,
      fileCount: info.fileCount,
    })

    Bus.publish("rlm.activated", {
      sessionId,
      contextSize: info.totalLength,
      fileCount: info.fileCount,
    })
  }
}
