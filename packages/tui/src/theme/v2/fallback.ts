import type { ThemeTokensDefinition } from "./index"
import { ActionVariant, FeedbackKind } from "./schema"

export function fallback(): ThemeTokensDefinition {
  const red = "#ff0000"

  return {
    text: {
        default: red,
        action: Object.fromEntries(ActionVariant.literals.map((variant) => [variant, { default: red }])),
        formfield: { default: red },
        feedback: Object.fromEntries(FeedbackKind.literals.map((kind) => [kind, { default: red }])),
    },
    background: {
        default: red,
        surface: { offset: red, overlay: red },
        action: Object.fromEntries(ActionVariant.literals.map((variant) => [variant, { default: red }])),
        formfield: { default: red },
        feedback: Object.fromEntries(FeedbackKind.literals.map((kind) => [kind, { default: red }])),
    },
    border: { default: red },
    scrollbar: { default: red },
    diff: {
        text: { added: red, removed: red, context: red, hunkHeader: red },
        background: { added: red, removed: red, context: red },
        highlight: { added: red, removed: red },
        lineNumber: { text: red, background: { added: red, removed: red } },
    },
    syntax: {
        comment: red,
        keyword: red,
        function: red,
        variable: red,
        string: red,
        number: red,
        type: red,
        operator: red,
        punctuation: red,
    },
    markdown: {
        text: red,
        heading: red,
        link: red,
        linkText: red,
        code: red,
        blockQuote: red,
        emphasis: red,
        strong: red,
        horizontalRule: red,
        listItem: red,
        listEnumeration: red,
        image: red,
        imageText: red,
        codeBlock: red,
    },
  }
}
