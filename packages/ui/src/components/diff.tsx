import {
  type FileContents,
  FileDiff,
  type DiffLineAnnotation,
  type HunkData,
  FileDiffOptions,
  registerCustomTheme,
  ThemeRegistrationResolved,
} from "@pierre/precision-diffs"
import { ComponentProps, createEffect, splitProps } from "solid-js"

export type DiffProps<T = {}> = FileDiffOptions<T> & {
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
  const [local, others] = splitProps(props, ["before", "after", "class", "classList", "annotations"])

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
  //

  // When ready to render, simply call .render with old/new file, optional
  // annotations and a container element to hold the diff
  createEffect(() => {
    const instance = new FileDiff<T>({
      theme: "OpenCode",
      // When using the 'themes' prop, 'themeType' allows you to force 'dark'
      // or 'light' theme, or inherit from the OS ('system') theme.
      themeType: "system",
      // Disable the line numbers for your diffs, generally not recommended
      disableLineNumbers: false,
      // Whether code should 'wrap' with long lines or 'scroll'.
      overflow: "wrap",
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
        contentCol.dataset["slot"] = "diff-hunk-separator-content"
        const span = document.createElement("span")
        span.dataset["slot"] = "diff-hunk-separator-content-span"
        span.textContent = `${hunkData.lines} unmodified lines`
        contentCol.appendChild(span)
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

    container.innerHTML = ""
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
        "--pjs-tab-size": 2,
        "--pjs-font-features": "var(--font-family-mono--font-feature-settings)",
        "--pjs-header-font-family": "var(--font-family-sans)",
        "--pjs-gap-block": 0,
        "--pjs-min-number-column-width": "4ch",
      }}
      ref={container}
    />
  )
}

registerCustomTheme("OpenCode", () => {
  return Promise.resolve({
    name: "OpenCode",
    colors: {
      "editor.background": "transparent",
      "editor.foreground": "var(--text-base)",
      "gitDecoration.addedResourceForeground": "var(--syntax-diff-add)",
      "gitDecoration.deletedResourceForeground": "var(--syntax-diff-delete)",
      // "gitDecoration.conflictingResourceForeground": "#ffca00",
      // "gitDecoration.modifiedResourceForeground": "#1a76d4",
      // "gitDecoration.untrackedResourceForeground": "#00cab1",
      // "gitDecoration.ignoredResourceForeground": "#84848A",
      // "terminal.titleForeground": "#adadb1",
      // "terminal.titleInactiveForeground": "#84848A",
      // "terminal.background": "#141415",
      // "terminal.foreground": "#adadb1",
      // "terminal.ansiBlack": "#141415",
      // "terminal.ansiRed": "#ff2e3f",
      // "terminal.ansiGreen": "#0dbe4e",
      // "terminal.ansiYellow": "#ffca00",
      // "terminal.ansiBlue": "#008cff",
      // "terminal.ansiMagenta": "#c635e4",
      // "terminal.ansiCyan": "#08c0ef",
      // "terminal.ansiWhite": "#c6c6c8",
      // "terminal.ansiBrightBlack": "#141415",
      // "terminal.ansiBrightRed": "#ff2e3f",
      // "terminal.ansiBrightGreen": "#0dbe4e",
      // "terminal.ansiBrightYellow": "#ffca00",
      // "terminal.ansiBrightBlue": "#008cff",
      // "terminal.ansiBrightMagenta": "#c635e4",
      // "terminal.ansiBrightCyan": "#08c0ef",
      // "terminal.ansiBrightWhite": "#c6c6c8",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: {
          foreground: "var(--syntax-comment)",
        },
      },
      {
        scope: ["entity.other.attribute-name"],
        settings: {
          foreground: "var(--syntax-property)", // maybe attribute
        },
      },
      {
        scope: ["constant", "entity.name.constant", "variable.other.constant", "variable.language", "entity"],
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: ["entity.name", "meta.export.default", "meta.definition.variable"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: ["meta.object.member"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "variable.parameter.function",
          "meta.jsx.children",
          "meta.block",
          "meta.tag.attributes",
          "entity.name.constant",
          "meta.embedded.expression",
          "meta.template.expression",
          "string.other.begin.yaml",
          "string.other.end.yaml",
        ],
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["entity.name.function", "support.type.primitive"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.class.component"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: [
          "keyword.operator",
          "storage.type.function.arrow",
          "punctuation.separator.key-value.css",
          "entity.name.tag.yaml",
          "punctuation.separator.key-value.mapping.yaml",
        ],
        settings: {
          foreground: "var(--syntax-operator)",
        },
      },
      {
        scope: ["storage", "storage.type"],
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: ["storage.modifier.package", "storage.modifier.import", "storage.type.java"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "string",
          "punctuation.definition.string",
          "string punctuation.section.embedded source",
          "entity.name.tag",
        ],
        settings: {
          foreground: "var(--syntax-string)",
        },
      },
      {
        scope: "support",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.type.object.module", "variable.other.object", "support.type.property-name.css"],
        settings: {
          foreground: "var(--syntax-object)",
        },
      },
      {
        scope: "meta.property-name",
        settings: {
          foreground: "var(--syntax-property)",
        },
      },
      {
        scope: "variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "variable.other",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: [
          "invalid.broken",
          "invalid.illegal",
          "invalid.unimplemented",
          "invalid.deprecated",
          "message.error",
          "markup.deleted",
          "meta.diff.header.from-file",
          "punctuation.definition.deleted",
          "brackethighlighter.unmatched",
          "token.error-token",
        ],
        settings: {
          foreground: "var(--syntax-critical)",
        },
      },
      {
        scope: "carriage-return",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: "string source",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "string variable",
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: [
          "source.regexp",
          "string.regexp",
          "string.regexp.character-class",
          "string.regexp constant.character.escape",
          "string.regexp source.ruby.embedded",
          "string.regexp string.regexp.arbitrary-repitition",
          "string.regexp constant.character.escape",
        ],
        settings: {
          foreground: "var(--syntax-regexp)",
        },
      },
      {
        scope: "support.constant",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: "support.variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "meta.module-reference",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["markup.heading", "markup.heading entity.name"],
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.quote",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.italic",
        settings: {
          fontStyle: "italic",
          // foreground: "",
        },
      },
      {
        scope: "markup.bold",
        settings: {
          fontStyle: "bold",
          foreground: "var(--text-strong)",
        },
      },
      {
        scope: [
          "markup.raw",
          "markup.inserted",
          "meta.diff.header.to-file",
          "punctuation.definition.inserted",
          "markup.changed",
          "punctuation.definition.changed",
          "markup.ignored",
          "markup.untracked",
        ],
        settings: {
          foreground: "var(--text-base)",
        },
      },
      {
        scope: "meta.diff.range",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.diff.header",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.separator",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.output",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.export.default",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: [
          "brackethighlighter.tag",
          "brackethighlighter.curly",
          "brackethighlighter.round",
          "brackethighlighter.square",
          "brackethighlighter.angle",
          "brackethighlighter.quote",
        ],
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: ["constant.other.reference.link", "string.other.link"],
        settings: {
          fontStyle: "underline",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "var(--syntax-warning)",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
    ],
    semanticTokenColors: {
      comment: "var(--syntax-comment)",
      string: "var(--syntax-string)",
      number: "var(--syntax-constant)",
      regexp: "var(--syntax-regexp)",
      keyword: "var(--syntax-keyword)",
      variable: "var(--syntax-variable)",
      parameter: "var(--syntax-variable)",
      property: "var(--syntax-property)",
      function: "var(--syntax-primitive)",
      method: "var(--syntax-primitive)",
      type: "var(--syntax-type)",
      class: "var(--syntax-type)",
      namespace: "var(--syntax-type)",
      enumMember: "var(--syntax-primitive)",
      "variable.constant": "var(--syntax-constant)",
      "variable.defaultLibrary": "var(--syntax-unknown)",
    },
  } as unknown as ThemeRegistrationResolved)
})
