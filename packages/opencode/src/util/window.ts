import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"
import { Token } from "./token"
import { SessionPrompt } from "../session/prompt"

export namespace SlidingWindow {
    // Reserve tokens for output and safety buffer
    const SAFETY_BUFFER = 1000

    export function apply(input: {
        messages: MessageV2.WithParts[]
        model: Provider.Model
    }): MessageV2.WithParts[] {
        const { messages, model } = input

        const contextLimit = model.limit.context
        const outputLimit = Math.min(model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) || SessionPrompt.OUTPUT_TOKEN_MAX
        const available = contextLimit - outputLimit - SAFETY_BUFFER

        // 1. Calculate tokens for all messages
        // We map generic tokens to messages. 
        // Ideally we usage existing token counts if available, or estimate.
        const sized = messages.map((msg) => {
            const info = msg.info as any
            return {
                msg,
                tokens: (info.tokens?.input ?? estimate(msg)) as number
            }
        })

        const total = sized.reduce((acc, item) => acc + item.tokens, 0)
        console.log(`[Smart Context] Checking context window. Total tokens: ${total}, Available: ${available}`)

        if (total <= available) {
            return messages
        }

        // 2. Sliding Window Strategy
        // Keep first message (often sets specific context for the session if not system)
        // Keep last N messages that fit.

        // Always keep the *last* message (user query)
        let budget = available
        const result: MessageV2.WithParts[] = []

        // Add last message
        const last = sized[sized.length - 1]
        result.unshift(last.msg)
        budget -= last.tokens

        // Iterate backwards from second-to-last
        for (let i = sized.length - 2; i >= 0; i--) {
            const item = sized[i]
            if (budget - item.tokens >= 0) {
                result.unshift(item.msg)
                budget -= item.tokens
            } else {
                // If we run out of budget, check if we should keep the VERY FIRST message?
                // Often the first message is the "User: Create a project..." which sets the theme.
                // If i === 0, we might want to swap it?
                // For now, simple truncation from the middle/top.
                break
            }
        }

        // Ensure strict chronological order (we unshifted, so they are in order)
        // If we skipped messages, we might want to insert a "System: ... messages skipped ..." placeholder?
        // But `MessageV2` structure is strict.

        // If we dropped messages, usually it's better to verify we kept the *first* message if possible.
        // But simple sliding window (recent-focused) is the standard request.

        return result
    }

    function estimate(msg: MessageV2.WithParts): number {
        // Rough estimate
        let text = ""
        for (const part of msg.parts) {
            if (part.type === "text") text += part.text
            if (part.type === "tool") {
                text += JSON.stringify(part.state.input)
                if (part.state.status === "completed") {
                    text += JSON.stringify(part.state.output)
                }
            }
        }
        return Token.estimate(text)
    }
}
