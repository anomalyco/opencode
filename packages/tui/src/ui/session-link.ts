import {
  CodeRenderable,
  TextAttributes,
  detectLinks,
  type CliRenderer,
  type MarkdownRenderable,
  type MouseEvent,
  type OnChunksCallback,
} from "@opentui/core"
import { sessionMentions } from "@opencode/util/session-mention"
import { stringWidth } from "../util/string-width"
import { plainClick } from "./link"

// Markdown passes this callback to every prose block it creates, nested list items and quotes
// included, but never to fenced code, so only prose gets session links.
const linkChunks: OnChunksCallback = (chunks, context) => {
  const style = context.syntaxStyle.mergeStyles("markup.link.url")
  return detectLinks(chunks, context).flatMap((chunk) => {
    const mentions = chunk.link ? [] : sessionMentions(chunk.text)
    if (mentions.length === 0) return [chunk]
    // Odd parts are the mentions.
    const cuts = [0, ...mentions.flatMap((mention) => [mention.start, mention.end]), chunk.text.length]
    return cuts
      .slice(1)
      .map((end, index) =>
        index % 2
          ? {
              ...chunk,
              text: chunk.text.slice(cuts[index], end),
              fg: style.fg ?? chunk.fg,
              attributes: style.attributes | TextAttributes.UNDERLINE,
            }
          : { ...chunk, text: chunk.text.slice(cuts[index], end) },
      )
      .filter((part) => part.text)
  })
}

/**
 * Styles session IDs in rendered markdown as links that `clickedSession` resolves. Pass it as the
 * `ref`: Solid calls refs before setting content, so every block Markdown creates picks it up.
 */
export function linkSessions(markdown: MarkdownRenderable) {
  // Replacing the shared callback, rather than wrapping each block's, keeps OpenTUI's identity
  // check that refreshes link styling when terminal capabilities arrive.
  // oxlint-disable-next-line no-restricted-globals -- OpenTUI has no public option for the markdown chunk callback.
  Reflect.set(markdown, "_linkifyMarkdownChunks", linkChunks)
}

/** Returns the session ID under a plain left click on text styled by `linkSessions`. */
export function clickedSession(renderer: CliRenderer, event: MouseEvent) {
  const target = event.target
  if (!plainClick(renderer, event) || !(target instanceof CodeRenderable) || target.onChunks !== linkChunks) return
  // Concealed markdown markers are absent from plainText, so map the cell through the wrapped
  // layout: rows report display columns, and a logical line starts on its row with wrap index 0.
  const info = target.lineInfo
  const row = event.y - target.y
  const line = info.lineSources[row]
  if (line === undefined) return
  const column = info.lineStartCols[row]! - info.lineStartCols[row - info.lineWraps[row]!]! + event.x - target.x
  const text = target.plainText.split("\n")[line]!
  return sessionMentions(text).find((mention) => {
    const start = stringWidth(text.slice(0, mention.start))
    return column >= start && column < start + mention.text.length
  })?.id
}
