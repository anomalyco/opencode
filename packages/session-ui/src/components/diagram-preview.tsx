import { useDialog } from "@opencode/ui/context/dialog"
import { DiagramPreview } from "@opencode/ui/diagram-preview"

// Opens a rendered Mermaid diagram maximized when its button is pressed. The preview gets its own copy, so the diagram
// in the message stays where it is, and keeps updating while it streams.
export function createDiagramPreview() {
  const dialog = useDialog()

  return (root: HTMLElement) => {
    const open = (event: MouseEvent) => {
      const button = event.target instanceof Element && event.target.closest('[data-slot="markdown-mermaid-maximize"]')

      if (!button) return

      const svg = button.parentElement
        ?.querySelector(':scope > [data-component="markdown-mermaid"] > svg')
        ?.cloneNode(true)

      if (!(svg instanceof SVGSVGElement)) return
      event.preventDefault()
      dialog.show(() => <DiagramPreview svg={svg} />)
    }

    root.addEventListener("click", open)

    return () => root.removeEventListener("click", open)
  }
}
