import { SyntaxStyle, type NativeResourceOwner, type RGBA } from "@opentui/core"

export function generateThinkingSyntax(syntax: SyntaxStyle, foreground: RGBA, owner: NativeResourceOwner) {
  return SyntaxStyle.fromStyles(
    Object.fromEntries(syntax.getRegisteredNames().map((name) => [name, { ...syntax.getStyle(name), fg: foreground }])),
    owner,
  )
}
