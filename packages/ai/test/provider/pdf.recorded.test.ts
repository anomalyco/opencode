import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMResponse, Message, ToolDefinition, type LanguageModel } from "../../src"
import { AmazonBedrock, Anthropic, Google, OpenAI, XAI } from "../../src/providers"
import { LLMClient } from "../../src/route"
import { Tool } from "../../src/tool"
import { runTools } from "../lib/tool-runtime"
import { recordedTests } from "../recorded-test"

const CODE = "ORCHID-7391"
const PDF =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3NSA+PgpzdHJlYW0KQlQKL0YxIDE4IFRmCjcyIDcyMCBUZAooUERGIGNhc3NldHRlIHZlcmlmaWNhdGlvbiBjb2RlOiBPUkNISUQtNzM5MSkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzNjUgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MzUKJSVFT0YK"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY ?? "fixture" })
const anthropic = Anthropic.configure({ apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture" })
const google = Google.configure({ apiKey: process.env.GOOGLE_API_KEY ?? "fixture" })
const xai = XAI.configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" })
const bedrock = AmazonBedrock.configure({
  apiKey: process.env.AWS_BEDROCK_API_KEY ?? "fixture",
  region: process.env.AWS_REGION ?? "us-east-1",
})

const targets: ReadonlyArray<{
  readonly id: string
  readonly name: string
  readonly provider: string
  readonly protocol: string
  readonly requires: string
  readonly filename: string
  readonly maxTokens: number
  readonly model: LanguageModel
}> = [
  {
    id: "openai",
    name: "OpenAI Responses gpt-4o-mini",
    provider: "openai",
    protocol: "openai-responses",
    requires: "OPENAI_API_KEY",
    filename: "verification.pdf",
    maxTokens: 40,
    model: openai.responses("gpt-4o-mini"),
  },
  {
    id: "anthropic",
    name: "Anthropic Haiku 4.5",
    provider: "anthropic",
    protocol: "anthropic-messages",
    requires: "ANTHROPIC_API_KEY",
    filename: "verification.pdf",
    maxTokens: 40,
    model: anthropic.model("claude-haiku-4-5-20251001"),
  },
  {
    id: "gemini",
    name: "Gemini 3.5 Flash",
    provider: "google",
    protocol: "gemini",
    requires: "GOOGLE_API_KEY",
    filename: "verification.pdf",
    maxTokens: 256,
    model: google.model("gemini-3.5-flash"),
  },
  {
    id: "xai",
    name: "xAI Grok 4.5",
    provider: "xai",
    protocol: "openai-responses",
    requires: "XAI_API_KEY",
    filename: "verification.pdf",
    maxTokens: 40,
    model: xai.responses("grok-4.5"),
  },
  {
    id: "bedrock",
    name: "Bedrock Claude Haiku 4.5",
    provider: "amazon-bedrock",
    protocol: "bedrock-converse",
    requires: "AWS_BEDROCK_API_KEY",
    filename: "verification",
    maxTokens: 40,
    model: bedrock.model("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
  },
]

const recorded = recordedTests({ prefix: "pdf", tags: ["pdf"] })
const prompt = "Return only the verification code from the PDF."
const readPdf = ToolDefinition.make({
  name: "read_pdf",
  description: "Read the attached PDF.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
})
const readPdfRuntime = Tool.make({
  description: readPdf.description,
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.String,
  execute: () => Effect.succeed("PDF read successfully"),
  toModelOutput: () => [
    { type: "text", text: "PDF read successfully" },
    {
      type: "file",
      uri: `data:application/pdf;base64,${PDF}`,
      mime: "application/pdf",
      name: "verification.pdf",
    },
  ],
})

const expectCode = (response: LLMResponse) => {
  expect(response.finishReason.normalized).toBe("stop")
  expect(response.text.toUpperCase()).toContain(CODE)
}

describe("PDF recorded", () => {
  for (const target of targets) {
    recorded.effect.with(
      `reads a user PDF with ${target.name}`,
      {
        id: `${target.id}-user-input`,
        provider: target.provider,
        protocol: target.protocol,
        requires: [target.requires],
        tags: ["user-input"],
      },
      Effect.gen(function* () {
        expectCode(
          yield* LLMClient.generate(
            LLM.request({
              id: `recorded_pdf_${target.id}_user_input`,
              model: target.model,
              cache: "none",
              generation: { maxTokens: target.maxTokens, temperature: 0 },
              messages: [
                Message.user([
                  { type: "media", mediaType: "application/pdf", data: PDF, filename: target.filename },
                  { type: "text", text: prompt },
                ]),
              ],
            }),
          ),
        )
      }),
    )

    recorded.effect.with(
      `reads a PDF tool result with ${target.name}`,
      {
        id: `${target.id}-tool-result`,
        provider: target.provider,
        protocol: target.protocol,
        requires: [target.requires],
        tags: ["tool", "tool-result"],
      },
      Effect.gen(function* () {
        if (target.id === "gemini") {
          const events = Array.from(
            yield* runTools({
              request: LLM.request({
                id: "recorded_pdf_gemini_tool_result",
                model: target.model,
                system:
                  "Call read_pdf exactly once with path verification.pdf, then reply only with the verification code from its PDF.",
                prompt: "Use read_pdf with path verification.pdf and return the verification code.",
                cache: "none",
                generation: { maxTokens: target.maxTokens, temperature: 0 },
              }),
              tools: { read_pdf: readPdfRuntime },
            }).pipe(Stream.runCollect),
          )
          expect(events.at(-1)).toMatchObject({ type: "finish", reason: { normalized: "stop" } })
          expect(LLMResponse.text({ events }).toUpperCase()).toContain(CODE)
          return
        }

        expectCode(
          yield* LLMClient.generate(
            LLM.request({
              id: `recorded_pdf_${target.id}_tool_result`,
              model: target.model,
              system: "Read the PDF returned by the tool and follow the user's response format exactly.",
              cache: "none",
              generation: { maxTokens: target.maxTokens, temperature: 0 },
              messages: [
                Message.user(prompt),
                Message.assistant([{ type: "tool-call", id: "call_pdf_1", name: readPdf.name, input: {} }]),
                Message.tool({
                  id: "call_pdf_1",
                  name: readPdf.name,
                  resultType: "content",
                  result: [
                    { type: "text", text: "PDF read successfully" },
                    {
                      type: "file",
                      uri: `data:application/pdf;base64,${PDF}`,
                      mime: "application/pdf",
                      name: target.filename,
                    },
                  ],
                }),
              ],
              tools: [readPdf],
            }),
          ),
        )
      }),
    )
  }
})
