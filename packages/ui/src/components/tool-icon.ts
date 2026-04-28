import type { IconProps } from "./icon"

export function getToolIcon(tool: string): IconProps["name"] {
  switch (tool) {
    case "bash":
      return "terminal"
    case "glob":
    case "grep":
      return "magnifying-glass"
    case "websearch":
      return "globe"
    case "tool":
      return "hammer"
    default:
      return "mcp"
  }
}
