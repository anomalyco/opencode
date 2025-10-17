import { Theme } from "@tui/context/theme"

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  borderColor: Theme().border,
  customBorderChars: {
    topLeft: "",
    bottomLeft: "",
    vertical: "┃",
    topRight: "",
    bottomRight: "",
    horizontal: "",
    bottomT: "",
    topT: "",
    cross: "",
    leftT: "",
    rightT: "",
  },
}
