import { type FileContents, FileDiff, type DiffLineAnnotation, FileDiffOptions } from "@pierre/precision-diffs"
import { PreloadMultiFileDiffResult } from "@pierre/precision-diffs/ssr"
import { ComponentProps, createEffect, onCleanup, onMount, splitProps } from "solid-js"
import { isServer } from "solid-js/web"

export type DiffProps<T = {}> = FileDiffOptions<T> & {
  preloadedDiff?: PreloadMultiFileDiffResult<T>
  before: FileContents
  after: FileContents
  annotations?: DiffLineAnnotation<T>[]
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

// interface ThreadMetadata {
//   threadId: string
// }

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  let fileDiffRef!: HTMLElement
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])

  let fileDiffInstance: FileDiff<T> | undefined
  const cleanupFunctions: Array<() => void> = []

  createEffect(() => {
    // Create FileDiff instance and connect to existing server-rendered DOM.
    // Don't call hydrate() - that would re-render content and cause duplication.
    // Instead, just set the fileContainer reference to attach event handlers.
    if (props.preloadedDiff) return
    container.innerHTML = ""
    if (!fileDiffInstance) {
      fileDiffInstance = new FileDiff<T>({
        theme: "OpenCode",
        themeType: "system",
        disableLineNumbers: false,
        overflow: "wrap",
        diffStyle: "unified",
        diffIndicators: "bars",
        disableBackground: false,
        expansionLineCount: 20,
        lineDiffType: "word-alt",
        maxLineDiffLength: 1000,
        maxLineLengthForHighlighting: 1000,
        disableFileHeader: true,
        // You can optionally pass a render function for rendering out line
        // annotations.  Just return the dom node to render
        // renderAnnotation(annotation: DiffLineAnnotation<T>): HTMLElement {
        //   // Despite the diff itself being rendered in the shadow dom,
        //   // annotations are inserted via the web components 'slots' api and you
        //   // can use all your normal normal css and styling for them
        //   const element = document.createElement("div")
        //   element.innerText = annotation.metadata.threadId
        //   return element
        // },
        ...others,
        ...(props.preloadedDiff ?? {}),
      })
    }
    fileDiffInstance?.render({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  onMount(() => {
    if (isServer) return

    fileDiffInstance = new FileDiff<T>({
      theme: "OpenCode",
      themeType: "system",
      disableLineNumbers: false,
      overflow: "wrap",
      diffStyle: "unified",
      diffIndicators: "bars",
      disableBackground: false,
      expansionLineCount: 20,
      lineDiffType: "word-alt",
      maxLineDiffLength: 1000,
      maxLineLengthForHighlighting: 1000,
      disableFileHeader: true,
      // You can optionally pass a render function for rendering out line
      // annotations.  Just return the dom node to render
      // renderAnnotation(annotation: DiffLineAnnotation<T>): HTMLElement {
      //   // Despite the diff itself being rendered in the shadow dom,
      //   // annotations are inserted via the web components 'slots' api and you
      //   // can use all your normal normal css and styling for them
      //   const element = document.createElement("div")
      //   element.innerText = annotation.metadata.threadId
      //   return element
      // },
      ...others,
      ...(props.preloadedDiff ?? {}),
    })
    // @ts-expect-error - fileContainer is private but needed for SSR hydration
    fileDiffInstance.fileContainer = fileDiffRef

    // Hydrate annotation slots with interactive SolidJS components
    // if (props.annotations.length > 0 && props.renderAnnotation != null) {
    //   for (const annotation of props.annotations) {
    //     const slotName = `annotation-${annotation.side}-${annotation.lineNumber}`;
    //     const slotElement = fileDiffRef.querySelector(
    //       `[slot="${slotName}"]`
    //     ) as HTMLElement;
    //
    //     if (slotElement != null) {
    //       // Clear the static server-rendered content from the slot
    //       slotElement.innerHTML = '';
    //
    //       // Mount a fresh SolidJS component into this slot using render().
    //       // This enables full SolidJS reactivity (signals, effects, etc.)
    //       const dispose = render(
    //         () => props.renderAnnotation!(annotation),
    //         slotElement
    //       );
    //       cleanupFunctions.push(dispose);
    //     }
    //   }
    // }
  })

  onCleanup(() => {
    // Clean up FileDiff event handlers and dispose SolidJS components
    fileDiffInstance?.cleanUp()
    cleanupFunctions.forEach((dispose) => dispose())
  })

  return (
    <div
      data-component="diff"
      style={{
        "--pjs-font-family": "var(--font-family-mono)",
        "--pjs-font-size": "var(--font-size-small)",
        "--pjs-line-height": "24px",
        "--pjs-tab-size": 2,
        "--pjs-font-features": "var(--font-family-mono--font-feature-settings)",
        "--pjs-header-font-family": "var(--font-family-sans)",
        "--pjs-gap-block": 0,
        "--pjs-min-number-column-width": "4ch",
      }}
      ref={container}
    >
      <file-diff ref={fileDiffRef} id="ssr-diff">
        {/* Only render on server - client hydrates the existing content */}
        {isServer && props.preloadedDiff && (
          <>
            {/* Declarative Shadow DOM - browsers parse this and create a shadow root */}
            <template shadowrootmode="open">
              <div innerHTML={props.preloadedDiff!.prerenderedHTML} />
            </template>
            {/* Render static annotation slots on server.
                Client will clear these and mount interactive components. */}
            {/* <For each={props.annotations}> */}
            {/*   {(annotation) => { */}
            {/*     const slotName = `annotation-${annotation.side}-${annotation.lineNumber}` */}
            {/*     return <div slot={slotName}>{props.renderAnnotation?.(annotation)}</div> */}
            {/*   }} */}
            {/* </For> */}
          </>
        )}
      </file-diff>
    </div>
  )
}
