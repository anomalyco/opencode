import { tool } from "@opencode-ai/plugin/tool";
import { promises as fs } from "fs";
import { join } from "path";

// Load Perplexity API key from auth file
async function getPerplexityKey(): Promise<string | null> {
  try {
    const authPath = join(process.env.HOME || ".", ".local/share/opencode/auth.json");
    const authData = JSON.parse(await fs.readFile(authPath, "utf-8"));
    return authData.PERPLEXITY_API_KEY || null;
  } catch (error) {
    return null;
  }
}

export const websearch = tool({
  description: "Search the web for current information using Perplexity AI",
  args: {
    query: tool.schema
      .string()
      .describe("The search query"),
    region: tool.schema
      .string()
      .optional()
      .default("us-en")
      .describe("Region for search results"),
  },
  async execute(args) {
    try {
      const apiKey = await getPerplexityKey();
      
      if (!apiKey) {
        return "Error: Perplexity API key not found. Please set PERPLEXITY_API_KEY in ~/.local/share/opencode/auth.json";
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        return `Error: Perplexity API request failed with status ${response.status}: ${errorText}`;
      }

      const data = await response.json();
      
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      } else {
        return "Error: Unexpected response format from Perplexity API";
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
});