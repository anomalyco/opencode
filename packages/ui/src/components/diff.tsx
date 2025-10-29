import {
  type FileContents,
  FileDiff,
  type DiffLineAnnotation,
  type HunkData,
  DiffFileRendererOptions,
  // registerCustomTheme,
} from "@pierre/precision-diffs"
import { ComponentProps, createEffect, splitProps } from "solid-js"

export type DiffProps<T = {}> = Omit<DiffFileRendererOptions<T>, "themes"> & {
  before: FileContents
  after: FileContents
  annotations?: DiffLineAnnotation<T>[]
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

// registerCustomTheme("opencode", () => import("./theme.json"))

// interface ThreadMetadata {
//   threadId: string
// }

export function Diff<T>(props: DiffProps<T>) {
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, [
    "before",
    "after",
    "class",
    "classList",
    "annotations",
  ])

  // const lineAnnotations: DiffLineAnnotation<ThreadMetadata>[] = [
  //   {
  //     side: "additions",
  //     // The line number specified for an annotation is the visual line number
  //     // you see in the number column of a diff
  //     lineNumber: 16,
  //     metadata: { threadId: "68b329da9893e34099c7d8ad5cb9c940" },
  //   },
  // ]

  // If you ever want to update the options for an instance, simple call
  // 'setOptions' with the new options. Bear in mind, this does NOT merge
  // existing properties, it's a full replace
  // instance.setOptions({
  //   ...instance.options,
  //   theme: "pierre-dark",
  //   themes: undefined,
  // })

  // When ready to render, simply call .render with old/new file, optional
  // annotations and a container element to hold the diff
  createEffect(() => {
    const instance = new FileDiff<T>({
      theme: "pierre-light",
      // Or can also provide a 'themes' prop, which allows the code to adapt
      // to your OS light or dark theme
      // themes: { dark: 'pierre-night', light: 'pierre-light' },
      // When using the 'themes' prop, 'themeType' allows you to force 'dark'
      // or 'light' theme, or inherit from the OS ('system') theme.
      themeType: "system",
      // Disable the line numbers for your diffs, generally not recommended
      disableLineNumbers: false,
      // Whether code should 'wrap' with long lines or 'scroll'.
      overflow: "scroll",
      // Normally you shouldn't need this prop, but if you don't provide a
      // valid filename or your file doesn't have an extension you may want to
      // override the automatic detection. You can specify that language here:
      // https://shiki.style/languages
      // lang?: SupportedLanguages;
      // 'diffStyle' controls whether the diff is presented side by side or
      // in a unified (single column) view
      diffStyle: "unified",
      // Line decorators to help highlight changes.
      // 'bars' (default):
      // Shows some red-ish or green-ish (theme dependent) bars on the left
      // edge of relevant lines
      //
      // 'classic':
      // shows '+' characters on additions and '-' characters on deletions
      //
      // 'none':
      // No special diff indicators are shown
      diffIndicators: "bars",
      // By default green-ish or red-ish background are shown on added and
      // deleted lines respectively. Disable that feature here
      disableBackground: false,
      // Diffs are split up into hunks, this setting customizes what to show
      // between each hunk.
      //
      // 'line-info' (default):
      // Shows a bar that tells you how many lines are collapsed. If you are
      // using the oldFile/newFile API then you can click those bars to
      // expand the content between them
      //
      // 'metadata':
      // Shows the content you'd see in a normal patch file, usually in some
      // format like '@@ -60,6 +60,22 @@'. You cannot use these to expand
      // hidden content
      //
      // 'simple':
      // Just a subtle bar separator between each hunk
      // hunkSeparators: "line-info",
      hunkSeparators(hunkData: HunkData) {
        const fragment = document.createDocumentFragment()
        const numCol = document.createElement("div")
        numCol.innerHTML = `<svg data-slot="diff-hunk-separator-line-number-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.97978 14.0204L8.62623 13.6668L9.33334 12.9597L9.68689 13.3133L9.33333 13.6668L8.97978 14.0204ZM12 16.3335L12.3535 16.6871L12 17.0406L11.6464 16.687L12 16.3335ZM14.3131 13.3133L14.6667 12.9597L15.3738 13.6668L15.0202 14.0204L14.6667 13.6668L14.3131 13.3133ZM12.5 16.0002V16.5002H11.5V16.0002H12H12.5ZM9.33333 13.6668L9.68689 13.3133L12.3535 15.9799L12 16.3335L11.6464 16.687L8.97978 14.0204L9.33333 13.6668ZM12 16.3335L11.6464 15.9799L14.3131 13.3133L14.6667 13.6668L15.0202 14.0204L12.3535 16.6871L12 16.3335ZM6.5 8.00016V7.50016H8.5V8.00016V8.50016H6.5V8.00016ZM9.5 8.00016V7.50016H11.5V8.00016V8.50016H9.5V8.00016ZM12.5 8.00016V7.50016H14.5V8.00016V8.50016H12.5V8.00016ZM15.5 8.00016V7.50016H17.5V8.00016V8.50016H15.5V8.00016ZM12 10.5002H12.5V16.0002H12H11.5V10.5002H12Z" fill="currentColor"/></svg> `
        numCol.dataset["slot"] = "diff-hunk-separator-line-number"
        fragment.appendChild(numCol)
        const contentCol = document.createElement("div")
        contentCol.textContent = `${hunkData.lines} unmodified lines`
        contentCol.dataset["slot"] = "diff-hunk-separator-content"
        fragment.appendChild(contentCol)
        return fragment
      },
      // On lines that have both additions and deletions, we can run a
      // separate diff check to mark parts of the lines that change.
      // 'none':
      // Do not show these secondary highlights
      //
      // 'char':
      // Show changes at a per character granularity
      //
      // 'word':
      // Show changes but rounded up to word boundaries
      //
      // 'word-alt' (default):
      // Similar to 'word', however we attempt to minimize single character
      // gaps between highlighted changes
      lineDiffType: "word-alt",
      // If lines exceed these character lengths then we won't perform the
      // line lineDiffType check
      maxLineDiffLength: 1000,
      // If any line in the diff exceeds this value then we won't attempt to
      // syntax highlight the diff
      maxLineLengthForHighlighting: 1000,
      // Enabling this property will hide the file header with file name and
      // diff stats.
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
    })

    instance.render({
      oldFile: local.before,
      newFile: local.after,
      lineAnnotations: local.annotations,
      containerWrapper: container,
    })
  })

  return (
    <div
      data-component="diff"
      style={{
        "--pjs-font-family": "var(--font-family-mono)",
        "--pjs-font-size": "var(--font-size-small)",
        "--pjs-line-height": "24px",
        "--pjs-tab-size": 4,
        "--pjs-font-features": "var(--font-family-mono--font-feature-settings)",
        "--pjs-header-font-family": "var(--font-family-sans)",
        "--pjs-gap-block": 0,
      }}
      ref={container}
    />
  )
}
