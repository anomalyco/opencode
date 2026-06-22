export * as CommandPlugin from "./command"

import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"
import PROMPT_INITIALIZE from "./command/initialize.txt"
import PROMPT_REVIEW from "./command/review.txt"

const SWARM_TEMPLATE = [
  "You are the Apex Swarm conductor. The user invoked /swarm.",
  "",
  "User arguments: $ARGUMENTS",
  "",
  "Your job: immediately invoke the `swarm` tool with the following parameters:",
  "- task: the user's overall goal (infer from $ARGUMENTS)",
  "- count: number of workers, default 20",
  "- agent: which subagent to use, default apex-specter for exploration/research or apex-forge for implementation",
  "- instructions: any constraints the user gave",
  "",
  "Do not do the work yourself. Delegate entirely to the swarm.",
].join("\n")

const SWARM_LOOP_TEMPLATE = [
  "You are the Apex SwarmLoop conductor. The user invoked /swarm-loop.",
  "",
  "User arguments: $ARGUMENTS",
  "",
  "Your job: immediately invoke the `swarm_loop` tool with the following parameters:",
  "- task: the user's overall goal (infer from $ARGUMENTS)",
  "- workers: workers per loop, default 10",
  "- max_iterations: default 10",
  "- agent: which subagent to use, default apex-forge",
  "",
  "Do not do the work yourself. Delegate entirely to the swarm loop.",
].join("\n")

export const Plugin = define({
  id: "command",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.command.transform((draft) => {
      draft.update("init", (command) => {
        command.template = PROMPT_INITIALIZE.replace("${path}", ctx.location.project.directory)
        command.description = "guided AGENTS.md setup"
      })
      draft.update("review", (command) => {
        command.template = PROMPT_REVIEW.replace("${path}", ctx.location.project.directory)
        command.description = "review changes [commit|branch|pr], defaults to uncommitted"
        command.subtask = true
      })
      draft.update("swarm", (command) => {
        command.template = SWARM_TEMPLATE
        command.description = "spawn a swarm of subagents to tackle a large task in parallel"
        command.subtask = true
      })
      draft.update("swarm-loop", (command) => {
        command.template = SWARM_LOOP_TEMPLATE
        command.description = "continuous swarm loop until task completion"
        command.subtask = true
      })
    })
  }),
})
