export type RedactionResult = {
  text: string
  redactions: string[]
}

type Rule = {
  name: string
  pattern: RegExp
  replace: (input: string) => string
}

const RULES: Rule[] = [
  {
    name: "bearer-token",
    pattern: /Bearer\s+[A-Za-z0-9._\-]{10,}/g,
    replace: () => "Bearer [REDACTED_TOKEN]",
  },
  {
    name: "env-secret",
    pattern: /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^\s]+/g,
    replace: (input) => `${input.split("=")[0]}=[REDACTED_SECRET]`,
  },
  {
    name: "password-field",
    pattern: /\b(password|passwd|pwd)\s*:\s*[^\s]+/gi,
    replace: (input) => `${input.split(":")[0]}: [REDACTED_SECRET]`,
  },
  {
    name: "account-login",
    pattern: /\b(account\s+login|login|account)\s+([0-9]{5,})\b/gi,
    replace: (input) => `${input.replace(/[0-9]{5,}/g, "[REDACTED_ACCOUNT]")}`,
  },
]

export function redactEaLabText(input: string): RedactionResult {
  return RULES.reduce(
    (state, rule) => {
      const matches = state.text.match(rule.pattern) ?? []
      if (!matches.length) return state
      return {
        text: state.text.replace(rule.pattern, (value) => rule.replace(value)),
        redactions: [...state.redactions, ...matches.map(() => rule.name)],
      }
    },
    { text: input, redactions: [] as string[] },
  )
}
