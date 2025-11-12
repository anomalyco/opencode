import z from "zod"
import { $ } from "bun"

/**
 * httpie - Human-friendly HTTP client
 * Cleaner than curl for JSON APIs (colors, headers, pretty output).
 */
export default {
  description: "Human-friendly HTTP client. Cleaner than curl for JSON APIs (colors, headers, pretty output). Examples: 'http GET api.example.com', 'http POST api.example.com/users name=John'.",
  args: {
    method: z.string().describe("HTTP method (GET, POST, PUT, DELETE, etc.)"),
    url: z.string().describe("URL to request"),
    data: z.string().optional().describe("JSON data for request body (for POST/PUT)"),
    headersJson: z.string().optional().describe("Request headers as JSON string (e.g., '{\"Authorization\":\"Bearer token\"}')"),
  },
  execute: async (params: { method: string; url: string; data?: string; headersJson?: string }) => {
    const args = ["http", params.method, params.url]
    
    if (params.headersJson) {
      try {
        const headers = JSON.parse(params.headersJson)
        for (const [key, value] of Object.entries(headers)) {
          args.push(`${key}:${value}`)
        }
      } catch (error) {
        return "Invalid headers JSON format"
      }
    }
    
    if (params.data) {
      args.push("--json")
      args.push(params.data)
    }
    
    const result = await $`${args}`.quiet().nothrow().text()
    return result || "Request failed"
  },
}
