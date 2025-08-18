import { createResource } from "solid-js"
import { createStore, produce } from "solid-js/store"
import SYSTEM_PROMPT from "./system.txt?raw"
import type {
  LanguageModelV1Prompt,
  LanguageModelV1CallOptions,
  LanguageModelV1,
} from "ai"

interface Tool {
  name: string
  description: string
  inputSchema: any
}

interface ToolCallerProps {
  tool: {
    list: () => Promise<Tool[]>
    call: (input: { name: string; arguments: any }) => Promise<any>
  }
  generate: (
    prompt: LanguageModelV1CallOptions,
  ) => Promise<
    | { err: "rate" }
    | { err: "context" }
    | { err: "balance" }
    | ({ err: false } & Awaited<ReturnType<LanguageModelV1["doGenerate"]>>)
  >
  onPromptUpdated?: (prompt: LanguageModelV1Prompt) => void
}

const system = [
  {
    role: "system" as const,
    content: SYSTEM_PROMPT,
  },
  {
    role: "system" as const,
    content: `The current date is ${new Date().toDateString()}. Always use this current date when responding to relative date queries.`,
  },
]

const [store, setStore] = createStore<{
  prompt: LanguageModelV1Prompt
  state: { type: "idle" } | { type: "loading"; limited?: boolean }
}>({
  prompt: [...system],
  state: { type: "idle" },
})

export function createToolCaller<T extends ToolCallerProps>(props: T) {
  const [tools] = createResource(() => props.tool.list())

  let abort: AbortController

  return {
    get tools() {
      return tools()
    },
    get prompt() {
      return store.prompt
    },
    get state() {
      return store.state
    },
    clear() {
      setStore("prompt", [...system])
    },
    async chat(input: string) {
      if (store.state.type !== "idle") return

      abort = new AbortController()
      setStore(
        produce((s) => {
          s.state = {
            type: "loading",
            limited: false,
          }
          s.prompt.push({
            role: "user",
            content: [
              {
                type: "text",
                text: input,
              },
            ],
          })
        }),
      )
      props.onPromptUpdated?.(store.prompt)

      while (true) {
        if (abort.signal.aborted) {
          break
        }

        const response = await props.generate({
          inputFormat: "messages",
          prompt: store.prompt,
          temperature: 0,
          seed: 69,
          mode: {
            type: "regular",
            tools: tools()?.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: {
                ...tool.inputSchema,
              },
            })),
          },
        })

        if (abort.signal.aborted) continue

        if (!response.err) {
          setStore("state", {
            type: "loading",
          })

          if (response.text) {
            setStore(
              produce((s) => {
                s.prompt.push({
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: response.text || "",
                    },
                  ],
                })
              }),
            )
            props.onPromptUpdated?.(store.prompt)
          }

          if (response.finishReason === "stop") {
            break
          }

          if (response.finishReason === "tool-calls") {
            for (const item of response.toolCalls || []) {
              setStore(
                produce((s) => {
                  s.prompt.push({
                    role: "assistant",
                    content: [
                      {
                        type: "tool-call",
                        toolName: item.toolName,
                        args: JSON.parse(item.args),
                        toolCallId: item.toolCallId,
                      },
                    ],
                  })
                }),
              )
              props.onPromptUpdated?.(store.prompt)

              const called = await props.tool.call({
                name: item.toolName,
                arguments: JSON.parse(item.args),
              })

              setStore(
                produce((s) => {
                  s.prompt.push({
                    role: "tool",
                    content: [
                      {
                        type: "tool-result",
                        toolName: item.toolName,
                        toolCallId: item.toolCallId,
                        result: called,
                      },
                    ],
                  })
                }),
              )
              props.onPromptUpdated?.(store.prompt)
            }
          }
          continue
        }

        if (response.err === "context") {
          setStore(
            produce((s) => {
              s.prompt.splice(2, 1)
            }),
          )
          props.onPromptUpdated?.(store.prompt)
        }

        if (response.err === "rate") {
          setStore("state", {
            type: "loading",
            limited: true,
          })
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }

        if (response.err === "balance") {
          setStore(
            produce((s) => {
              s.prompt.push({
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "You need to add credits to your account. Please go to Billing and add credits to continue.",
                  },
                ],
              })
              s.state = { type: "idle" }
            }),
          )
          props.onPromptUpdated?.(store.prompt)
          break
        }
      }
      setStore("state", { type: "idle" })
    },
    async cancel() {
      abort.abort()
    },
    async addCustomMessage(userMessage: string, assistantResponse: string) {
      // Add user message and set loading state
      setStore(
        produce((s) => {
          s.prompt.push({
            role: "user",
            content: [
              {
                type: "text",
                text: userMessage,
              },
            ],
          })
          s.state = {
            type: "loading",
            limited: false,
          }
        }),
      )
      props.onPromptUpdated?.(store.prompt)

      // Fake delay for 500ms
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Add assistant response and set back to idle
      setStore(
        produce((s) => {
          s.prompt.push({
            role: "assistant",
            content: [
              {
                type: "text",
                text: assistantResponse,
              },
            ],
          })
          s.state = { type: "idle" }
        }),
      )
      props.onPromptUpdated?.(store.prompt)
    },
  }
}
