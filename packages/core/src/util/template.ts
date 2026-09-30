// String.prototype.replace interprets `$` sequences ($&, $', $`, $$) inside
// string replacements, so filling templates with user-controlled values (file
// paths, tool output) via a string replacer silently corrupts the result.
// A function replacer inserts its return value verbatim instead.
export function literalReplace(template: string, placeholder: string, value: string): string {
  return template.replace(placeholder, () => value)
}
