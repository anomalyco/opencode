import { Session } from "."
import type { MessageV2 } from "./message-v2"

export namespace SessionTranscript {
  export async function toMarkdown(sessionID: string): Promise<string> {
    const session = await Session.get(sessionID)
    const msgs = await Session.messages({ sessionID })

    let transcript = `# ${session.title}\n\n`
    transcript += `**Session ID:** ${session.id}\n`
    transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
    transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
    transcript += `---\n\n`

    for (const msg of msgs) {
      const role = msg.info.role === "user" ? "User" : "Assistant"
      transcript += `## ${role}\n\n`

      for (const part of msg.parts) {
        if (part.type === "text" && !part.synthetic) {
          transcript += `${part.text}\n\n`
        } else if (part.type === "tool") {
          transcript += formatToolPart(part)
        }
      }

      transcript += `---\n\n`
    }

    return transcript
  }

  function formatToolPart(part: MessageV2.ToolPart): string {
    let result = `\`\`\`\nTool: ${part.tool}\n`

    if (part.state.status === "completed") {
      const input = JSON.stringify(part.state.input, null, 2)
      result += `Input: ${input}\n`
      if (part.state.output && part.state.output.length < 2000) {
        result += `Output: ${part.state.output}\n`
      }
    }

    result += `\`\`\`\n\n`
    return result
  }

  export async function writeToFile(sessionID: string, filepath: string): Promise<void> {
    const markdown = await toMarkdown(sessionID)
    await Bun.write(filepath, markdown)
  }
}
