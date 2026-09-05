import { expect, test } from "bun:test"
import { AIError, LLM, LLMRequest, LLMResponse, Message, TransportError } from "@opencode-ai/ai"
import { configure } from "@opencode-ai/ai/providers/openai"
import { LLMClient, RequestExecutor, type WebSocketConnector } from "@opencode-ai/ai/route"
import { SessionModelTransport } from "../src/session/model-transport"
import { Session } from "@opencode-ai/schema/session"
import { Cause, Effect, Layer, Queue, Stream } from "effect"

const sessionID = Session.ID.make("ses_astra")
const item = (id: string, text: string) => ({
  type: "message",
  id,
  role: "assistant",
  content: [{ type: "output_text", text }],
})
const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{}", async: true }
const result = Message.tool({ id: "call_1", name: "lookup", result: "42", resultType: "text" })

for (const mode of ["automatic", "completed", "pending", "failed", "disconnect", "async"] as const) {
  test(
    `Astra steering: ${mode}`,
    () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const frames = yield* Queue.unbounded<string | Uint8Array, AIError>()
            const sent: Array<Record<string, unknown>> = []
            let admitted = false
            let opens = 0
            const send = (event: unknown) => Queue.offerUnsafe(frames, JSON.stringify(event))
            const finish = (id: string, text: string) => {
              const output = item(`msg_${id}`, text)
              send({ type: "response.created", response: { id } })
              send({ type: "response.output_item.done", item: output })
              send({
                type: "response.completed",
                response: { id, output: [output], usage: { input_tokens: 10, output_tokens: 2 } },
              })
            }
            const connector: WebSocketConnector = {
              open: () =>
                Effect.sync(() => {
                  opens++
                  return {
                    messages: Stream.fromQueue(frames),
                    close: Effect.void,
                    sendText: (message) =>
                      Effect.sync(() => {
                        const body = JSON.parse(message)
                        sent.push(body)
                        if (sent.length === 1) {
                          send({ type: "response.created", response: { id: "resp_1" } })
                          send({ type: "response.output_item.added", item: item("msg_first", "") })
                          send({ type: "response.output_text.delta", item_id: "msg_first", delta: "Working" })
                          return
                        }
                        if (body.type === "response.steer") {
                          expect(admitted).toBe(true)
                          expect(body).toEqual({
                            type: "response.steer",
                            previous_response_id: "resp_1",
                            input: "Be brief",
                          })
                          if (mode === "disconnect") {
                            Queue.failCauseUnsafe(
                              frames,
                              Cause.fail(
                                new AIError({
                                  reason: new TransportError({
                                    message: "Disconnected",
                                    operation: "read",
                                    transport: "websocket",
                                  }),
                                }),
                              ),
                            )
                            return
                          }
                          const steer = { id: "steer_1", previous_response_id: "resp_1", input: "Be brief" }
                          send({
                            type: mode === "failed" ? "response.steer.failed" : "response.steer.accepted",
                            steer,
                            ...(mode === "failed"
                              ? { error: { code: "steering_not_supported", message: "Unsupported" } }
                              : {}),
                          })
                          const output = [item("msg_first", "Working")]
                          send({ type: "response.output_item.done", item: output[0] })
                          if (mode === "async") send({ type: "response.output_item.added", item: call })
                          if (mode === "pending" || mode === "async") {
                            const { async: _, ...done } = call
                            send({ type: "response.output_item.done", item: done })
                          }
                          send({
                            type:
                              mode === "completed" || mode === "failed" || mode === "pending"
                                ? "response.completed"
                                : "response.incomplete",
                            response: {
                              id: "resp_1",
                              output: mode === "pending" || mode === "async" ? [...output, call] : output,
                              ...(mode === "automatic" || mode === "async"
                                ? { incomplete_details: { reason: "steered" } }
                                : {}),
                              usage: { input_tokens: 8, output_tokens: 1 },
                            },
                          })
                          if (mode === "pending") {
                            send({
                              type: "response.steer.pending",
                              steer,
                              reason: "waiting_for_required_input",
                              required_input: [{ type: "function_call_output", call_id: "call_1", name: "lookup" }],
                            })
                            return
                          }
                          if (mode !== "failed") finish("resp_2", "Brief")
                          return
                        }
                        finish(mode === "async" ? "resp_3" : "resp_2", "Done")
                      }),
                  }
                }),
            }
            const runtime = Layer.mergeAll(
              SessionModelTransport.makeLayer(connector),
              LLMClient.layer.pipe(
                Layer.provide(
                  Layer.succeed(
                    RequestExecutor.Service,
                    RequestExecutor.Service.of({ execute: () => Effect.die("Unexpected HTTP request") }),
                  ),
                ),
              ),
            )
            yield* Effect.gen(function* () {
              const transport = yield* SessionModelTransport.Service
              const options = { webSocket: transport.bind(sessionID) }
              const request = LLM.request({
                model: configure({ apiKey: "test" }).responses("gpt-6-astra"),
                prompt: "Start",
              })
              const first = yield* LLMClient.stream(request, options).pipe(
                Stream.tap((event) =>
                  event.type === "text-delta"
                    ? transport.steer(
                        sessionID,
                        "Be brief",
                        Effect.sync(() => {
                          admitted = true
                        }),
                      )
                    : Effect.void,
                ),
                Stream.runCollect,
                Effect.result,
              )
              expect(admitted).toBe(true)
              if (mode === "disconnect") {
                expect(first._tag).toBe("Failure")
                return
              }
              if (first._tag === "Failure") return yield* Effect.fail(first.failure)
              const response = LLMResponse.fromEvents(first.success)!
              expect(response.text).toBe("Working")
              expect(response.usage?.outputTokens).toBe(1)
              const messages = [
                ...request.messages,
                response.message,
                ...(mode === "pending" || mode === "async" ? [result] : []),
                Message.user("Be brief"),
              ]
              const second = yield* LLMClient.generate(LLMRequest.update(request, { messages }), options)
              expect(second.text).toBe(mode === "failed" || mode === "pending" ? "Done" : "Brief")
              expect(second.usage?.outputTokens).toBe(2)
              expect(opens).toBe(1)
              if (mode === "pending") {
                expect(sent[2]).toMatchObject({
                  type: "response.create",
                  previous_response_id: "resp_1",
                  input: [{ type: "function_call_output", call_id: "call_1", output: "42" }],
                })
              } else if (mode === "failed") {
                expect(sent[2]).toMatchObject({
                  input: [{ role: "user", content: [{ type: "input_text", text: "Be brief" }] }],
                })
              } else {
                expect(sent).toHaveLength(2)
              }
              if (mode === "async") {
                expect(response.toolCalls).toHaveLength(1)
                expect(response.toolCalls[0].providerMetadata?.openai?.async).toBe(true)
                expect(transport.hasPendingInput(sessionID)).toBe(true)
                yield* LLMClient.generate(
                  LLMRequest.update(request, { messages: [...messages, second.message] }),
                  options,
                )
                expect(sent[2]).toMatchObject({
                  previous_response_id: "resp_2",
                  input: [{ type: "function_call_output", call_id: "call_1", output: "42" }],
                })
                expect(transport.hasPendingInput(sessionID)).toBe(false)
              }
            }).pipe(Effect.provide(runtime))
          }),
        ),
      ),
    5000,
  )
}
