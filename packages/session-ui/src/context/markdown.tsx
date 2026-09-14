import { createContext, useContext, type ParentProps } from "solid-js"

export type ReadMarkdownImage = (path: string, signal: AbortSignal) => Promise<Blob | undefined>

const context = createContext<{ readonly readImage: ReadMarkdownImage }>()

export function MarkdownProvider(props: ParentProps<{ readImage: ReadMarkdownImage }>) {
  return (
    <context.Provider
      value={{
        get readImage() {
          return props.readImage
        },
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useMarkdown = () => useContext(context)
