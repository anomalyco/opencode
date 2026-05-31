export const tool = {
  name: "calculator",
  description: "Evaluate arithmetic expressions. Supports +, -, *, / operators.",
  schema: {
    input: { expression: "string" },
    output: { result: "number" },
  },
}

export default function calculator({ expression }: { expression: string }) {
  const cleaned = expression.replace(/[^0-9+\-*/.() ]/g, "")
  const result = Function(`"use strict"; return (${cleaned})`)()
  return { result }
}
