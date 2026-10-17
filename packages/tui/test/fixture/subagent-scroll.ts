import type { SessionMessageInfo } from "@opencode/client"
import { directory, json } from "./tui-client"

export const parent = {
  id: "ses_scroll_parent",
  title: "Synthetic scroll parent",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const child = { ...parent, id: "ses_scroll_child", parentID: parent.id, title: "Synthetic scroll child" }
const messages: SessionMessageInfo[] = [
  {
    type: "user",
    id: "initial-prompt",
    text: Array.from({ length: 35 }, (_, index) => `INITIAL-PROMPT line ${index}: inspect the imaginary garden.`).join(
      "\n",
    ),
    time: { created: 0 },
  },
  ...Array.from(
    // 29 older answers plus the prompt fit in one 60-entry backfill before BLOCK-030.
    { length: 49 },
    (_, offset): SessionMessageInfo => {
      const index = offset + 1
      return {
        type: "assistant",
        id: `answer-${index}`,
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        finish: "stop",
        time: { created: index * 10 + 1, completed: index * 10 + 2 },
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 2 + (index % 5) },
              (_, line) => `BLOCK-${String(index).padStart(3, "0")} line ${line}: synthetic garden observation.`,
            ).join("\n"),
          },
        ],
      }
    },
  ),
]

export function fetch(url: URL) {
  if (url.pathname === "/api/session") return json({ data: [parent, child], cursor: {} })
  for (const session of [parent, child]) {
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`)
      return json({
        data:
          session === child
            ? messages.toReversed()
            : [{ type: "user", id: "parent-prompt", text: "PARENT-MARKER", time: { created: 0 } }],
        cursor: {},
      })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
      return json({ data: [] })
  }
}
