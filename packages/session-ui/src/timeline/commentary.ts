import type { SessionMessageAssistant } from "@opencode/client/promise"

type Content = SessionMessageAssistant["content"][number]

// A user message starts a new turn, but wake-ups from watches, subagents and jobs add idle-bounded runs to the same turn.
export function turnCommentary(
  steps: readonly { message: SessionMessageAssistant; run: number }[],
  openRun: number,
  settled: boolean,
  visible: (content: Content) => boolean,
) {
  const runs = steps.reduce((runs, step) => {
    const contents = runs.get(step.run) ?? []
    contents.push(...step.message.content)

    return runs.set(step.run, contents)
  }, new Map<number, Content[]>())

  return [...runs].flatMap(([run, contents]) => runCommentary(contents, run < openRun || settled, visible))
}

// Provider phase labels take precedence over tool order. A settled run with no answer keeps its last visible text
// so an interrupted or tool-ending run still leaves something to read.
function runCommentary(contents: Content[], settled: boolean, visible: (content: Content) => boolean) {
  const lastTool = contents.findLastIndex((content) => content.type === "tool")

  const commentary = contents.filter(
    (content, index) =>
      content.type === "text" &&
      (content.native?.phase === "commentary" || (content.native?.phase !== "final_answer" && index < lastTool)),
  )

  const texts = contents.filter((content) => content.type === "text" && visible(content))

  if (!settled || texts.some((content) => !commentary.includes(content))) return commentary

  return commentary.filter((content) => content !== texts.at(-1))
}
