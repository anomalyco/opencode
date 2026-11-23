// `debug config`: the entries in server order with secrets, header values, and credential URLs
// redacted (`debug/redact.ts`).
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["debug", "config"],
  server: {
    routes: [
      {
        path: "/api/config",
        json: [
          {
            type: "document",
            path: "/work/opencode.json",
            info: {
              permissions: [
                { action: "shell", resource: "*", effect: "ask" },
                { action: "shell", resource: "git status", effect: "allow" },
              ],
              providers: {
                example: {
                  settings: { apiKey: "sk-example", timeout: 1200, baseURL: "https://api.example.com/v1" },
                  headers: { Authorization: "Bearer example", "X-Custom": "opaque" },
                },
              },
              mcp: {
                remote: {
                  url: "https://user:pass@example.com/mcp",
                  oauth: { client_secret: "s", client_id: "public" },
                },
                query: { url: "https://example.com/mcp?access_token=1" },
                broken: { url: "https://[bad" },
                local: { environment: { SERVICE_TOKEN: "token-value", PATH: "/usr/bin" } },
              },
              max_tokens: 100,
            },
          },
          { type: "default", info: {} },
        ],
      },
    ],
  },
})
