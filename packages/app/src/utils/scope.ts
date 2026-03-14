export function scope(...input: Array<string | undefined>) {
  return input.filter((item): item is string => !!item).join("\n")
}
