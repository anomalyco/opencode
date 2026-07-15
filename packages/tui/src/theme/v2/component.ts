import type { RGBA } from "@opentui/core"
import type { Accessor } from "solid-js"
import type {
  ActionState,
  ActionVariant,
  FormfieldState,
  ResolvedActionState,
  ResolvedFormfieldState,
  ResolvedThemeView,
} from "./index"

export function createComponentTheme(current: Accessor<ResolvedThemeView>) {
  const textAction = actions((variant, state) => current().text.action[variant][state])
  const backgroundAction = actions((variant, state) => current().background.action[variant][state])
  const textFormfield = formfield((state) => current().text.formfield[state])
  const backgroundFormfield = formfield((state) => current().background.formfield[state])
  const text = Object.assign(() => current().text.default, {
    subdued: () => current().text.subdued,
    action: textAction,
    formfield: textFormfield,
    feedback: {
      error: feedbackText("error"),
      warning: feedbackText("warning"),
      success: feedbackText("success"),
      info: feedbackText("info"),
    },
  })
  const background = Object.assign(() => current().background.default, {
    surface: {
      offset: () => current().background.surface.offset,
      overlay: () => current().background.surface.overlay,
    },
    action: backgroundAction,
    formfield: backgroundFormfield,
    feedback: {
      error: () => current().background.feedback.error.default,
      warning: () => current().background.feedback.warning.default,
      success: () => current().background.feedback.success.default,
      info: () => current().background.feedback.info.default,
    },
  })
  const markdown = Object.assign(() => current().markdown.text, {
    heading: () => current().markdown.heading,
    link: () => current().markdown.link,
    linkText: () => current().markdown.linkText,
    code: () => current().markdown.code,
    blockQuote: () => current().markdown.blockQuote,
    emphasis: () => current().markdown.emphasis,
    strong: () => current().markdown.strong,
    horizontalRule: () => current().markdown.horizontalRule,
    listItem: () => current().markdown.listItem,
    listEnumeration: () => current().markdown.listEnumeration,
    image: () => current().markdown.image,
    imageText: () => current().markdown.imageText,
    codeBlock: () => current().markdown.codeBlock,
  })

  function feedbackText(kind: "error" | "warning" | "success" | "info") {
    return Object.assign(() => current().text.feedback[kind].default, {
      subdued: () => current().text.feedback[kind].subdued,
    })
  }

  return {
    hue: () => current().hue,
    text,
    background,
    border: () => current().border.default,
    scrollbar: () => current().scrollbar.default,
    diff: {
        text: {
          added: () => current().diff.text.added,
          removed: () => current().diff.text.removed,
          context: () => current().diff.text.context,
          hunkHeader: () => current().diff.text.hunkHeader,
        },
        background: {
          added: () => current().diff.background.added,
          removed: () => current().diff.background.removed,
          context: () => current().diff.background.context,
        },
        highlight: {
          added: () => current().diff.highlight.added,
          removed: () => current().diff.highlight.removed,
        },
        lineNumber: {
          text: () => current().diff.lineNumber.text,
          background: {
            added: () => current().diff.lineNumber.background.added,
            removed: () => current().diff.lineNumber.background.removed,
          },
        },
      },
    syntax: {
      comment: () => current().syntax.comment,
      keyword: () => current().syntax.keyword,
      function: () => current().syntax.function,
      variable: () => current().syntax.variable,
      string: () => current().syntax.string,
      number: () => current().syntax.number,
      type: () => current().syntax.type,
      operator: () => current().syntax.operator,
      punctuation: () => current().syntax.punctuation,
    },
    markdown,
  }
}

function actions(get: (variant: ActionVariant, state: ResolvedActionState) => RGBA) {
  const action = (variant: ActionVariant) => (state: ActionState | "default" = "default") => get(variant, state)
  const primary = action("primary")
  return Object.assign(primary, {
    primary,
    secondary: action("secondary"),
    destructive: action("destructive"),
  })
}

function formfield(get: (state: ResolvedFormfieldState) => RGBA) {
  return (state: FormfieldState | "default" = "default") => get(state)
}

export type ComponentTheme = ReturnType<typeof createComponentTheme>
