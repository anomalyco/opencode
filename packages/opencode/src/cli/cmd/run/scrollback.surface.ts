// Retained streaming append logic for direct-mode scrollback.
//
// Static entries are rendered through `scrollback.writer.tsx`. This file only
// keeps the retained-surface machinery needed for streaming assistant,
// reasoning, and tool progress entries that need stable markdown/code layout
// while content is still arriving.
import {
  CodeRenderable,
  MarkdownRenderable,
  TextRenderable,
  getTreeSitterClient,
  type TreeSitterClient,
  type CliRenderer,
  type ScrollbackSurface,
} from "@opentui/core"
import { entryBody, entryCanStream, entryDone, entryFlags } from "./entry.body"
import { withRunSpan } from "./otel"
import { entryColor, entryLook, entrySyntax } from "./scrollback.shared"
import { entryWriter, sameEntryGroup, separatorRows, spacerWriter } from "./scrollback.writer"
import { type RunTheme } from "./theme"
import type { RunDiffStyle, RunEntryBody, StreamCommit } from "./types"

type ActiveBody = Exclude<RunEntryBody, { type: "none" | "structured" }>

type ActiveEntry = {
  body: ActiveBody
  commit: StreamCommit
  surface: ScrollbackSurface
  renderable: TextRenderable | CodeRenderable | MarkdownRenderable
  content: string
  committedRows: number
  committedBlocks: number
  pendingSpacerRows: number
  rendered: boolean
}

let nextId = 0

function commitMarkdownBlocks(input: {
  surface: ScrollbackSurface
  renderable: MarkdownRenderable
  startBlock: number
  endBlockExclusive: number
  trailingNewline: boolean
  beforeCommit?: () => void
}) {
  if (input.endBlockExclusive <= input.startBlock) {
    return false
  }

  const first = input.renderable._blockStates[input.startBlock]
  const last = input.renderable._blockStates[input.endBlockExclusive - 1]
  if (!first || !last) {
    return false
  }

  const next = input.renderable._blockStates[input.endBlockExclusive]
  const start = first.renderable.y
  const end = next ? next.renderable.y : last.renderable.y + last.renderable.height

  input.beforeCommit?.()
  input.surface.commitRows(start, end, {
    trailingNewline: input.trailingNewline,
  })
  return true
}

function staticBody(commit: StreamCommit, body: RunEntryBody, spaced: number): RunEntryBody {
  if (spaced === 0 || body.type !== "text") {
    return body
  }

  if (commit.kind !== "tool" || commit.phase !== "progress" || commit.toolState !== "completed") {
    return body
  }

  if (!body.content.startsWith("\n")) {
    return body
  }

  return {
    ...body,
    content: body.content.replace(/^\n/, ""),
  }
}

export class RunScrollbackStream {
  private tail: StreamCommit | undefined
  private rendered: StreamCommit | undefined
  private active: ActiveEntry | undefined
  private diffStyle: RunDiffStyle | undefined
  private sessionID?: () => string | undefined
  private treeSitterClient: TreeSitterClient | undefined
  private wrote: boolean

  constructor(
    private renderer: CliRenderer,
    private theme: RunTheme,
    options: {
      wrote?: boolean
      diffStyle?: RunDiffStyle
      sessionID?: () => string | undefined
      treeSitterClient?: TreeSitterClient
    } = {},
  ) {
    this.diffStyle = options.diffStyle
    this.sessionID = options.sessionID
    this.treeSitterClient = options.treeSitterClient ?? getTreeSitterClient()
    this.wrote = options.wrote ?? false
  }

  private createEntry(commit: StreamCommit, body: ActiveBody): ActiveEntry {
    const surface = this.renderer.createScrollbackSurface({
      startOnNewLine: entryFlags(commit).startOnNewLine,
    })
    const id = `run-scrollback-entry-${nextId++}`
    const style = entryLook(commit, this.theme.entry)
    const renderable =
      body.type === "text"
        ? new TextRenderable(surface.renderContext, {
            id,
            content: "",
            width: "100%",
            wrapMode: "word",
            fg: style.fg,
            attributes: style.attrs,
          })
        : body.type === "code"
          ? new CodeRenderable(surface.renderContext, {
              id,
              content: "",
              filetype: body.filetype,
              syntaxStyle: entrySyntax(commit, this.theme),
              width: "100%",
              wrapMode: "word",
              drawUnstyledText: false,
              streaming: true,
              fg: entryColor(commit, this.theme),
              treeSitterClient: this.treeSitterClient,
            })
          : new MarkdownRenderable(surface.renderContext, {
              id,
              content: "",
              syntaxStyle: entrySyntax(commit, this.theme),
              width: "100%",
              streaming: true,
              internalBlockMode: "top-level",
              tableOptions: { widthMode: "content" },
              fg: entryColor(commit, this.theme),
              treeSitterClient: this.treeSitterClient,
            })

    surface.root.add(renderable)

    const rows = separatorRows(this.rendered, commit, body)

    return {
      body,
      commit,
      surface,
      renderable,
      content: "",
      committedRows: 0,
      committedBlocks: 0,
      pendingSpacerRows: rows || (!this.rendered && this.wrote ? 1 : 0),
      rendered: false,
    }
  }

  private markRendered(commit: StreamCommit | undefined): void {
    if (!commit) {
      return
    }

    this.rendered = commit
  }

