import { formatEditorContext } from "../../component/prompt/editor-context"
import type { EditorSelection } from "../../context/editor"

// session.generate exposes the session's tools but runs no tool loop, so a
// tool call would surface as an empty answer.
export const btwInstructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

/**
 * A `/btw` answer is generated from stored history plus this prompt only, so the editor
 * selection attached to the composer has to travel with the question.
 */
export function btwPrompt(question: string, selection?: EditorSelection) {
  return [selection ? formatEditorContext(selection).trimEnd() : undefined, btwInstructions, question]
    .filter(Boolean)
    .join("\n\n")
}
