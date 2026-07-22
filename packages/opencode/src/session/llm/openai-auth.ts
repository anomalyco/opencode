export function isOpenAIChatGPTAuth(input: {
  provider: { id: string; options: Record<string, unknown> }
  auth: { type: string } | undefined
}) {
  return (
    input.provider.id === "openai" && (input.auth?.type === "oauth" || input.provider.options.openaiAuth === "broker")
  )
}
