import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { Log } from "@/util/log"
import { MessageV2 } from "./message-v2"

export namespace AutoContinue {
  const log = Log.create({ service: "session.autocontinue" })

  const state = Instance.state(() => ({
    init: false,
    seen: new Set<string>(),
  }))

  export function init() {
    const s = state()
    if (s.init) return
    s.init = true
    Bus.subscribe(MessageV2.Event.Updated, async (event) => {
      await update(event.properties.info)
    })
  }

  export async function update(info: MessageV2.Info) {
    if (info.role !== "assistant" || info.error) return
    if (!info.finish || info.finish === "tool-calls" || info.finish === "unknown") return

    const cfg = (await Config.get()).experimental?.auto_continue
    if (!cfg?.enabled) return

    const s = state()
    if (s.seen.has(info.id)) return
    s.seen.add(info.id)
    if ((await latest(info.sessionID))?.info.id !== info.id) {
      s.seen.delete(info.id)
      return
    }

    const msg = await MessageV2.get({
      sessionID: info.sessionID,
      messageID: info.id,
    })
    const text = tail(msg.parts)
    if (!text || !match(text, cfg)) {
      s.seen.delete(info.id)
      return
    }

    log.info("continuing", { sessionID: info.sessionID, messageID: info.id })
    void SessionPrompt.prompt({
      sessionID: info.sessionID,
      parts: [
        {
          type: "text",
          text: cfg.prompt,
          synthetic: true,
        },
      ],
    }).catch((err) => {
      log.error("failed to continue", { sessionID: info.sessionID, messageID: info.id, error: err })
    })
  }

  export function match(text: string, cfg: Config.AutoContinue) {
    return cfg.patterns.some((pattern) => new RegExp(pattern, "i").test(text))
  }

  export function tail(parts: MessageV2.Part[]) {
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim()
    if (!text) return ""
    return (
      text
        .split(/\n\s*\n/g)
        .map((part) => part.trim())
        .filter(Boolean)
        .pop() ?? text
    )
  }

  async function latest(sessionID: string) {
    for await (const msg of MessageV2.stream(sessionID)) {
      return msg
    }
  }
}
