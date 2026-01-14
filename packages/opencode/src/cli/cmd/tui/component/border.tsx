export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
}

export const SplitBorderAscii = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "|",
  },
}

export function getSplitBorder(accessible: boolean) {
  return accessible ? SplitBorderAscii : SplitBorder
}

export function getSplitBorderChars(accessible: boolean) {
  return accessible ? SplitBorderAscii.customBorderChars : SplitBorder.customBorderChars
}
