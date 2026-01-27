import type { ModelMessage } from "ai"
import { TOON } from "@/format/toon"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { TOONMetadata } from "./toon-metadata"

export namespace TOONTransform {
  const log = Log.create({ service: "toon.transform" })

  export interface TransformResult {
    messages: ModelMessage[]
    savings: {
      tokensSaved: number
      originalTokens: number
      transformedTokens: number
      savingsPercentage: number
      textSavings: {
        tokensSaved: number
        savingsPercentage: number
      }
      dataSavings: {
        tokensSaved: number
        savingsPercentage: number
      }
    }
  }

  /**
   * Transform ModelMessages to use TOON format for text content
   */
  export async function transform(messages: ModelMessage[], sessionID?: string): Promise<TransformResult> {
    const config = await Config.get()
    const toonConfig = config.experimental?.toon_format

    // TOON disabled or not configured
    if (!toonConfig?.enabled) {
      return {
        messages,
        savings: {
          tokensSaved: 0,
          originalTokens: 0,
          transformedTokens: 0,
          savingsPercentage: 0,
          textSavings: {
            tokensSaved: 0,
            savingsPercentage: 0,
          },
          dataSavings: {
            tokensSaved: 0,
            savingsPercentage: 0,
          },
        },
      }
    }

    const options: TOON.Options = {
      mode: toonConfig.mode ?? "balanced",
      preserveCode: toonConfig.preserve_code ?? true,
    }

    log.info("toon.transform.start", {
      messageCount: messages.length,
      mode: options.mode,
    })

    let totalOriginalChars = 0
    let totalTransformedChars = 0
    let totalSavings = 0
    let textSavings = 0
    let dataSavings = 0

    const transformed = messages.map((msg) => {
      // Only transform user and assistant messages
      if (msg.role !== "user" && msg.role !== "assistant") {
        return msg
      }

      // Handle string content
      if (typeof msg.content === "string") {
        const original = msg.content
        const toonified = TOON.serialize(original, options)

        totalOriginalChars += original.length
        totalTransformedChars += toonified.length
        totalSavings += TOON.estimateSavings(original, toonified)

        return {
          ...msg,
          content: toonified,
        }
      }

      // Handle array content (multi-part messages)
      if (Array.isArray(msg.content)) {
        const transformedParts = msg.content.map((part) => {
          if (part.type === "text") {
            const original = part.text
            const toonified = TOON.serialize(original, options)

            totalOriginalChars += original.length
            totalTransformedChars += toonified.length
            const savings = TOON.estimateSavings(original, toonified)
            totalSavings += savings
            textSavings += savings

            return {
              ...part,
              text: toonified,
            }
          }

          // Preserve non-text parts (images, tool calls, etc.)
          return part
        })

        return {
          ...msg,
          content: transformedParts,
        }
      }

      return msg
    }) as ModelMessage[]

    const originalTokens = Math.ceil(totalOriginalChars / 4)
    const transformedTokens = Math.ceil(totalTransformedChars / 4)
    const savingsPercentage = originalTokens > 0 ? (totalSavings / originalTokens) * 100 : 0

    const savingsData = {
      tokensSaved: totalSavings,
      originalTokens,
      transformedTokens,
      savingsPercentage,
      textSavings: {
        tokensSaved: textSavings,
        savingsPercentage: originalTokens > 0 ? (textSavings / originalTokens) * 100 : 0,
      },
      dataSavings: {
        tokensSaved: dataSavings,
        savingsPercentage: originalTokens > 0 ? (dataSavings / originalTokens) * 100 : 0,
      },
    }

    log.info("toon.transform.complete", {
      estimatedTokensSaved: totalSavings,
      savingsPercentage: savingsPercentage.toFixed(2) + "%",
      textSavings: textSavings,
      dataSavings: dataSavings,
    })

    // Record savings if sessionID provided
    if (sessionID) {
      TOONMetadata.recordSavings(sessionID, {
        ...savingsData,
        mode: options.mode,
      })
    }

    return {
      messages: transformed,
      savings: savingsData,
    }
  }
}
