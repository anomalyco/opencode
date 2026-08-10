import { SyntaxStyle, type RGBA } from "@opentui/core"

export function generateThinkingSyntax(syntax: SyntaxStyle, foreground: RGBA) {
  return SyntaxStyle.fromStyles(
    Object.fromEntries(syntax.getRegisteredNames().map((name) => [name, { ...syntax.getStyle(name), fg: foreground }])),
  )
}
