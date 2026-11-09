import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import type { SessionDocument } from "../document"
import { SessionTimeline, type SessionUserPresentation } from "./session-timeline"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"

export default {
  title: "OpenCode/Conversation/Long user messages",
  id: "user-message-fold",
  parameters: { layout: "fullscreen" },
  render: () => <LongUserMessages />,
}

export const Thread = {}

function LongUserMessages() {
  return (
    <section data-story="user-message-fold" class="mx-auto w-full max-w-[760px] px-6 py-8">
      <CurrentSessionProviders document={thread}>
        <SessionTimeline document={thread} presentation={presentation} />
      </CurrentSessionProviders>
    </section>
  )
}

let offset = 0

function user(id: string, text: string, files?: SessionMessageUser["files"]): SessionMessageUser {
  offset += 60_000

  return {
    id,
    type: "user",
    text,
    files,
    time: { created: STORY_TIME + offset },
    metadata: { agent: "build", model: STORY_MODEL },
  }
}

function reply(id: string, text: string): SessionMessageAssistant {
  offset += 20_000

  return {
    id,
    type: "assistant",
    agent: "build",
    model: STORY_MODEL,
    content: [{ type: "text", text }],
    time: { created: STORY_TIME + offset, completed: STORY_TIME + offset + 9_000 },
  }
}

const threeLines = [
  "Can you make the sidebar remember its width?",
  "It resets every time I reopen the app.",
  "Keep it per project if that's easy, otherwise global is fine.",
].join("\n")

const pastedPrompt = [
  "The desktop app crashes when I restore a window with a lot of tabs. Here's what I see in the log:",
  "",
  "[14:02:11.204] INFO  window.restore start tabs=38 workspace=opencode",
  "[14:02:11.209] INFO  session.hydrate ses_7f1c count=38",
  "[14:02:11.311] WARN  timeline.cache miss key=ses_7f1c:0 rows=0",
  "[14:02:11.312] WARN  timeline.cache miss key=ses_7f1c:1 rows=0",
  "[14:02:11.318] INFO  virtualizer.mount estimate=160 rows=412",
  "[14:02:11.402] INFO  virtualizer.measure batch=64",
  "[14:02:11.455] INFO  virtualizer.measure batch=64",
  "[14:02:11.497] INFO  virtualizer.measure batch=64",
  "[14:02:11.533] WARN  scroll.anchor lost key=row:msg_91 delta=-1840",
  "[14:02:11.534] WARN  scroll.anchor lost key=row:msg_92 delta=-1840",
  "[14:02:11.601] ERROR Uncaught RangeError: Maximum call stack size exceeded",
  "    at resizeItem (virtualizer.tsx:379:11)",
  "    at batch (solid-js/dist/solid.js:771:12)",
  "    at queueMicrotask (virtualizer.tsx:374:7)",
  "    at pinAnchor (virtualizer.tsx:504:43)",
  "    at settleColdBottom (virtualizer.tsx:648:9)",
  "    at ResizeObserver.<anonymous> (virtualizer.tsx:688:5)",
  "[14:02:11.602] ERROR renderer crashed reason=oom code=-36861",
  "[14:02:11.950] INFO  window.restore retry 1/3",
  "[14:02:12.408] ERROR renderer crashed reason=oom code=-36861",
  "[14:02:12.911] INFO  window.restore retry 2/3",
  "[14:02:13.377] ERROR renderer crashed reason=oom code=-36861",
  "[14:02:13.380] INFO  window.restore giving up, opening empty window",
  "",
  "Things I already tried:",
  "- Clearing the timeline cache in Settings > Advanced. Same crash.",
  "- Restoring with 10 tabs works. 20 works. Somewhere around 30 it falls over.",
  "- It only happens when the restored session is the one that was streaming when I quit.",
  "- Turning off the new virtualizer flag makes it go away, but scrolling is janky without it.",
  "",
  "My machine: M3 Max, 64 GB, macOS 26.1, OpenCode Beta 2.4.0-beta.18.",
  "",
  "I think the measure batches keep re-entering pinAnchor while the cold bottom is still settling, and each pass",
  "schedules another one. But I'm not sure why only the streaming session triggers it.",
  "",
  "Can you find the loop, explain why the streaming session is the trigger, and fix it without turning the",
  "flag off? Add a test that restores 40 tabs.",
].join("\n")

