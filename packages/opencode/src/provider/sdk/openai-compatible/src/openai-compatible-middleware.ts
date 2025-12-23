import type { LanguageModelV2 } from "@ai-sdk/provider"
import { wrapLanguageModel } from "ai"

/**
 * Wraps a fetch function to filter out empty tool_calls arrays from API responses.
 * 
 * LM Studio (and some other OpenAI-compatible providers) always include
 * `tool_calls: []` in responses, even when no tools are called. This causes
 * the AI SDK to wait indefinitely for tool execution. This function intercepts
 * the fetch responses and removes empty tool_calls arrays when finish_reason is "stop".
 */
export function createFilteredFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init)
    
    // Only process JSON responses from chat completions endpoints
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (!url.includes("/chat/completions")) {
      return response
    }
    
    const contentType = response.headers.get("content-type")
    
    // For streaming responses (text/event-stream), process the SSE stream
    if (contentType && contentType.includes("text/event-stream")) {
      const originalStream = response.body
      if (!originalStream) {
        return response
      }
        
        const stream = new ReadableStream({
          async start(controller) {
            const reader = originalStream.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                
                buffer += decoder.decode(value, { stream: true })
                const chunks = buffer.split("\n\n")
                buffer = chunks.pop() || ""
                
                for (const chunk of chunks) {
                  if (chunk.startsWith("data: ")) {
                    const data = chunk.slice(6).trim()
                    if (data === "[DONE]") {
                      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
                      continue
                    }
                    
                    try {
                      const json = JSON.parse(data)
                      let modified = false
                      
                      // Process choices in the stream chunk
                      if (json.choices && Array.isArray(json.choices)) {
                        const modifiedChoices = json.choices.map((choice: any) => {
                          // Check delta for empty tool_calls
                          if (
                            choice.delta &&
                            Array.isArray(choice.delta.tool_calls) &&
                            choice.delta.tool_calls.length === 0
                          ) {
                            modified = true
                            const { tool_calls, ...rest } = choice.delta
                            return {
                              ...choice,
                              delta: rest,
                            }
                          }
                          
                          // Check message for empty tool_calls with stop finish_reason
                          if (
                            choice.message &&
                            Array.isArray(choice.message.tool_calls) &&
                            choice.message.tool_calls.length === 0 &&
                            choice.finish_reason === "stop"
                          ) {
                            modified = true
                            const { tool_calls, ...rest } = choice.message
                            return {
                              ...choice,
                              message: rest,
                            }
                          }
                          
                          return choice
                        })
                        
                        if (modified) {
                          json.choices = modifiedChoices
                          controller.enqueue(
                            new TextEncoder().encode(`data: ${JSON.stringify(json)}\n\n`)
                          )
                          continue
                        }
                      }
                      
                      // No modification needed, pass through
                      controller.enqueue(new TextEncoder().encode(`${chunk}\n\n`))
                    } catch {
                      // Not JSON or parse error, pass through
                      controller.enqueue(new TextEncoder().encode(`${chunk}\n\n`))
                    }
                  } else if (chunk.trim()) {
                    // Not a data line but has content, pass through
                    controller.enqueue(new TextEncoder().encode(`${chunk}\n\n`))
                  }
                }
              }
              
              // Flush remaining buffer
              if (buffer.trim()) {
                controller.enqueue(new TextEncoder().encode(buffer))
              }
              
              controller.close()
            } catch (error) {
              controller.error(error)
            }
          },
        })
        
        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
      
      // For non-streaming JSON responses
      if (contentType && contentType.includes("application/json")) {
        // Clone the response so we can read the body
        const clonedResponse = response.clone()
        
        try {
          const text = await clonedResponse.text()
          let json: any
          
          try {
            json = JSON.parse(text)
          } catch {
            // Not JSON, return original response
            return response
          }
          
          // Process non-streaming responses
          if (json.choices && Array.isArray(json.choices)) {
            let modified = false
            const modifiedChoices = json.choices.map((choice: any) => {
              if (
                choice.message &&
                Array.isArray(choice.message.tool_calls) &&
                choice.message.tool_calls.length === 0 &&
                choice.finish_reason === "stop"
              ) {
                modified = true
                const { tool_calls, ...rest } = choice.message
                return {
                  ...choice,
                  message: rest,
                }
              }
              return choice
            })
            
            if (modified) {
              return new Response(JSON.stringify({ ...json, choices: modifiedChoices }), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              })
            }
          }
        } catch (error) {
          // If anything goes wrong, return the original response
          return response
        }
      }
    
    return response
  }
}

/**
 * Wraps a language model to filter out empty tool_calls from responses.
 * This is a fallback approach that works at the model level.
 */
export function filterEmptyToolCalls<T extends LanguageModelV2>(model: T): T {
  return wrapLanguageModel({
    model,
    middleware: [
      {
        async transformResult(result) {
          // Handle non-streaming results
          if (result.type === "generate") {
            const content = result.content || []
            // Filter out any tool-call items that don't have proper IDs
            // This handles cases where empty tool_calls arrays were parsed
            const filteredContent = content.filter((item) => {
              if (item.type === "tool-call") {
                // Only keep tool-calls that have valid IDs
                return item.toolCallId && item.toolName
              }
              return true
            })
            
            // If we filtered anything and finish_reason is "stop", use filtered content
            if (filteredContent.length !== content.length && result.finishReason === "stop") {
              return {
                ...result,
                content: filteredContent,
              }
            }
          }
          
          return result
        },
      },
    ],
  }) as T
}

