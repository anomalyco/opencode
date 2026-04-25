type Input = {
  blank: boolean
  count: number
  working: boolean
  t: (key: string) => string
}

type Hint =
  | {
      kind: "icon"
      name: "enter"
    }
  | {
      kind: "text"
      label: string
    }

export type PromptAction = {
  kind: "stop" | "addCommentToPrompt" | "addCommentsToPrompt" | "send"
  label: string
  icon: "stop" | "arrow-up"
  hint: Hint
  inactive: boolean
}

export function promptAction(input: Input): PromptAction {
  if (input.working) {
    return {
      kind: "stop",
      label: input.t("prompt.action.stop"),
      icon: "stop",
      hint: {
        kind: "text",
        label: input.t("common.key.esc"),
      },
      inactive: false,
    }
  }

  if (input.count === 1) {
    return {
      kind: "addCommentToPrompt",
      label: input.t("prompt.action.addCommentToPrompt"),
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: false,
    }
  }

  if (input.count > 1) {
    return {
      kind: "addCommentsToPrompt",
      label: input.t("prompt.action.addCommentsToPrompt"),
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: false,
    }
  }

  return {
    kind: "send",
    label: input.t("prompt.action.send"),
    icon: "arrow-up",
    hint: {
      kind: "icon",
      name: "enter",
    },
    inactive: input.blank,
  }
}
