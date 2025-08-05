import { Message } from "./message"

/**
 * Harmony template format parsing utilities for OpenAI gpt-oss models.
 * 
 * The Harmony format uses structured tokens like:
 * <|channel|>analysis<|message|>content<|end|>
 * <|channel|>final<|message|>response<|end|>
 */
export namespace Harmony {
  /** Represents a parsed Harmony channel block */
  export interface HarmonyBlock {
    /** The channel name (analysis, commentary, final, etc.) */
    channel: string
    /** The text content within the channel */
    content: string
    /** Whether the block is complete (ends with <|end|>) */
    isComplete: boolean
  }

  /**
   * Parses Harmony template format text into structured blocks.
   * Handles both complete and incomplete (streaming) blocks.
   * 
   * @param text - Raw text potentially containing Harmony tokens
   * @returns Array of parsed HarmonyBlock objects
   */
  export function parseHarmonyResponse(text: string): HarmonyBlock[] {
    const blocks: HarmonyBlock[] = []
    
    // Handle invalid input
    if (!text || typeof text !== 'string') {
      return blocks
    }
    
    // Prevent processing extremely large inputs that could cause performance issues
    if (text.length > 1_000_000) { // 1MB limit
      console.warn('Harmony response too large, truncating')
      text = text.substring(0, 1_000_000)
    }
    
    try {
      // Match patterns like <|channel|>name<|message|>content<|end|>
      // Using matchAll for better performance and cleaner code
      const channelRegex = /<\|channel\|>([^<|]+)<\|message\|>(.*?)(?:<\|end\|>|$)/gs
      const matches = Array.from(text.matchAll(channelRegex))
      
      for (const match of matches) {
        const [fullMatch, channel, content] = match
        
        // Validate match components
        if (channel && typeof channel === 'string') {
          const isComplete = fullMatch.endsWith('<|end|>')
          
          blocks.push({
            channel: channel.trim(),
            content: (content || "").trim(),
            isComplete,
          })
        }
      }
    } catch (error) {
      // If regex parsing fails, return empty array
      console.warn('Failed to parse Harmony response:', error)
    }
    
    return blocks
  }

  /**
   * Detects if text contains Harmony template format tokens.
   * 
   * @param text - Text to check for Harmony format
   * @returns True if text contains Harmony tokens
   */
  export function isHarmonyFormat(text: string): boolean {
    // Detect if text contains Harmony tokens (even partial)
    return /<\|channel\|>/.test(text)
  }

  /**
   * Converts parsed Harmony blocks to opencode MessagePart objects.
   * Only processes complete blocks with non-empty content.
   * 
   * @param blocks - Array of parsed HarmonyBlock objects
   * @returns Array of HarmonyChannelPart message parts
   */
  export function convertToMessageParts(
    blocks: HarmonyBlock[]
  ): Message.MessagePart[] {
    return blocks
      .filter(block => block.isComplete && block.content.length > 0)
      .map(block => {
        // Map channel names to enum values
        let channel: "analysis" | "commentary" | "final"
        switch (block.channel.toLowerCase()) {
          case "analysis":
            channel = "analysis"
            break
          case "commentary":
            channel = "commentary"
            break
          case "final":
            channel = "final"
            break
          default:
            // Default unknown channels to analysis
            channel = "analysis"
            break
        }

        return {
          type: "harmony-channel" as const,
          channel,
          text: block.content,
        } satisfies Message.HarmonyChannelPart
      })
  }

  /**
   * Extracts clean, readable text from Harmony format responses.
   * Prioritizes "final" channel content, falls back gracefully.
   * 
   * @param text - Raw text that may contain Harmony tokens
   * @returns Clean text suitable for titles, summaries, etc.
   */
  export function extractPlainText(text: string): string {
    // Handle empty or invalid input
    if (!text || typeof text !== 'string') {
      return ""
    }

    // For non-harmony responses, just return the text as-is
    if (!isHarmonyFormat(text)) {
      return text
    }

    // For harmony responses, extract and concatenate final channel content
    const blocks = parseHarmonyResponse(text)
    if (blocks.length === 0) {
      // If parsing failed, return original text as fallback
      return text
    }

    const finalBlocks = blocks.filter(block => 
      block.channel.toLowerCase() === "final" && block.isComplete
    )
    
    if (finalBlocks.length > 0) {
      return finalBlocks.map(block => block.content).join('\n\n')
    }
    
    // Fallback: return all complete block content
    const completeBlocks = blocks.filter(block => block.isComplete)
    if (completeBlocks.length > 0) {
      return completeBlocks.map(block => block.content).join('\n\n')
    }
    
    // Final fallback: return original text if no complete blocks
    return text
  }
}