  private writeSpacer(rows: number): void {
    if (rows === 0) {
      return
    }

    this.renderer.writeToScrollback(spacerWriter())
    this.wrote = false
  }

  private flushPendingSpacer(active: ActiveEntry): void {
    this.writeSpacer(active.pendingSpacerRows)
    active.pendingSpacerRows = 0
  }

  private async flushActive(done: boolean, trailingNewline: boolean): Promise<boolean> {
    const active = this.active
    if (!active) {
      return false
    }

    if (active.body.type === "text") {
      if (!(active.renderable instanceof TextRenderable)) {
        return false
      }

      const renderable = active.renderable
      renderable.content = active.content
      active.surface.render()
      const targetRows = done ? active.surface.height : Math.max(active.committedRows, active.surface.height - 1)
      if (targetRows <= active.committedRows) {
        return false
      }

      this.flushPendingSpacer(active)
      active.surface.commitRows(active.committedRows, targetRows, {
        trailingNewline: done && targetRows === active.surface.height ? trailingNewline : false,
      })
      active.committedRows = targetRows
      active.rendered = true
      return true
    }

    if (active.body.type === "code") {
      if (!(active.renderable instanceof CodeRenderable)) {
        return false
      }

      const renderable = active.renderable
      renderable.content = active.content
      renderable.streaming = !done
      await active.surface.settle()
      const targetRows = done ? active.surface.height : Math.max(active.committedRows, active.surface.height - 1)
      if (targetRows <= active.committedRows) {
        return false
      }

      this.flushPendingSpacer(active)
      active.surface.commitRows(active.committedRows, targetRows, {
        trailingNewline: done && targetRows === active.surface.height ? trailingNewline : false,
      })
      active.committedRows = targetRows
      active.rendered = true
      return true
    }

    if (!(active.renderable instanceof MarkdownRenderable)) {
      return false
    }

    const renderable = active.renderable
    renderable.content = active.content
    renderable.streaming = !done
    await active.surface.settle()
    const targetBlockCount = done ? renderable._blockStates.length : renderable._stableBlockCount
    if (targetBlockCount <= active.committedBlocks) {
      return false
    }

    if (
      commitMarkdownBlocks({
        surface: active.surface,
        renderable,
        startBlock: active.committedBlocks,
        endBlockExclusive: targetBlockCount,
        trailingNewline: done && targetBlockCount === renderable._blockStates.length ? trailingNewline : false,
        beforeCommit: () => this.flushPendingSpacer(active),
      })
    ) {
      active.committedBlocks = targetBlockCount
      active.rendered = true
      return true
    }

    return false
  }

  private async finishActive(trailingNewline: boolean): Promise<StreamCommit | undefined> {
    if (!this.active) {
      return undefined
    }

    const active = this.active

    try {
      await this.flushActive(true, trailingNewline)
    } finally {
      if (this.active === active) {
        this.active = undefined
      }

      if (!active.surface.isDestroyed) {
        active.surface.destroy()
      }
    }

    return active.rendered ? active.commit : undefined
  }

  private async writeStreaming(commit: StreamCommit, body: ActiveBody): Promise<void> {
    if (!this.active || !sameEntryGroup(this.active.commit, commit) || this.active.body.type !== body.type) {
      this.markRendered(await this.finishActive(false))
      this.active = this.createEntry(commit, body)
    }

    this.active.body = body
    this.active.commit = commit
    this.active.content += body.content
    await this.flushActive(false, false)
    if (this.active.rendered) {
      this.markRendered(this.active.commit)
    }
  }

  public async append(commit: StreamCommit): Promise<void> {
    const same = sameEntryGroup(this.tail, commit)
    if (!same) {
      this.markRendered(await this.finishActive(false))
    }

    const body = entryBody(commit)
    if (body.type === "none") {
      if (entryDone(commit)) {
        this.markRendered(await this.finishActive(false))
      }

      this.tail = commit
      return
    }

    if (
      body.type !== "structured" &&
      (entryCanStream(commit, body) || (commit.kind === "tool" && commit.phase === "final" && body.type === "markdown"))
    ) {
      await this.writeStreaming(commit, body)
      if (entryDone(commit)) {
        this.markRendered(await this.finishActive(false))
      }
      this.tail = commit
      return
    }

    if (same) {
      this.markRendered(await this.finishActive(false))
    }

    const rows = separatorRows(this.rendered, commit, body)
    const spaced = rows || (!this.rendered && this.wrote ? 1 : 0)
    this.writeSpacer(spaced)

    this.renderer.writeToScrollback(
      entryWriter({
        commit,
        body: staticBody(commit, body, spaced),
        theme: this.theme,
        opts: {
          diffStyle: this.diffStyle,
        },
      }),
    )
    this.markRendered(commit)
    this.tail = commit
  }

  private resetActive(): void {
    if (!this.active) {
      return
    }

    if (!this.active.surface.isDestroyed) {
      this.active.surface.destroy()
    }

    this.active = undefined
  }

  public async complete(trailingNewline = false): Promise<void> {
    return withRunSpan(
      "RunScrollbackStream.complete",
      {
        "opencode.entry.active": !!this.active,
        "opencode.trailing_newline": trailingNewline,
        "session.id": this.sessionID?.() || undefined,
      },
      async () => {
        this.markRendered(await this.finishActive(trailingNewline))
      },
    )
  }

  public destroy(): void {
    this.resetActive()
  }
}
