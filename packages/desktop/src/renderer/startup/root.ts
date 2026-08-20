export function requireRendererRoot() {
  const root = document.getElementById("root")
  if (root instanceof HTMLElement) return root
  if (import.meta.env.DEV)
    throw new Error(
      "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
    )
  return root!
}
