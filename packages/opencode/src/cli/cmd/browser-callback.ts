import { cmd } from "./cmd"

export const BrowserCallbackCommand = cmd({
  command: "browser-callback <server-url> <session-id> <message-id> <url>",
  describe: false,
  builder: (yargs) =>
    yargs
      .positional("server-url", {
        describe: "OpenCode server URL (can include credentials)",
        type: "string",
        demandOption: true,
      })
      .positional("session-id", {
        describe: "Session ID",
        type: "string",
        demandOption: true,
      })
      .positional("message-id", {
        describe: "Message ID",
        type: "string",
        demandOption: true,
      })
      .positional("url", {
        describe: "URL to open",
        type: "string",
        demandOption: true,
      }),
  handler: async (args) => {
    const serverUrl = new URL(args["server-url"] as string)
    const sessionID = args["session-id"] as string
    const messageID = args["message-id"] as string
    const url = args.url as string

    const endpoint = new URL("/browser/open", serverUrl)
    endpoint.username = ""
    endpoint.password = ""

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (serverUrl.username && serverUrl.password) {
      const credentials = btoa(`${serverUrl.username}:${serverUrl.password}`)
      headers["Authorization"] = `Basic ${credentials}`
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, sessionID, messageID }),
    })

    if (!response.ok) {
      throw new Error(`Failed to notify server: ${response.status} ${response.statusText}`)
    }
  },
})
