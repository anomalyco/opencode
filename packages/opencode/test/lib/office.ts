export async function zipBytes(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = await import("@zip.js/zip.js")
  const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"))
  for (const [name, content] of Object.entries(entries)) await writer.add(name, new zip.TextReader(content))
  return new Uint8Array(await new Response(await writer.close()).arrayBuffer())
}

export function docxBytes(text: string) {
  return zipBytes({
    "[Content_Types].xml":
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
    "word/document.xml":
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  })
}

export const OFFICE_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
