let loaded: ReturnType<typeof loadMermaid> | undefined
let sequence = 0

export async function renderMermaidSvg(source: string) {
  const mermaid = await (loaded ??= loadMermaid())
  if (!(await mermaid.parse(source, { suppressErrors: true }))) return
  return (await mermaid.render(`markdown-mermaid-${sequence++}`, source)).svg
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
