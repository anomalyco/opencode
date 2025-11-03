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
  //

  // When ready to render, simply call .render with old/new file, optional
  // annotations and a container element to hold the diff
  createEffect(() => {
    const instance = new FileDiff<T>({
      // theme: "pierre-light",
      theme: { dark: "oc-1-dark", light: "oc-1-light" },
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
      }}
      ref={container}
    />
  )
}

registerCustomTheme("oc-1-light", () => {
  return Promise.resolve({
    name: "oc-1-light",
    type: "light",
    colors: {
      "editor.background": "transparent",
      "editor.foreground": "#070707",
      foreground: "#070707",
      focusBorder: "#008cff",
      "selection.background": "#dfe7ff",
      "editor.selectionBackground": "#008cff2e",
      "editor.lineHighlightBackground": "#dfe7ff8c",
      "editorCursor.foreground": "#008cff",
      "editorLineNumber.foreground": "#84848A",
      "editorLineNumber.activeForeground": "#6C6C71",
      "editorIndentGuide.background": "#eeeeef",
      "editorIndentGuide.activeBackground": "#dbdbdd",
      "diffEditor.insertedTextBackground": "#00cab133",
      "diffEditor.deletedTextBackground": "#ff2e3f33",
      "sideBar.background": "#f8f8f8",
      "sideBar.foreground": "#6C6C71",
      "sideBar.border": "#eeeeef",
      "sideBarTitle.foreground": "#070707",
      "sideBarSectionHeader.background": "#f8f8f8",
      "sideBarSectionHeader.foreground": "#6C6C71",
      "sideBarSectionHeader.border": "#eeeeef",
      "activityBar.background": "#f8f8f8",
      "activityBar.foreground": "#070707",
      "activityBar.border": "#eeeeef",
      "activityBar.activeBorder": "#008cff",
      "activityBarBadge.background": "#008cff",
      "activityBarBadge.foreground": "#ffffff",
      "titleBar.activeBackground": "#f8f8f8",
      "titleBar.activeForeground": "#070707",
      "titleBar.inactiveBackground": "#f8f8f8",
      "titleBar.inactiveForeground": "#84848A",
      "titleBar.border": "#eeeeef",
      "list.activeSelectionBackground": "#dfe7ffcc",
      "list.activeSelectionForeground": "#070707",
      "list.inactiveSelectionBackground": "#dfe7ff73",
      "list.hoverBackground": "#dfe7ff59",
      "list.focusOutline": "#008cff",
      "tab.activeBackground": "#ffffff",
      "tab.activeForeground": "#070707",
      "tab.activeBorderTop": "#008cff",
      "tab.inactiveBackground": "#f8f8f8",
      "tab.inactiveForeground": "#84848A",
      "tab.border": "#eeeeef",
      "editorGroupHeader.tabsBackground": "#f8f8f8",
      "editorGroupHeader.tabsBorder": "#eeeeef",
      "panel.background": "#f8f8f8",
      "panel.border": "#eeeeef",
      "panelTitle.activeBorder": "#008cff",
      "panelTitle.activeForeground": "#070707",
      "panelTitle.inactiveForeground": "#84848A",
      "statusBar.background": "#f8f8f8",
      "statusBar.foreground": "#6C6C71",
      "statusBar.border": "#eeeeef",
      "statusBar.noFolderBackground": "#f8f8f8",
      "statusBar.debuggingBackground": "#ffca00",
      "statusBar.debuggingForeground": "#ffffff",
      "statusBarItem.remoteBackground": "#f8f8f8",
      "statusBarItem.remoteForeground": "#6C6C71",
      "input.background": "#f2f2f3",
      "input.border": "#dbdbdd",
      "input.foreground": "#070707",
      "input.placeholderForeground": "#8E8E95",
      "dropdown.background": "#f2f2f3",
      "dropdown.border": "#dbdbdd",
      "dropdown.foreground": "#070707",
      "button.background": "#008cff",
      "button.foreground": "#ffffff",
      "button.hoverBackground": "#1a98ff",
      "textLink.foreground": "#008cff",
      "textLink.activeForeground": "#008cff",
      "gitDecoration.addedResourceForeground": "#00cab1",
      "gitDecoration.conflictingResourceForeground": "#ffca00",
      "gitDecoration.modifiedResourceForeground": "#008cff",
      "gitDecoration.deletedResourceForeground": "#ff2e3f",
      "gitDecoration.untrackedResourceForeground": "#00cab1",
      "gitDecoration.ignoredResourceForeground": "#84848A",
      "terminal.titleForeground": "#6C6C71",
      "terminal.titleInactiveForeground": "#84848A",
      "terminal.background": "#f8f8f8",
      "terminal.foreground": "#6C6C71",
      "terminal.ansiBlack": "#1F1F21",
      "terminal.ansiRed": "#ff2e3f",
      "terminal.ansiGreen": "#0dbe4e",
      "terminal.ansiYellow": "#ffca00",
      "terminal.ansiBlue": "#008cff",
      "terminal.ansiMagenta": "#c635e4",
      "terminal.ansiCyan": "#08c0ef",
      "terminal.ansiWhite": "#c6c6c8",
      "terminal.ansiBrightBlack": "#1F1F21",
      "terminal.ansiBrightRed": "#ff2e3f",
      "terminal.ansiBrightGreen": "#0dbe4e",
      "terminal.ansiBrightYellow": "#ffca00",
      "terminal.ansiBrightBlue": "#008cff",
      "terminal.ansiBrightMagenta": "#c635e4",
      "terminal.ansiBrightCyan": "#08c0ef",
      "terminal.ansiBrightWhite": "#c6c6c8",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: "comment markup.link",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: ["punctuation.definition.string.begin", "punctuation.definition.string.end"],
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#1ca1c7",
        },
      },
      {
        scope: "constant",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "punctuation.definition.constant",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "constant.language",
        settings: {
          foreground: "#1ca1c7",
        },
      },
      {
        scope: "variable.other.constant",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "keyword.control",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "token.storage",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: [
          "keyword.operator.new",
          "keyword.operator.expression.instanceof",
          "keyword.operator.expression.typeof",
          "keyword.operator.expression.void",
          "keyword.operator.expression.delete",
          "keyword.operator.expression.in",
          "keyword.operator.expression.of",
          "keyword.operator.expression.keyof",
        ],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "keyword.operator.delete",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["variable", "identifier", "meta.definition.variable"],
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: [
          "variable.other.readwrite",
          "meta.object-literal.key",
          "support.variable.property",
          "support.variable.object.process",
          "support.variable.object.node",
        ],
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: "variable.language",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "variable.parameter.function",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "function.parameter",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "variable.parameter",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "variable.parameter.function.language.python",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "variable.parameter.function.python",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.function",
          "meta.function-call",
          "meta.require",
          "support.function.any-method",
          "variable.function",
        ],
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "keyword.other.special-method",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "entity.name.function",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "support.function.console",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: ["support.type", "entity.name.type", "entity.name.class", "storage.type"],
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: ["support.class", "entity.name.type.class"],
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: ["entity.name.class", "variable.other.class.js", "variable.other.class.ts"],
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: "entity.name.class.identifier.namespace.type",
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: "entity.name.type.namespace",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "entity.other.inherited-class",
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: "entity.name.namespace",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "keyword.operator",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["keyword.operator.logical", "keyword.operator.bitwise", "keyword.operator.channel"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: [
          "keyword.operator.arithmetic",
          "keyword.operator.comparison",
          "keyword.operator.relational",
          "keyword.operator.increment",
          "keyword.operator.decrement",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.assignment",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.assignment.compound",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.compound.js",
          "keyword.operator.assignment.compound.ts",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.ternary",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "keyword.operator.optional",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "punctuation",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.separator.delimiter",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.separator.key-value",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.terminator",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.brace",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.brace.square",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.brace.round",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "function.brace",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["punctuation.definition.parameters", "punctuation.definition.typeparameters"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["punctuation.definition.block", "punctuation.definition.tag"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["meta.tag.tsx", "meta.tag.jsx", "meta.tag.js", "meta.tag.ts"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "keyword.operator.expression.import",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "keyword.operator.module",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "support.type.object.console",
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: ["support.module.node", "support.type.object.module", "entity.name.type.module"],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "support.constant.math",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "support.constant.property.math",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "support.constant.json",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "support.type.object.dom",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["support.variable.dom", "support.variable.property.dom"],
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: "support.variable.property.process",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "meta.property.object",
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: "variable.parameter.function.js",
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: ["keyword.other.template.begin", "keyword.other.template.end"],
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: ["keyword.other.substitution.begin", "keyword.other.substitution.end"],
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: [
          "punctuation.definition.template-expression.begin",
          "punctuation.definition.template-expression.end",
        ],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "meta.template.expression",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.section.embedded",
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: "variable.interpolation",
        settings: {
          foreground: "#d47628",
        },
      },
      {
        scope: ["punctuation.section.embedded.begin", "punctuation.section.embedded.end"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "punctuation.quasi.element",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: [
          "support.type.primitive.ts",
          "support.type.builtin.ts",
          "support.type.primitive.tsx",
          "support.type.builtin.tsx",
        ],
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: "support.type.type.flowtype",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "support.type.primitive",
        settings: {
          foreground: "#c635e4",
        },
      },
      {
        scope: "support.variable.magic.python",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "variable.parameter.function.language.special.self.python",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "punctuation.separator.period.python",
          "punctuation.separator.element.python",
          "punctuation.parenthesis.begin.python",
          "punctuation.parenthesis.end.python",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "punctuation.definition.arguments.begin.python",
          "punctuation.definition.arguments.end.python",
          "punctuation.separator.arguments.python",
          "punctuation.definition.list.begin.python",
          "punctuation.definition.list.end.python",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.type.python",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.logical.python",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "meta.function-call.generic.python",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "constant.character.format.placeholder.other.python",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "meta.function.decorator.python",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: ["support.token.decorator.python", "meta.function.decorator.identifier.python"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "storage.modifier.lifetime.rust",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.function.std.rust",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "entity.name.lifetime.rust",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "variable.language.rust",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "keyword.operator.misc.rust",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "keyword.operator.sigil.rust",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "support.constant.core.rust",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: ["meta.function.c", "meta.function.cpp"],
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.bracket.curly.cpp",
          "punctuation.section.block.end.bracket.curly.cpp",
          "punctuation.terminator.statement.c",
          "punctuation.section.block.begin.bracket.curly.c",
          "punctuation.section.block.end.bracket.curly.c",
          "punctuation.section.parens.begin.bracket.round.c",
          "punctuation.section.parens.end.bracket.round.c",
          "punctuation.section.parameters.begin.bracket.round.c",
          "punctuation.section.parameters.end.bracket.round.c",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.c",
          "keyword.operator.comparison.c",
          "keyword.operator.c",
          "keyword.operator.increment.c",
          "keyword.operator.decrement.c",
          "keyword.operator.bitwise.shift.c",
        ],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.cpp",
          "keyword.operator.comparison.cpp",
          "keyword.operator.cpp",
          "keyword.operator.increment.cpp",
          "keyword.operator.decrement.cpp",
          "keyword.operator.bitwise.shift.cpp",
        ],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["punctuation.separator.c", "punctuation.separator.cpp"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["support.type.posix-reserved.c", "support.type.posix-reserved.cpp"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["keyword.operator.sizeof.c", "keyword.operator.sizeof.cpp"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "variable.c",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["storage.type.annotation.java", "storage.type.object.array.java"],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "source.java",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.java",
          "punctuation.section.block.end.java",
          "punctuation.definition.method-parameters.begin.java",
          "punctuation.definition.method-parameters.end.java",
          "meta.method.identifier.java",
          "punctuation.section.method.begin.java",
          "punctuation.section.method.end.java",
          "punctuation.terminator.java",
          "punctuation.section.class.begin.java",
          "punctuation.section.class.end.java",
          "punctuation.section.inner-class.begin.java",
          "punctuation.section.inner-class.end.java",
          "meta.method-call.java",
          "punctuation.section.class.begin.bracket.curly.java",
          "punctuation.section.class.end.bracket.curly.java",
          "punctuation.section.method.begin.bracket.curly.java",
          "punctuation.section.method.end.bracket.curly.java",
          "punctuation.separator.period.java",
          "punctuation.bracket.angle.java",
          "punctuation.definition.annotation.java",
          "meta.method.body.java",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.method.java",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: ["storage.modifier.import.java", "storage.type.java", "storage.type.generic.java"],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "keyword.operator.instanceof.java",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "meta.definition.variable.name.java",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "token.variable.parameter.java",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "import.storage.java",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "token.package.keyword",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "token.package",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "token.storage.type.java",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "keyword.operator.assignment.go",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: ["keyword.operator.arithmetic.go", "keyword.operator.address.go"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "entity.name.package.go",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "support.other.namespace.use.php",
          "support.other.namespace.use-as.php",
          "support.other.namespace.php",
          "entity.other.alias.php",
          "meta.interface.php",
        ],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "keyword.operator.error-control.php",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "keyword.operator.type.php",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["punctuation.section.array.begin.php", "punctuation.section.array.end.php"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "storage.type.php",
          "meta.other.type.phpdoc.php",
          "keyword.other.type.php",
          "keyword.other.array.phpdoc.php",
        ],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "meta.function-call.php",
          "meta.function-call.object.php",
          "meta.function-call.static.php",
        ],
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: [
          "punctuation.definition.parameters.begin.bracket.round.php",
          "punctuation.definition.parameters.end.bracket.round.php",
          "punctuation.separator.delimiter.php",
          "punctuation.section.scope.begin.php",
          "punctuation.section.scope.end.php",
          "punctuation.terminator.expression.php",
          "punctuation.definition.arguments.begin.bracket.round.php",
          "punctuation.definition.arguments.end.bracket.round.php",
          "punctuation.definition.storage-type.begin.bracket.round.php",
          "punctuation.definition.storage-type.end.bracket.round.php",
          "punctuation.definition.array.begin.bracket.round.php",
          "punctuation.definition.array.end.bracket.round.php",
          "punctuation.definition.begin.bracket.round.php",
          "punctuation.definition.end.bracket.round.php",
          "punctuation.definition.begin.bracket.curly.php",
          "punctuation.definition.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.start.bracket.curly.php",
          "punctuation.definition.section.switch-block.begin.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "support.constant.ext.php",
          "support.constant.std.php",
          "support.constant.core.php",
          "support.constant.parser-token.php",
        ],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: ["entity.name.goto-label.php", "support.other.php"],
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: [
          "keyword.operator.logical.php",
          "keyword.operator.bitwise.php",
          "keyword.operator.arithmetic.php",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.regexp.php",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "keyword.operator.comparison.php",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["keyword.operator.heredoc.php", "keyword.operator.nowdoc.php"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "variable.other.class.php",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "invalid.illegal.non-null-typehinted.php",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "variable.other.generic-type.haskell",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "storage.type.haskell",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "storage.type.cs",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "entity.name.variable.local.cs",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "entity.name.label.cs",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "entity.name.scope-resolution.function.call",
          "entity.name.scope-resolution.function.definition",
        ],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "punctuation.definition.delayed.unison",
          "punctuation.definition.list.begin.unison",
          "punctuation.definition.list.end.unison",
          "punctuation.definition.ability.begin.unison",
          "punctuation.definition.ability.end.unison",
          "punctuation.operator.assignment.as.unison",
          "punctuation.separator.pipe.unison",
          "punctuation.separator.delimiter.unison",
          "punctuation.definition.hash.unison",
        ],
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "support.constant.edge",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "support.type.prelude.elm",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.constant.elm",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "entity.global.clojure",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "meta.symbol.clojure",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "constant.keyword.clojure",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["meta.arguments.coffee", "variable.parameter.function.coffee"],
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "storage.modifier.import.groovy",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "meta.method.groovy",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "meta.definition.variable.name.groovy",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "meta.definition.class.inherited.classes.groovy",
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: "support.variable.semantic.hlsl",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "support.type.texture.hlsl",
          "support.type.sampler.hlsl",
          "support.type.object.hlsl",
          "support.type.object.rw.hlsl",
          "support.type.fx.hlsl",
          "support.type.object.hlsl",
        ],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["text.variable", "text.bracketed"],
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: ["support.type.swift", "support.type.vb.asp"],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "meta.scope.prerequisites.makefile",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "source.makefile",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "source.ini",
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: "constant.language.symbol.ruby",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["function.parameter.ruby", "function.parameter.cs"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "constant.language.symbol.elixir",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html entity.name.tag.laravel-blade",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html support.constant.laravel-blade",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "entity.name.function.xi",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "entity.name.class.xi",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "constant.character.character-class.regexp.xi",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "constant.regexp.xi",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "keyword.control.xi",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "invalid.xi",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "beginning.punctuation.definition.quote.markdown.xi",
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown.xi",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: "constant.character.xi",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "accent.xi",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "wikiword.xi",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "constant.other.color.rgb-value.xi",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "punctuation.definition.tag.xi",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: ["support.constant.property-value.scss", "support.constant.property-value.css"],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: ["keyword.operator.css", "keyword.operator.scss", "keyword.operator.less"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: [
          "support.constant.color.w3c-standard-color-name.css",
          "support.constant.color.w3c-standard-color-name.scss",
        ],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "punctuation.separator.list.comma.css",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.type.vendored.property-name.css",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.type.property-name.css",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.type.property-name",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.constant.property-value",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.constant.font-name",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "entity.other.attribute-name.class.css",
        settings: {
          foreground: "#16a994",
          fontStyle: "normal",
        },
      },
      {
        scope: "entity.other.attribute-name.id",
        settings: {
          foreground: "#7b43f8",
          fontStyle: "normal",
        },
      },
      {
        scope: [
          "entity.other.attribute-name.pseudo-element",
          "entity.other.attribute-name.pseudo-class",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "meta.selector",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "selector.sass",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "rgb-value",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "inline-color-decoration rgb-value",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "less rgb-value",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "control.elements",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "keyword.operator.less",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "entity.name.tag",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "entity.other.attribute-name",
        settings: {
          foreground: "#16a994",
          fontStyle: "normal",
        },
      },
      {
        scope: "constant.character.entity",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "meta.tag",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "invalid.illegal.bad-ampersand.html",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "markup.heading",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: ["markup.heading punctuation.definition.heading", "entity.name.section"],
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "entity.name.section.markdown",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "punctuation.definition.heading.markdown",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "markup.heading.setext",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["markup.heading.setext.1.markdown", "markup.heading.setext.2.markdown"],
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: ["markup.bold", "todo.bold"],
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "punctuation.definition.bold",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "punctuation.definition.bold.markdown",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: ["markup.italic", "punctuation.definition.italic", "todo.emphasis"],
        settings: {
          foreground: "#fc2b73",
          fontStyle: "italic",
        },
      },
      {
        scope: "emphasis md",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "markup.italic.markdown",
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: ["markup.underline.link.markdown", "markup.underline.link.image.markdown"],
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: ["string.other.link.title.markdown", "string.other.link.description.markdown"],
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "punctuation.definition.metadata.markdown",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: ["markup.inline.raw.markdown", "markup.inline.raw.string.markdown"],
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "punctuation.definition.list.markdown",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: [
          "punctuation.definition.string.begin.markdown",
          "punctuation.definition.string.end.markdown",
        ],
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "markup.quote.markdown",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: "keyword.other.unit",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "markup.changed.diff",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: [
          "meta.diff.header.from-file",
          "meta.diff.header.to-file",
          "punctuation.definition.from-file.diff",
          "punctuation.definition.to-file.diff",
        ],
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "markup.inserted.diff",
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: "markup.deleted.diff",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "string.regexp",
        settings: {
          foreground: "#17a5af",
        },
      },
      {
        scope: "constant.other.character-class.regexp",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "keyword.operator.quantifier.regexp",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "constant.character.escape",
        settings: {
          foreground: "#1ca1c7",
        },
      },
      {
        scope: "source.json meta.structure.dictionary.json > string.quoted.json",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope:
          "source.json meta.structure.dictionary.json > string.quoted.json > punctuation.string",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json",
          "source.json meta.structure.array.json > value.json > string.quoted.json",
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json > punctuation",
          "source.json meta.structure.array.json > value.json > string.quoted.json > punctuation",
        ],
        settings: {
          foreground: "#199f43",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > constant.language.json",
          "source.json meta.structure.array.json > constant.language.json",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.type.property-name.json",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "support.type.property-name.json punctuation",
        settings: {
          foreground: "#d52c36",
        },
      },
      {
        scope: "punctuation.definition.block.sequence.item.yaml",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "block.scope.end",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "block.scope.begin",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "#7b43f8",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "#d5a910",
        },
      },
      {
        scope: "token.error-token",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "#fc2b73",
        },
      },
      {
        scope: "invalid.illegal",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.broken",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.deprecated",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.unimplemented",
        settings: {
          foreground: "#ffffff",
        },
      },
    ],
    semanticTokenColors: {
      comment: "#84848A",
      string: "#199f43",
      number: "#1ca1c7",
      regexp: "#17a5af",
      keyword: "#fc2b73",
      variable: "#d47628",
      parameter: "#79797F",
      property: "#d47628",
      function: "#7b43f8",
      method: "#7b43f8",
      type: "#c635e4",
      class: "#c635e4",
      namespace: "#d5a910",
      enumMember: "#08c0ef",
      "variable.constant": "#d5a910",
      "variable.defaultLibrary": "#d5a910",
    },
  } as unknown as ThemeRegistrationResolved)
})

