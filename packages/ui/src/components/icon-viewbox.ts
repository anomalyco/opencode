import type { IconProps } from "./icon-types"

export function getIconViewBox(name: IconProps["name"]) {
  if (name === "magnifying-glass" || name === "arrow-undo-down") return "0 0 16 16"
  if (name === "mcp") return "0 0 24 24"
  return "0 0 20 20"
}
