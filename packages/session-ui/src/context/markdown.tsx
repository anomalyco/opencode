import type { IconName } from "@opencode/ui/icons/catalog"
import { createContext, useContext, type ParentProps } from "solid-js"
import type { SessionReferenceMenu } from "../components/markdown-session-links"

export type ReadMarkdownImage = (path: string, signal: AbortSignal) => Promise<Blob | undefined>

/** Open a local file path linked from markdown. The path is decoded and may be relative or absolute. */
export type OpenMarkdownLocalFile = (path: string) => void

/**
 * Whether an inline-code path names a file that exists. Inline code is styled as a file link only when this says yes;
 * without it, inline code stays plain.
 */
export type MarkdownLocalFileExists = (path: string) => boolean | Promise<boolean>

/** A complete fenced code block, as `MarkdownCodeBlocks` receives it. */
export type MarkdownCodeBlock = {
  /** The source between the fences, without the final line break. */
  readonly code: string
  /** The first word of the fence's info string, lowercased, e.g. `mermaid`. Empty without one. */
  readonly language: string
}

/** The languages that have content of their own; a new object whenever a block's content may change. */
export type MarkdownCodeBlockMatch = {
  /** Languages whose blocks `render` replaces once complete. */
  readonly render: ReadonlySet<string>
  /** Languages whose blocks get `actions` beside Copy once complete. */
  readonly actions: ReadonlySet<string>
}

/** A button beside a code block's Copy button. */
export type MarkdownCodeAction = {
  /** The button's icon. */
  readonly icon: IconName
  /** The accessible name and tooltip. */
  readonly title: string
  /** Runs when the user clicks the button. */
  run(block: MarkdownCodeBlock): void
}

/**
 * Content for fenced code blocks in place of the highlighted code, and buttons beside Copy. Markdown asks only for blocks
 * whose language `current` lists, and only once the closing fence arrived; every other block costs a set lookup.
 */
export type MarkdownCodeBlocks = {
  /** The languages with content. Reactive: markdown decorates its blocks again when it returns a new object. */
  readonly current: () => MarkdownCodeBlockMatch
  /**
   * Mounts content for a block into `target`. Returns the content's dispose, or undefined to keep the code. Calls
   * `fallback` when the content fails later; markdown then shows the code again.
   */
  readonly render: (target: HTMLElement, block: MarkdownCodeBlock, fallback: () => void) => (() => void) | undefined
  /** The buttons for a language, in order. Reactive. */
  readonly actions: (language: string) => readonly MarkdownCodeAction[]
}

const context = createContext<{
  readonly readImage?: ReadMarkdownImage
  readonly openLocalFile?: OpenMarkdownLocalFile
  readonly localFileExists?: MarkdownLocalFileExists
  readonly openSession?: (sessionID: string) => void
  readonly sessionTitle?: (sessionID: string) => string | undefined
  readonly sessionMenu?: SessionReferenceMenu
  readonly codeBlocks?: MarkdownCodeBlocks
}>()

export function MarkdownProvider(
  props: ParentProps<{
    readImage?: ReadMarkdownImage
    openLocalFile?: OpenMarkdownLocalFile
    localFileExists?: MarkdownLocalFileExists
    openSession?: (id: string) => void
    sessionTitle?: (id: string) => string | undefined
    sessionMenu?: SessionReferenceMenu
    /** Content for code blocks; inherited when omitted. `false` turns it off below, e.g. inside such content. */
    codeBlocks?: MarkdownCodeBlocks | false
  }>,
) {
  const parent = useMarkdown()

  return (
    <context.Provider
      value={{
        get readImage() {
          return props.readImage
        },
        get openLocalFile() {
          return props.openLocalFile
        },
        get localFileExists() {
          return props.localFileExists ?? parent?.localFileExists
        },
        get openSession() {
          return props.openSession ?? parent?.openSession
        },
        get sessionTitle() {
          return props.sessionTitle ?? parent?.sessionTitle
        },
        get sessionMenu() {
          return props.sessionMenu ?? parent?.sessionMenu
        },
        get codeBlocks() {
          if (props.codeBlocks === false) return undefined

          return props.codeBlocks ?? parent?.codeBlocks
        },
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useMarkdown = () => useContext(context)

/** Provides markdown handlers as they are, e.g. the ones a detached view keeps while another Location is selected. */
export const MarkdownContext = context
