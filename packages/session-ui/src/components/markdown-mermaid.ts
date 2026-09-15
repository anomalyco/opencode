let loaded: ReturnType<typeof loadMermaid> | undefined
let sequence = 0

export async function renderMermaidSvg(source: string) {
  const mermaid = await (loaded ??= loadMermaid())
  const valid = await mermaid.parse(source, { suppressErrors: true })
  const input = valid ? source : escapeSequenceMessageSemicolons(source)
  if (!valid && (input === source || !(await mermaid.parse(input, { suppressErrors: true })))) return
  return (await mermaid.render(`markdown-mermaid-${sequence++}`, input)).svg
}

function escapeSequenceMessageSemicolons(source: string) {
  if (!/^\s*sequenceDiagram\b/i.test(source)) return source
  // Mermaid treats raw semicolons as statements, even inside message labels.
  // Only retry rejected diagrams; valid semicolon-separated statements stay intact.
  return source.replace(
    /^([ \t]*[\w.-]+[ \t]*(?:<<)?--?(?:>>?|x|\))[+-]?[ \t]*[\w.-]+[ \t]*:)(.*)$/gm,
    (_, prefix: string, label: string) =>
      prefix + label.replace(/#\w+;|;(?=[ \t]*\S)/g, (value) => (value === ";" ? "#59;" : value)),
  )
}

async function loadMermaid() {
  const { default: mermaid } = await import("mermaid")
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: document.documentElement.dataset.colorScheme === "light" ? "default" : "dark",
    flowchart: { htmlLabels: false },
  })
  return mermaid
}
