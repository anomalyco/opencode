import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { waitForHighlightedFrame } from "./fixture/frame"

const session = {
  id: "ses_interrupt_undo",
  title: "Interrupt undo",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const ask = { type: "user", id: "msg_ask", text: "Reword this prompt", time: { created: 1 } }
const queued = {
  id: "msg_queued",
  sessionID: session.id,
  type: "user",
  delivery: "queue",
  payload: { ...ask, id: "msg_queued", text: "Queued follow-up" },
  time: { created: 3 },
}

const shell = {
  type: "shell",
  id: "msg_shell",
  shellID: "shl_1",
  command: "sleep 60",
  status: "running",
  time: { created: 3 },
}

const INTERRUPT = `POST /api/session/${session.id}/interrupt`
const WAIT = `POST /api/experimental/session/${session.id}/wait`
const REVERT = `POST /api/session/${session.id}/revert/stage`
const COMMIT = `POST /api/session/${session.id}/revert/commit`

/** Opens a running session whose last prompt got `content` back so far, and interrupts it. `calls` logs what that sent. */
async function interrupt(input: { content: unknown[]; later?: unknown[]; inbox?: unknown[]; draft?: string }) {
  // Drafts are stashed per tab for the whole process, so an earlier test or test file would prefill the composer.
  for (const id of [undefined, session.id]) takeDraft(id)
  const calls: string[] = []
  const respond: Partial<Record<string, () => Response>> = {
    [INTERRUPT]: () => json({ interrupted: true }),
    [WAIT]: () => new Response(null, { status: 204 }),
    [REVERT]: () => json({ data: session }),
    [COMMIT]: () => new Response(null, { status: 204 }),
  }
  const app = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === "/api/session/active") return json({ data: { [session.id]: { type: "running" } } })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: input.inbox ?? [] })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [
            ...(input.later ?? []),
            {
              type: "assistant",
              id: "msg_reply",
              agent: "build",
              model: { providerID: "fixture", id: "fixture" },
              time: { created: 2 },
              content: input.content,
            },
            ask,
          ],
          cursor: {},
        })
      const key = `${request.method} ${url.pathname}`
      const response = respond[key]?.()
      if (response) calls.push(key)
      return response
    },
  })
  await waitForHighlightedFrame(app, (frame) => frame.includes(ask.text) && frame.includes("interrupt"))
  if (input.draft) await app.mockInput.typeText(input.draft)
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("again to interrupt"))
  app.mockInput.pressEscape()
  return Object.assign(app, { calls })
}

// How many times the frame shows the prompt: once in the transcript, twice once it is also back in the composer.
const shown = (frame: string) => frame.split(ask.text).length - 1

test("interrupting before the model answers with text or a tool call takes the prompt back", async () => {
  await using app = await interrupt({ content: [{ type: "reasoning", text: "Thinking it over" }] })

  await app.waitForFrame((frame) => shown(frame) === 2)
  await app.waitForFrame(() => app.calls.length === 4)
  expect(app.calls).toEqual([INTERRUPT, WAIT, REVERT, COMMIT])
}, 20000)

test.each([
  ["after the model answered", { content: [{ type: "text", text: "Here you go" }] }, [INTERRUPT, WAIT]],
  ["a shell command run after an unanswered prompt", { content: [], later: [shell] }, [INTERRUPT, WAIT]],
  ["with a draft in the composer", { content: [], draft: "something else" }, [INTERRUPT]],
  ["with a prompt still pending", { content: [], inbox: [queued] }, [INTERRUPT]],
])(
  "interrupting %s only interrupts",
  async (_name, input, expected) => {
    await using app = await interrupt(input)

    await app.waitForFrame(() => app.calls.length === expected.length)
    // Gives a rewind that shouldn't follow time to show.
    await Bun.sleep(50)
    expect(app.calls).toEqual(expected)
    expect(shown(await app.waitForFrame(() => true))).toBe(1)
  },
  20000,
)
