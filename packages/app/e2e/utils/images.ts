import type { Locator, Page } from "@playwright/test"

export function imageFixture(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 1024
    canvas.height = 512
    const context = canvas.getContext("2d")!
    context.fillStyle = "#eac85c"
    context.fillRect(0, 0, 1024, 512)
    context.fillStyle = "#17406d"
    context.fillRect(0, 0, 512, 512)

    return canvas.toDataURL("image/png")
  })
}

export function pasteImage(editor: Locator, url: string, name = "artwork.png") {
  return editor.evaluate(
    async (element, input) => {
      const blob = await fetch(input.url).then((response) => response.blob())
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File([blob], input.name, { type: blob.type }))
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))
    },
    { url, name },
  )
}
