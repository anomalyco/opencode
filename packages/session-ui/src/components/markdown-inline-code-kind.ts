export function inlineCodeKind(text: string): "path" | "url" | undefined {
  if (/^https?:\/\//i.test(text)) return "url"
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return
  if (text === "/") return
  if (/^\/[a-z][a-z0-9-]*$/i.test(text)) return
  if (/\s/.test(text)) return
  if (/[()\[\]{}*+=<>|&^"';]/.test(text)) return
  if (
    /[/\\]/.test(text) ||
    /^\.\.?[/\\]/.test(text) ||
    /\.(tsx?|jsx?|json|py|go|rs|rb|php|css|html|md|sh|ya?ml|toml|sql|c|cpp|h|java|kt|swift|scala|xml|png|jpe?g|gif|svg|ico)$/i.test(
      text,
    )
  )
    return "path"
}
