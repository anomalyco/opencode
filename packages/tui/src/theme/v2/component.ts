import type { RGBA } from "@opentui/core"
import type { Accessor } from "solid-js"
import type { ActionState, ActionVariant, ResolvedActionState, ResolvedThemeView } from "./index"

export function createComponentTheme(current: Accessor<ResolvedThemeView>) {
  const textAction = actions((variant, state) => current().color.text.action[variant][state])
  const backgroundAction = actions((variant, state) => current().color.background.action[variant][state])
  const text = Object.assign(() => current().color.text.default, {
    subdued: () => current().color.text.subdued,
    action: textAction,
    feedback: {
      error: feedbackText("error"),
      warning: feedbackText("warning"),
      success: feedbackText("success"),
      info: feedbackText("info"),
    },
  })
  const background = Object.assign(() => current().color.background.default, {
    action: backgroundAction,
    feedback: {
      error: () => current().color.background.feedback.error.default,
      warning: () => current().color.background.feedback.warning.default,
      success: () => current().color.background.feedback.success.default,
      info: () => current().color.background.feedback.info.default,
    },
  })
  const markdown = Object.assign(() => current().color.markdown.text, {
    heading: () => current().color.markdown.heading,
    link: () => current().color.markdown.link,
    linkText: () => current().color.markdown.linkText,
    code: () => current().color.markdown.code,
    blockQuote: () => current().color.markdown.blockQuote,
    emphasis: () => current().color.markdown.emphasis,
    strong: () => current().color.markdown.strong,
    horizontalRule: () => current().color.markdown.horizontalRule,
    listItem: () => current().color.markdown.listItem,
    listEnumeration: () => current().color.markdown.listEnumeration,
    image: () => current().color.markdown.image,
    imageText: () => current().color.markdown.imageText,
    codeBlock: () => current().color.markdown.codeBlock,
  })

  function feedbackText(kind: "error" | "warning" | "success" | "info") {
    return Object.assign(() => current().color.text.feedback[kind].default, {
      subdued: () => current().color.text.feedback[kind].subdued,
    })
  }

  return {
    hue: () => current().hue,
    color: {
      text,
      background,
      border: () => current().color.border.default,
      scrollbar: () => current().color.scrollbar.default,
      diff: {
        text: {
          added: () => current().color.diff.text.added,
          removed: () => current().color.diff.text.removed,
          context: () => current().color.diff.text.context,
          hunkHeader: () => current().color.diff.text.hunkHeader,
        },
        background: {
          added: () => current().color.diff.background.added,
          removed: () => current().color.diff.background.removed,
          context: () => current().color.diff.background.context,
        },
        highlight: {
          added: () => current().color.diff.highlight.added,
          removed: () => current().color.diff.highlight.removed,
        },
        lineNumber: {
          text: () => current().color.diff.lineNumber.text,
          background: {
            added: () => current().color.diff.lineNumber.background.added,
            removed: () => current().color.diff.lineNumber.background.removed,
          },
        },
      },
      syntax: {
        comment: () => current().color.syntax.comment,
        keyword: () => current().color.syntax.keyword,
        function: () => current().color.syntax.function,
        variable: () => current().color.syntax.variable,
        string: () => current().color.syntax.string,
        number: () => current().color.syntax.number,
        type: () => current().color.syntax.type,
        operator: () => current().color.syntax.operator,
        punctuation: () => current().color.syntax.punctuation,
      },
      markdown,
    },
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

export type ComponentTheme = ReturnType<typeof createComponentTheme>
