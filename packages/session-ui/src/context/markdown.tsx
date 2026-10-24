import { createContext, useContext, type ParentProps } from "solid-js"

export type ReadMarkdownImage = (path: string, signal: AbortSignal) => Promise<Blob | undefined>

/** Open a local file path linked from markdown. The path is decoded and may be relative or absolute. */
export type OpenMarkdownLocalFile = (path: string) => void

/**
 * Whether an inline-code path names a file that exists. Inline code is styled as a file link only when this says yes;
 * without it, inline code stays plain.
 */
export type MarkdownLocalFileExists = (path: string) => boolean | Promise<boolean>

/** Reactively resolve a referenced session's display title, or undefined while unknown or unavailable. */
export type MarkdownSessionTitle = (sessionID: string) => string | undefined

const context = createContext<{
  readonly readImage?: ReadMarkdownImage
  readonly openLocalFile?: OpenMarkdownLocalFile
  readonly localFileExists?: MarkdownLocalFileExists
  readonly openSession?: (sessionID: string) => void
  readonly sessionTitle?: MarkdownSessionTitle
}>()

export function MarkdownProvider(
  props: ParentProps<{
    readImage?: ReadMarkdownImage
    openLocalFile?: OpenMarkdownLocalFile
    localFileExists?: MarkdownLocalFileExists
    openSession?: (id: string) => void
    sessionTitle?: MarkdownSessionTitle
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
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useMarkdown = () => useContext(context)
