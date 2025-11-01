import { tool } from "@opencode-ai/plugin/tool"
import { join } from "path"

async function getPerplexityKey() {
  const authPath = join(process.env.HOME || ".", ".local/share/opencode/auth.json")
  const file = Bun.file(authPath)
  if (!(await file.exists())) return null
  const authData = await file.json()
  return authData.PERPLEXITY_API_KEY || null
}

export const websearch = tool({
  description: "Search the web for current information using Perplexity AI",
  args: {
    query: tool.schema
      .string()
      .describe("The search query"),
  },
  async execute(args) {
    const apiKey = await getPerplexityKey()
    
    if (!apiKey) {
      return "Error: Perplexity API key not found. Please set PERPLEXITY_API_KEY in ~/.local/share/opencode/auth.json"
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-small-128k-online",
        messages: [
          {
            role: "system",
            content: "Be precise and concise."
          },
          {
            role: "user",
            content: args.query
          }
        ]
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return `Error: Perplexity API request failed with status ${response.status}: ${errorText}`
    }

    const data = await response.json()
    
    if (!data.choices?.[0]?.message?.content) {
      return "Error: Unexpected response format from Perplexity API"
    }

    return data.choices[0].message.content
  },
})