registerCustomTheme("oc-1-dark", () => {
  return Promise.resolve({
    name: "oc-1-dark",
    type: "dark",
    colors: {
      "editor.background": "transparent",
      "editor.foreground": "#fbfbfb",
      foreground: "#fbfbfb",
      focusBorder: "#1a76d4",
      "selection.background": "#19253c",
      "editor.selectionBackground": "#1a76d44d",
      "editor.lineHighlightBackground": "#19253c8c",
      "editorCursor.foreground": "#1a76d4",
      "editorLineNumber.foreground": "#84848A",
      "editorLineNumber.activeForeground": "#adadb1",
      "editorIndentGuide.background": "#39393c",
      "editorIndentGuide.activeBackground": "#2e2e30",
      "diffEditor.insertedTextBackground": "#00cab11a",
      "diffEditor.deletedTextBackground": "#ff2e3f1a",
      "sideBar.background": "#141415",
      "sideBar.foreground": "#adadb1",
      "sideBar.border": "#070707",
      "sideBarTitle.foreground": "#fbfbfb",
      "sideBarSectionHeader.background": "#141415",
      "sideBarSectionHeader.foreground": "#adadb1",
      "sideBarSectionHeader.border": "#070707",
      "activityBar.background": "#141415",
      "activityBar.foreground": "#fbfbfb",
      "activityBar.border": "#070707",
      "activityBar.activeBorder": "#1a76d4",
      "activityBarBadge.background": "#1a76d4",
      "activityBarBadge.foreground": "#070707",
      "titleBar.activeBackground": "#141415",
      "titleBar.activeForeground": "#fbfbfb",
      "titleBar.inactiveBackground": "#141415",
      "titleBar.inactiveForeground": "#84848A",
      "titleBar.border": "#070707",
      "list.activeSelectionBackground": "#19253c99",
      "list.activeSelectionForeground": "#fbfbfb",
      "list.inactiveSelectionBackground": "#19253c73",
      "list.hoverBackground": "#19253c59",
      "list.focusOutline": "#1a76d4",
      "tab.activeBackground": "#070707",
      "tab.activeForeground": "#fbfbfb",
      "tab.activeBorderTop": "#1a76d4",
      "tab.inactiveBackground": "#141415",
      "tab.inactiveForeground": "#84848A",
      "tab.border": "#070707",
      "editorGroupHeader.tabsBackground": "#141415",
      "editorGroupHeader.tabsBorder": "#070707",
      "panel.background": "#141415",
      "panel.border": "#070707",
      "panelTitle.activeBorder": "#1a76d4",
      "panelTitle.activeForeground": "#fbfbfb",
      "panelTitle.inactiveForeground": "#84848A",
      "statusBar.background": "#141415",
      "statusBar.foreground": "#adadb1",
      "statusBar.border": "#070707",
      "statusBar.noFolderBackground": "#141415",
      "statusBar.debuggingBackground": "#ffca00",
      "statusBar.debuggingForeground": "#070707",
      "statusBarItem.remoteBackground": "#141415",
      "statusBarItem.remoteForeground": "#adadb1",
      "input.background": "#1F1F21",
      "input.border": "#424245",
      "input.foreground": "#fbfbfb",
      "input.placeholderForeground": "#79797F",
      "dropdown.background": "#1F1F21",
      "dropdown.border": "#424245",
      "dropdown.foreground": "#fbfbfb",
      "button.background": "#1a76d4",
      "button.foreground": "#070707",
      "button.hoverBackground": "#186bc0",
      "textLink.foreground": "#1a76d4",
      "textLink.activeForeground": "#1a76d4",
      "gitDecoration.addedResourceForeground": "#00cab1",
      "gitDecoration.conflictingResourceForeground": "#ffca00",
      "gitDecoration.modifiedResourceForeground": "#1a76d4",
      "gitDecoration.deletedResourceForeground": "#ff2e3f",
      "gitDecoration.untrackedResourceForeground": "#00cab1",
      "gitDecoration.ignoredResourceForeground": "#84848A",
      "terminal.titleForeground": "#adadb1",
      "terminal.titleInactiveForeground": "#84848A",
      "terminal.background": "#141415",
      "terminal.foreground": "#adadb1",
      "terminal.ansiBlack": "#141415",
      "terminal.ansiRed": "#ff2e3f",
      "terminal.ansiGreen": "#0dbe4e",
      "terminal.ansiYellow": "#ffca00",
      "terminal.ansiBlue": "#008cff",
      "terminal.ansiMagenta": "#c635e4",
      "terminal.ansiCyan": "#08c0ef",
      "terminal.ansiWhite": "#c6c6c8",
      "terminal.ansiBrightBlack": "#141415",
      "terminal.ansiBrightRed": "#ff2e3f",
      "terminal.ansiBrightGreen": "#0dbe4e",
      "terminal.ansiBrightYellow": "#ffca00",
      "terminal.ansiBrightBlue": "#008cff",
      "terminal.ansiBrightMagenta": "#c635e4",
      "terminal.ansiBrightCyan": "#08c0ef",
      "terminal.ansiBrightWhite": "#c6c6c8",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: "comment markup.link",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: ["string", "constant.other.symbol"],
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: ["punctuation.definition.string.begin", "punctuation.definition.string.end"],
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: ["constant.numeric", "constant.language.boolean"],
        settings: {
          foreground: "#68cdf2",
        },
      },
      {
        scope: "constant",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "punctuation.definition.constant",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "constant.language",
        settings: {
          foreground: "#68cdf2",
        },
      },
      {
        scope: "variable.other.constant",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "keyword.control",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["storage", "storage.type", "storage.modifier"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "token.storage",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: [
          "keyword.operator.new",
          "keyword.operator.expression.instanceof",
          "keyword.operator.expression.typeof",
          "keyword.operator.expression.void",
          "keyword.operator.expression.delete",
          "keyword.operator.expression.in",
          "keyword.operator.expression.of",
          "keyword.operator.expression.keyof",
        ],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "keyword.operator.delete",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["variable", "identifier", "meta.definition.variable"],
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: [
          "variable.other.readwrite",
          "meta.object-literal.key",
          "support.variable.property",
          "support.variable.object.process",
          "support.variable.object.node",
        ],
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: "variable.language",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "variable.parameter.function",
        settings: {
          foreground: "#adadb1",
        },
      },
      {
        scope: "function.parameter",
        settings: {
          foreground: "#adadb1",
        },
      },
      {
        scope: "variable.parameter",
        settings: {
          foreground: "#adadb1",
        },
      },
      {
        scope: "variable.parameter.function.language.python",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "variable.parameter.function.python",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: [
          "support.function",
          "entity.name.function",
          "meta.function-call",
          "meta.require",
          "support.function.any-method",
          "variable.function",
        ],
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "keyword.other.special-method",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "entity.name.function",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "support.function.console",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: ["support.type", "entity.name.type", "entity.name.class", "storage.type"],
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: ["support.class", "entity.name.type.class"],
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: ["entity.name.class", "variable.other.class.js", "variable.other.class.ts"],
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: "entity.name.class.identifier.namespace.type",
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: "entity.name.type.namespace",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "entity.other.inherited-class",
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: "entity.name.namespace",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "keyword.operator",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["keyword.operator.logical", "keyword.operator.bitwise", "keyword.operator.channel"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: [
          "keyword.operator.arithmetic",
          "keyword.operator.comparison",
          "keyword.operator.relational",
          "keyword.operator.increment",
          "keyword.operator.decrement",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.assignment",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.assignment.compound",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.compound.js",
          "keyword.operator.assignment.compound.ts",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.ternary",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "keyword.operator.optional",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "punctuation",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.separator.delimiter",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.separator.key-value",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.terminator",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.brace",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.brace.square",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.brace.round",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "function.brace",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["punctuation.definition.parameters", "punctuation.definition.typeparameters"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["punctuation.definition.block", "punctuation.definition.tag"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["meta.tag.tsx", "meta.tag.jsx", "meta.tag.js", "meta.tag.ts"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "keyword.operator.expression.import",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "keyword.operator.module",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "support.type.object.console",
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: ["support.module.node", "support.type.object.module", "entity.name.type.module"],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "support.constant.math",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "support.constant.property.math",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "support.constant.json",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "support.type.object.dom",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["support.variable.dom", "support.variable.property.dom"],
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: "support.variable.property.process",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "meta.property.object",
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: "variable.parameter.function.js",
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: ["keyword.other.template.begin", "keyword.other.template.end"],
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: ["keyword.other.substitution.begin", "keyword.other.substitution.end"],
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: [
          "punctuation.definition.template-expression.begin",
          "punctuation.definition.template-expression.end",
        ],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "meta.template.expression",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "punctuation.section.embedded",
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: "variable.interpolation",
        settings: {
          foreground: "#ffa359",
        },
      },
      {
        scope: ["punctuation.section.embedded.begin", "punctuation.section.embedded.end"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "punctuation.quasi.element",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: [
          "support.type.primitive.ts",
          "support.type.builtin.ts",
          "support.type.primitive.tsx",
          "support.type.builtin.tsx",
        ],
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: "support.type.type.flowtype",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "support.type.primitive",
        settings: {
          foreground: "#d568ea",
        },
      },
      {
        scope: "support.variable.magic.python",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "variable.parameter.function.language.special.self.python",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "punctuation.separator.period.python",
          "punctuation.separator.element.python",
          "punctuation.parenthesis.begin.python",
          "punctuation.parenthesis.end.python",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "punctuation.definition.arguments.begin.python",
          "punctuation.definition.arguments.end.python",
          "punctuation.separator.arguments.python",
          "punctuation.definition.list.begin.python",
          "punctuation.definition.list.end.python",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.type.python",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.logical.python",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "meta.function-call.generic.python",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "constant.character.format.placeholder.other.python",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "meta.function.decorator.python",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: ["support.token.decorator.python", "meta.function.decorator.identifier.python"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "storage.modifier.lifetime.rust",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.function.std.rust",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "entity.name.lifetime.rust",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "variable.language.rust",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "keyword.operator.misc.rust",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "keyword.operator.sigil.rust",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "support.constant.core.rust",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: ["meta.function.c", "meta.function.cpp"],
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.bracket.curly.cpp",
          "punctuation.section.block.end.bracket.curly.cpp",
          "punctuation.terminator.statement.c",
          "punctuation.section.block.begin.bracket.curly.c",
          "punctuation.section.block.end.bracket.curly.c",
          "punctuation.section.parens.begin.bracket.round.c",
          "punctuation.section.parens.end.bracket.round.c",
          "punctuation.section.parameters.begin.bracket.round.c",
          "punctuation.section.parameters.end.bracket.round.c",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.c",
          "keyword.operator.comparison.c",
          "keyword.operator.c",
          "keyword.operator.increment.c",
          "keyword.operator.decrement.c",
          "keyword.operator.bitwise.shift.c",
        ],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: [
          "keyword.operator.assignment.cpp",
          "keyword.operator.comparison.cpp",
          "keyword.operator.cpp",
          "keyword.operator.increment.cpp",
          "keyword.operator.decrement.cpp",
          "keyword.operator.bitwise.shift.cpp",
        ],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["punctuation.separator.c", "punctuation.separator.cpp"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["support.type.posix-reserved.c", "support.type.posix-reserved.cpp"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["keyword.operator.sizeof.c", "keyword.operator.sizeof.cpp"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "variable.c",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["storage.type.annotation.java", "storage.type.object.array.java"],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "source.java",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: [
          "punctuation.section.block.begin.java",
          "punctuation.section.block.end.java",
          "punctuation.definition.method-parameters.begin.java",
          "punctuation.definition.method-parameters.end.java",
          "meta.method.identifier.java",
          "punctuation.section.method.begin.java",
          "punctuation.section.method.end.java",
          "punctuation.terminator.java",
          "punctuation.section.class.begin.java",
          "punctuation.section.class.end.java",
          "punctuation.section.inner-class.begin.java",
          "punctuation.section.inner-class.end.java",
          "meta.method-call.java",
          "punctuation.section.class.begin.bracket.curly.java",
          "punctuation.section.class.end.bracket.curly.java",
          "punctuation.section.method.begin.bracket.curly.java",
          "punctuation.section.method.end.bracket.curly.java",
          "punctuation.separator.period.java",
          "punctuation.bracket.angle.java",
          "punctuation.definition.annotation.java",
          "meta.method.body.java",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "meta.method.java",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: ["storage.modifier.import.java", "storage.type.java", "storage.type.generic.java"],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "keyword.operator.instanceof.java",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "meta.definition.variable.name.java",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "token.variable.parameter.java",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "import.storage.java",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "token.package.keyword",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "token.package",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "token.storage.type.java",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "keyword.operator.assignment.go",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: ["keyword.operator.arithmetic.go", "keyword.operator.address.go"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "entity.name.package.go",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "support.other.namespace.use.php",
          "support.other.namespace.use-as.php",
          "support.other.namespace.php",
          "entity.other.alias.php",
          "meta.interface.php",
        ],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "keyword.operator.error-control.php",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "keyword.operator.type.php",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["punctuation.section.array.begin.php", "punctuation.section.array.end.php"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "storage.type.php",
          "meta.other.type.phpdoc.php",
          "keyword.other.type.php",
          "keyword.other.array.phpdoc.php",
        ],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "meta.function-call.php",
          "meta.function-call.object.php",
          "meta.function-call.static.php",
        ],
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: [
          "punctuation.definition.parameters.begin.bracket.round.php",
          "punctuation.definition.parameters.end.bracket.round.php",
          "punctuation.separator.delimiter.php",
          "punctuation.section.scope.begin.php",
          "punctuation.section.scope.end.php",
          "punctuation.terminator.expression.php",
          "punctuation.definition.arguments.begin.bracket.round.php",
          "punctuation.definition.arguments.end.bracket.round.php",
          "punctuation.definition.storage-type.begin.bracket.round.php",
          "punctuation.definition.storage-type.end.bracket.round.php",
          "punctuation.definition.array.begin.bracket.round.php",
          "punctuation.definition.array.end.bracket.round.php",
          "punctuation.definition.begin.bracket.round.php",
          "punctuation.definition.end.bracket.round.php",
          "punctuation.definition.begin.bracket.curly.php",
          "punctuation.definition.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
          "punctuation.definition.section.switch-block.start.bracket.curly.php",
          "punctuation.definition.section.switch-block.begin.bracket.curly.php",
          "punctuation.definition.section.switch-block.end.bracket.curly.php",
        ],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: [
          "support.constant.ext.php",
          "support.constant.std.php",
          "support.constant.core.php",
          "support.constant.parser-token.php",
        ],
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: ["entity.name.goto-label.php", "support.other.php"],
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: [
          "keyword.operator.logical.php",
          "keyword.operator.bitwise.php",
          "keyword.operator.arithmetic.php",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "keyword.operator.regexp.php",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "keyword.operator.comparison.php",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["keyword.operator.heredoc.php", "keyword.operator.nowdoc.php"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "variable.other.class.php",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "invalid.illegal.non-null-typehinted.php",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "variable.other.generic-type.haskell",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "storage.type.haskell",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "storage.type.cs",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "entity.name.variable.local.cs",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "entity.name.label.cs",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "entity.name.scope-resolution.function.call",
          "entity.name.scope-resolution.function.definition",
        ],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "punctuation.definition.delayed.unison",
          "punctuation.definition.list.begin.unison",
          "punctuation.definition.list.end.unison",
          "punctuation.definition.ability.begin.unison",
          "punctuation.definition.ability.end.unison",
          "punctuation.operator.assignment.as.unison",
          "punctuation.separator.pipe.unison",
          "punctuation.separator.delimiter.unison",
          "punctuation.definition.hash.unison",
        ],
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "support.constant.edge",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "support.type.prelude.elm",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.constant.elm",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "entity.global.clojure",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "meta.symbol.clojure",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "constant.keyword.clojure",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["meta.arguments.coffee", "variable.parameter.function.coffee"],
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "storage.modifier.import.groovy",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "meta.method.groovy",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "meta.definition.variable.name.groovy",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "meta.definition.class.inherited.classes.groovy",
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: "support.variable.semantic.hlsl",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "support.type.texture.hlsl",
          "support.type.sampler.hlsl",
          "support.type.object.hlsl",
          "support.type.object.rw.hlsl",
          "support.type.fx.hlsl",
          "support.type.object.hlsl",
        ],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["text.variable", "text.bracketed"],
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: ["support.type.swift", "support.type.vb.asp"],
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "meta.scope.prerequisites.makefile",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "source.makefile",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "source.ini",
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: "constant.language.symbol.ruby",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: ["function.parameter.ruby", "function.parameter.cs"],
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "constant.language.symbol.elixir",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html entity.name.tag.laravel-blade",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope:
          "text.html.laravel-blade source.php.embedded.line.html support.constant.laravel-blade",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "entity.name.function.xi",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "entity.name.class.xi",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "constant.character.character-class.regexp.xi",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "constant.regexp.xi",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "keyword.control.xi",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "invalid.xi",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "beginning.punctuation.definition.quote.markdown.xi",
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown.xi",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: "constant.character.xi",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "accent.xi",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "wikiword.xi",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "constant.other.color.rgb-value.xi",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "punctuation.definition.tag.xi",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: ["support.constant.property-value.scss", "support.constant.property-value.css"],
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: ["keyword.operator.css", "keyword.operator.scss", "keyword.operator.less"],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: [
          "support.constant.color.w3c-standard-color-name.css",
          "support.constant.color.w3c-standard-color-name.scss",
        ],
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "punctuation.separator.list.comma.css",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.type.vendored.property-name.css",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.type.property-name.css",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.type.property-name",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.constant.property-value",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "support.constant.font-name",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "entity.other.attribute-name.class.css",
        settings: {
          foreground: "#61d5c0",
          fontStyle: "normal",
        },
      },
      {
        scope: "entity.other.attribute-name.id",
        settings: {
          foreground: "#9d6afb",
          fontStyle: "normal",
        },
      },
      {
        scope: [
          "entity.other.attribute-name.pseudo-element",
          "entity.other.attribute-name.pseudo-class",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "meta.selector",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "selector.sass",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "rgb-value",
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "inline-color-decoration rgb-value",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "less rgb-value",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "control.elements",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "keyword.operator.less",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "entity.name.tag",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "entity.other.attribute-name",
        settings: {
          foreground: "#61d5c0",
          fontStyle: "normal",
        },
      },
      {
        scope: "constant.character.entity",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "meta.tag",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "invalid.illegal.bad-ampersand.html",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "markup.heading",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: ["markup.heading punctuation.definition.heading", "entity.name.section"],
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "entity.name.section.markdown",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "punctuation.definition.heading.markdown",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "markup.heading.setext",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: ["markup.heading.setext.1.markdown", "markup.heading.setext.2.markdown"],
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: ["markup.bold", "todo.bold"],
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "punctuation.definition.bold",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: "punctuation.definition.bold.markdown",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: ["markup.italic", "punctuation.definition.italic", "todo.emphasis"],
        settings: {
          foreground: "#ff678d",
          fontStyle: "italic",
        },
      },
      {
        scope: "emphasis md",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "markup.italic.markdown",
        settings: {
          fontStyle: "italic",
        },
      },
      {
        scope: ["markup.underline.link.markdown", "markup.underline.link.image.markdown"],
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: ["string.other.link.title.markdown", "string.other.link.description.markdown"],
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "punctuation.definition.metadata.markdown",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: ["markup.inline.raw.markdown", "markup.inline.raw.string.markdown"],
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "punctuation.definition.list.markdown",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "beginning.punctuation.definition.list.markdown",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: [
          "punctuation.definition.string.begin.markdown",
          "punctuation.definition.string.end.markdown",
        ],
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "markup.quote.markdown",
        settings: {
          foreground: "#84848A",
        },
      },
      {
        scope: "keyword.other.unit",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "markup.changed.diff",
        settings: {
          foreground: "#ffca00",
        },
      },
      {
        scope: [
          "meta.diff.header.from-file",
          "meta.diff.header.to-file",
          "punctuation.definition.from-file.diff",
          "punctuation.definition.to-file.diff",
        ],
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "markup.inserted.diff",
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: "markup.deleted.diff",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "string.regexp",
        settings: {
          foreground: "#64d1db",
        },
      },
      {
        scope: "constant.other.character-class.regexp",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "keyword.operator.quantifier.regexp",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "constant.character.escape",
        settings: {
          foreground: "#68cdf2",
        },
      },
      {
        scope: "source.json meta.structure.dictionary.json > string.quoted.json",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope:
          "source.json meta.structure.dictionary.json > string.quoted.json > punctuation.string",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json",
          "source.json meta.structure.array.json > value.json > string.quoted.json",
          "source.json meta.structure.dictionary.json > value.json > string.quoted.json > punctuation",
          "source.json meta.structure.array.json > value.json > string.quoted.json > punctuation",
        ],
        settings: {
          foreground: "#5ecc71",
        },
      },
      {
        scope: [
          "source.json meta.structure.dictionary.json > constant.language.json",
          "source.json meta.structure.array.json > constant.language.json",
        ],
        settings: {
          foreground: "#08c0ef",
        },
      },
      {
        scope: "support.type.property-name.json",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "support.type.property-name.json punctuation",
        settings: {
          foreground: "#ff6762",
        },
      },
      {
        scope: "punctuation.definition.block.sequence.item.yaml",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "block.scope.end",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "block.scope.begin",
        settings: {
          foreground: "#79797F",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "#9d6afb",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "#ffd452",
        },
      },
      {
        scope: "token.error-token",
        settings: {
          foreground: "#f44747",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "#ff678d",
        },
      },
      {
        scope: "invalid.illegal",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.broken",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.deprecated",
        settings: {
          foreground: "#ffffff",
        },
      },
      {
        scope: "invalid.unimplemented",
        settings: {
          foreground: "#ffffff",
        },
      },
    ],
    semanticTokenColors: {
      comment: "#84848A",
      string: "#5ecc71",
      number: "#68cdf2",
      regexp: "#64d1db",
      keyword: "#ff678d",
      variable: "#ffa359",
      parameter: "#adadb1",
      property: "#ffa359",
      function: "#9d6afb",
      method: "#9d6afb",
      type: "#d568ea",
      class: "#d568ea",
      namespace: "#ffca00",
      enumMember: "#08c0ef",
      "variable.constant": "#ffd452",
      "variable.defaultLibrary": "#ffca00",
    },
  } as unknown as ThemeRegistrationResolved)
})
