const fs = require("node:fs")
const readline = require("node:readline")

fs.writeFileSync(
  process.argv[2],
  JSON.stringify({
    configured: process.env.OPENCODE_SERVICE_ENV_TEST,
    substituted: process.env.SUBSTITUTED_SERVICE_ENV,
    empty: process.env.OPENCODE_SERVICE_ENV_EMPTY_TEST,
    inherited: process.env.OPENCODE_SERVICE_ENV_INHERITED_TEST,
  }),
)
readline
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const request = JSON.parse(line)
    if (request.id === undefined) return
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: request.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "env-test", version: "1" },
          }
        : { tools: [] }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n")
  })
  .on("close", () => process.exit(0))
