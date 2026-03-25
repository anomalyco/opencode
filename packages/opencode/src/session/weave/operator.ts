import { SessionPrompt } from "@/session/prompt"

export namespace WeaveOperator {
  export async function llmMap(input: {
    sessionID: string
    agent: string
    model?: { providerID: string; modelID: string }
    items: string[]
    promptTemplate: string
  }) {
    const results: { item: string; output: string }[] = []
    for (const item of input.items) {
      const prompt = input.promptTemplate.replaceAll("{{item}}", item)
      const response = await SessionPrompt.prompt({
        sessionID: input.sessionID as any,
        agent: input.agent,
        model: input.model as any,
        noReply: false,
        parts: [{ type: "text", text: prompt }],
      })
      const output = response.parts.findLast((part) => part.type === "text")?.text ?? ""
      results.push({ item, output })
    }
    return results
  }
}
