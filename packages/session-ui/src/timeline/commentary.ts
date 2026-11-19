import type { SessionMessageAssistant } from "@opencode/client/promise"

type Content = SessionMessageAssistant["content"][number]

export function turnCommentary(
  steps: readonly { message: SessionMessageAssistant; run: number }[],
  settled: boolean,
  visible: (content: Content) => boolean,
) {
  const runs = new Map<number, Content[]>()

  for (const step of steps) {
    const contents = runs.get(step.run) ?? []
    contents.push(...step.message.content)
    runs.set(step.run, contents)
  }

  return [...runs.values()].flatMap((contents, index) =>
    runCommentary(contents, index < runs.size - 1 || settled, visible),
  )
}

// Provider phase labels take precedence over tool order. A settled run with no answer keeps its last visible text.
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
