import { ColorScheme } from "@blocksuite/affine-model"

export function scheme(theme: "light" | "dark") {
  return theme === "dark" ? ColorScheme.Dark : ColorScheme.Light
}
