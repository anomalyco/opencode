import type { RGBA } from "@opentui/core"
import type { Accessor } from "solid-js"
import type {
  ActionVariant,
  Mode,
  ResolvedActionState,
  ResolvedThemeView,
} from "./index"
import { ActionState, HueStep } from "./schema"

type StateFlags = Partial<Record<ActionState, boolean>>

export function createComponentTheme(current: Accessor<ResolvedThemeView>, mode: Accessor<Mode>) {
  const textAction = actions((variant, state) => current().text.action[variant][state])
  const backgroundAction = actions((variant, state) => current().background.action[variant][state])
  const textFormfield = formfield((state) => current().text.formfield[state])
  const backgroundFormfield = formfield((state) => current().background.formfield[state])
  const hue = {
    gray: (step: HueStep) => current().hue.gray[step],
    red: (step: HueStep) => current().hue.red[step],
    orange: (step: HueStep) => current().hue.orange[step],
    yellow: (step: HueStep) => current().hue.yellow[step],
    green: (step: HueStep) => current().hue.green[step],
    cyan: (step: HueStep) => current().hue.cyan[step],
    blue: (step: HueStep) => current().hue.blue[step],
    purple: (step: HueStep) => current().hue.purple[step],
    accent: (step: HueStep) => current().hue.accent[step],
    interactive: (step: HueStep) => current().hue.interactive[step],
    neutral: (step: HueStep) => current().hue.neutral[step],
  }
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
    hue,
    source: (color: RGBA) => current().source(color),
    increase: (color: RGBA, amount = 1) => current().increase(color, amount),
    decrease: (color: RGBA, amount = 1) => current().decrease(color, amount),
    raise: (color: RGBA) => (mode() === "light" ? current().increase(color) : current().decrease(color)),
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
  const primary = stateful((state) => get("primary", state))
  return Object.assign(primary, {
    destructive: stateful((state) => get("destructive", state)),
  })
}

function formfield(get: (state: ResolvedActionState) => RGBA) {
  return stateful(get)
}

function stateful(get: (state: ResolvedActionState) => RGBA) {
  return (states: ActionState | "default" | StateFlags = "default") => {
    if (typeof states === "string") return get(states)
    return get(ActionState.literals.find((state) => states[state]) ?? "default")
  }
}

export type ComponentTheme = ReturnType<typeof createComponentTheme>
