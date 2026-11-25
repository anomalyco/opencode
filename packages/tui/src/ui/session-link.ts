import { TextAttributes, type MarkdownInlineHook, type MarkdownRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, untrack } from "solid-js"
import { parseSessionMention, sessionMentions } from "@opencode/util/session-mention"
import { displayLabel } from "@opencode/util/session-title-fallback"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useDialog } from "./dialog"
import { plainClick } from "./link"

/**
 * Returns a `<markdown>` ref that shows session IDs as links titled after their sessions and
 * opens them on click, like the web app. The current session, archived sessions and sessions
 * that cannot be loaded stay plain IDs. Links re-render when a label changes.
 */
export function useSessionLinks() {
  const data = useData()
  const route = useRoute()
  const dialog = useDialog()
  const renderer = useRenderer()
  const labelOf = (sessionID: string) => {
    if (route.data.type === "session" && route.data.sessionID === sessionID) return
    const session = data.session.get(sessionID)
    // Sync dedupes in-flight and finished loads; a miss marks the session missing.
    if (!session && !data.session.missing(sessionID))
      untrack(() => void data.session.sync(sessionID).catch(() => undefined))
    return session && session.time.archived === undefined ? displayLabel(session) : undefined
  }
  // Labels each ID was last rendered with, so the effect below re-renders only on a change.
  const used = new Map<string, string | undefined>()
  const [version, setVersion] = createSignal(0)
  let markdown: MarkdownRenderable | undefined

  // Markdown runs this on every paragraph and heading that holds "ses_"; fenced code never gets it.
  const linkSpans: MarkdownInlineHook = (spans, context) => {
    if (context.tableCell) return spans
    const style = context.syntaxStyle.mergeStyles("markup.link.url")
    return spans.flatMap((span) => {
      // Like the web app, a code span links only when it is exactly a session ID, so a command such
      // as `opencode --session ses_…` stays copyable.
      if (span.link || (span.code && !parseSessionMention(span.text.replace(/^`+\s?|\s?`+$/g, "")))) return [span]
      const mentions = sessionMentions(span.text)
      if (mentions.length === 0) return [span]
      // Odd parts are the mentions.
      const cuts = [0, ...mentions.flatMap((mention) => [mention.start, mention.end]), span.text.length]
      return cuts.slice(1).flatMap((end, index) => {
        const text = span.text.slice(cuts[index], end)
        const mention = index % 2 ? mentions[(index - 1) / 2]! : undefined
        const label = mention && labelOf(mention.id)
        if (mention && (!used.has(mention.id) || used.get(mention.id) !== label)) {
          used.set(mention.id, label)
          setVersion((value) => value + 1)
        }
        if (!mention || label === undefined) return text ? [{ ...span, text }] : []
        return [
          {
            ...span,
            // Raw markdown mode shows the source.
            text: context.conceal ? `@${label}` : text,
            fg: style.fg ?? span.fg,
            attributes: style.attributes | TextAttributes.UNDERLINE,
            target: mention.id,
          },
        ]
      })
    })
  }

  createEffect(() => {
    version()
    const changed = [...used].flatMap(([sessionID, label]) => (labelOf(sessionID) === label ? [] : [sessionID]))
    if (!markdown || changed.length === 0) return
    changed.forEach((sessionID) => used.set(sessionID, labelOf(sessionID)))
    // Only blocks that mention a changed session run the hook again; nothing is parsed again.
    untrack(() => markdown!.rerunInlineHook((source) => changed.some((sessionID) => source.includes(sessionID))))
  })

  // Solid calls refs before setting content, so the first parse already runs the hook.
  return (renderable: MarkdownRenderable) => {
    markdown = renderable
    renderable.inlineHook = linkSpans
    renderable.inlineHookFilter = ["ses_"]
    renderable.onMouseUp = (event) => {
      if (!plainClick(renderer, event)) return
      const sessionID = renderable.targetAt(event.x, event.y)
      if (!sessionID) return
      event.stopPropagation()
      if (dialog.stack.length > 0) dialog.clear()
      route.navigate({ type: "session", sessionID })
    }
  }
}
