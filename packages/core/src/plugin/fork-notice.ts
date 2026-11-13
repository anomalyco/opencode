export * as ForkNoticePlugin from "./fork-notice.js"

import { define } from "@opencode/plugin/effect/plugin"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"

const notice = `<fork-notice>
This conversation is a fork of another conversation, copied up to the previous message. The original conversation keeps going on its own and may be active right now, as may other forks of it.
- Work started before the fork belongs to the original: background subagents, background shells, schedules, and follow-ups promised there. Their results and notifications go to the original, never here, and you can't continue those subagents. Don't wait for them, redo them, or report their results as yours; if it matters, check what already happened (files, git, PRs, CI).
- Files, repositories, branches and external services are shared with the original. Before changing something the original was working on (its uncommitted changes, branches, worktrees, PRs, deploys, messages), check its current state, and put work that diverges from it on a new branch or worktree.
- Otherwise work normally: new tasks need no extra checks, branches or questions.
- If it's unclear whether this fork or the original should do something, ask.
</fork-notice>`

export const Plugin = define({
  id: "opencode.fork-notice",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.session.hook("fork", ({ sessionID }) =>
      ctx.session
        .synthetic({
          sessionID,
          id: SessionMessage.ID.make(`msg_fork_notice_${sessionID}`),
          text: notice,
          description: "Fork notice",
          resume: false,
        })
        .pipe(Effect.asVoid, Effect.orDie),
    )
  }),
})
