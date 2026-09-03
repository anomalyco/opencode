let mermaidModule: Promise<typeof import("mermaid")> | undefined
let initializedTheme: string | undefined
let nextID = 0

function themeMode() {
  return document.documentElement.dataset.colorScheme === "dark" ? "dark" : "default"
}

async function loadMermaid() {
  mermaidModule ??= import("mermaid")
  const { default: mermaid } = await mermaidModule
  const theme = themeMode()
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
    })
    initializedTheme = theme
  }
  return mermaid
}

export function isMermaidLanguage(language: string | undefined) {
  return language?.toLowerCase() === "mermaid"
}

export async function renderMermaid(container: HTMLElement, code: string) {
  const id = `mermaid-${nextID++}`
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(id, code)
    container.innerHTML = svg
    container.setAttribute("data-mermaid-rendered", "")
  } catch {
    container.textContent = code
    container.setAttribute("data-mermaid-error", "")
  }
}
