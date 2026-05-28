import { restoreLibraryItems } from "@excalidraw/excalidraw"
import type { LibraryItem } from "@excalidraw/excalidraw/types"

import forms from "@/assets/excalidraw-libraries/forms.excalidrawlib?raw"
import stick from "@/assets/excalidraw-libraries/stick-figures.excalidrawlib?raw"
import drwnio from "@/assets/excalidraw-libraries/drwnio.excalidrawlib?raw"

type LibFile = {
  library?: Parameters<typeof restoreLibraryItems>[0]
  libraryItems?: Parameters<typeof restoreLibraryItems>[0]
}

function items(raw: string): LibraryItem[] {
  const data = JSON.parse(raw) as LibFile
  const src = data.libraryItems ?? data.library
  if (!src) return []
  return restoreLibraryItems(src, "published")
}

export const bundledLibraries = [...items(forms), ...items(stick), ...items(drwnio)]
