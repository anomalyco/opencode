let sequence = 0

export async function renderMermaidSvg(source: string) {
  const pele = await import("pele/lazy")

  if (!pele.detectType(source)) return

  const result = await pele.renderAsync(source, {
    idPrefix: `markdown-mermaid-${sequence++}-`,
    // Pele sizes boxes from measured label widths, so it must measure the font the CSS applies.
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans"),
    fontSize: 14,
    // https images load directly; scheme-less and file: paths load from disk like Markdown images.
    images: true,
    imageSchemes: ["https", "file"],
    linkRel: "noopener noreferrer",
  })

  return result.svg
}
