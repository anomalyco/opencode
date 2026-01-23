import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const states = new Map<string, string>()

export default async function TogglePlugin(_input: PluginInput): Promise<Hooks> {
  return {
    command: [
      {
        name: "toggle",
        description: "toggle state",
        hints: ["$ARGUMENTS"],
        mode: "plugin",
      },
    ],
    "command.execute": async (input) => {
      if (input.command !== "toggle") return undefined
      const value = input.arguments.trim() || "off"
      states.set(input.sessionID, value)
      return {
        parts: [
          {
            id: "part",
            sessionID: input.sessionID,
            messageID: input.messageID ?? "message",
            type: "text",
            text: `toggle:${value}`,
          },
        ],
      }
    },
  }
}