const codeBlock = [
  "This throws on an empty array and I don't see why:",
  "",
  "```ts",
  "export function latest<T extends { time: number }>(items: T[]) {",
  "  return items.reduce((best, item) => {",
  "    if (item.time > best.time) return item",
  "    return best",
  "  })",
  "}",
  "",
  "const sessions = await store.list({ archived: false })",
  "const current = latest(sessions)",
  "render(current.title)",
  "```",
  "",
  "It works everywhere except a brand new workspace.",
  "Should latest return undefined, or should the caller check first?",
].join("\n")

const voiceDictation =
  "okay so I was looking at the session list on my laptop and the thing that keeps bugging me is when I have a bunch of sessions going at once I can't tell which ones actually need me, like the ones waiting on a permission or a question look exactly the same as the ones that are just running, and then I end up clicking into each one to check, which is kind of the whole thing I wanted to stop doing, so can you add some kind of quiet marker for sessions that are blocked on me, not a big red badge or anything, just something I can scan for, and maybe sort them to the top of the project group but only if that doesn't make the list jump around while I'm looking at it, because that would be worse, and also check what the phone app does here because I think it already has something like this and it'd be nice if they matched, and if it's a bigger change than it sounds then just tell me the plan first before you build it"

const screenshot = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#17171a"/><rect width="180" height="400" fill="#1f1f23"/><g fill="#3a3a40"><rect x="20" y="28" width="120" height="10" rx="5"/><rect x="20" y="58" width="96" height="10" rx="5"/><rect x="20" y="88" width="132" height="10" rx="5"/><rect x="20" y="118" width="84" height="10" rx="5"/></g><rect x="216" y="40" width="300" height="14" rx="7" fill="#4a4a52"/><g fill="#2c2c32"><rect x="216" y="80" width="388" height="10" rx="5"/><rect x="216" y="102" width="360" height="10" rx="5"/><rect x="216" y="124" width="372" height="10" rx="5"/></g><rect x="384" y="170" width="220" height="64" rx="10" fill="#2a2a30"/><rect x="216" y="270" width="388" height="96" rx="12" fill="none" stroke="#e5484d" stroke-width="3"/></svg>`,
)}`

const thread = {
  sessionID: CURRENT_SESSION_ID,
  status: { type: "idle" },
  diffs: [],
  messages: [
    user("msg_fold_one_liner", "Run the desktop tests again, the flaky one should be fixed now."),
    reply("msg_fold_one_liner_reply", "All 214 desktop tests pass, including the window restore test that was flaky."),
    user("msg_fold_three_lines", threeLines),
    reply(
      "msg_fold_three_lines_reply",
      "The sidebar now saves its width per project and restores it on launch. A project you haven't resized uses the last width you picked anywhere.",
    ),
    user("msg_fold_pasted", pastedPrompt),
    reply(
      "msg_fold_pasted_reply",
      "Found it. A restored streaming session replays its last delta after mount, which resizes the tail row while the cold bottom is still settling. Each resize re-pins the anchor, and pinning schedules another measure. I broke the loop by settling the cold bottom once per batch and added a 40-tab restore test.",
    ),
    user("msg_fold_code", codeBlock),
    reply(
      "msg_fold_code_reply",
      "`reduce` with no initial value throws on an empty array. `latest` now returns `undefined` for an empty list, and its two callers show the empty state instead.",
    ),
    user("msg_fold_image", "The spacing under the composer looks off on this screen, see the red box.", [
      {
        data: screenshot.slice(screenshot.indexOf(",") + 1),
        mime: "image/svg+xml",
        name: "composer-spacing.svg",
        source: { type: "inline" },
      },
    ]),
    reply(
      "msg_fold_image_reply",
      "The dock added its own 12px margin on top of the composer's padding. I removed the dock's margin, so the gap is 8px like everywhere else.",
    ),
    user("msg_fold_voice", voiceDictation),
    reply(
      "msg_fold_voice_reply",
      "Sessions waiting on you now show a small dot in the list, the same one the phone app uses. I left the order alone: moving rows while you scan felt worse, as you guessed.",
    ),
    user("msg_fold_short_last", "Nice. Ship it."),
  ] satisfies SessionMessageInfo[],
} satisfies SessionDocument

const presentation = {
  msg_fold_voice: { voice: true },
} satisfies Record<string, SessionUserPresentation>
