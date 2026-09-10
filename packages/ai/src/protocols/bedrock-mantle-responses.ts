import { Effect } from "effect"
import { Protocol } from "../route/protocol.js"
import { OpenAIResponses } from "./openai-responses.js"
import { ProviderShared } from "./shared.js"

export const protocol = Protocol.make({
  ...OpenAIResponses.protocol,
  body: {
    ...OpenAIResponses.protocol.body,
    from: Effect.fn("BedrockMantleResponses.fromRequest")(function* (request) {
      const body = yield* OpenAIResponses.protocol.body.from(request)
      if (request.model.id.includes("gpt-oss-20") || request.model.id.includes("gpt-oss-120")) {
        // Send earlier assistant replies as content: "OK". These models reject
        // content: [{ type: "output_text", text: "OK" }].
        return {
          ...body,
          // GPT-OSS only accepts automatic tool selection. Disable tools by
          // omitting their definitions rather than sending tool_choice: "none".
          ...(body.tool_choice === "none" ? { tools: undefined, tool_choice: undefined } : {}),
          input: body.input.map((item) =>
            "type" in item && item.type === "message" && item.role === "assistant" && typeof item.content !== "string"
              ? { ...item, content: ProviderShared.joinText(item.content) }
              : item,
          ),
        }
      }
      return body
    }),
  },
})

export * as BedrockMantleResponses from "./bedrock-mantle-responses.js"
