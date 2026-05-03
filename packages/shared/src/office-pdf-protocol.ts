// FORK-only: side-band protocol for marking Office files whose PDF bytes
// should be fetched from `/file/office-pdf` instead of being base64-embedded
// in the Content payload. Producer: opencode/src/file/index.ts. Consumer:
// ui/src/pierre/media.ts. The dedicated vendor MIME means fork no longer
// extends `Content.encoding` enum, so upstream Content schema rewrites stay
// 0-conflict on this surface. See docs/features/zod-schema-bridge/.

export const OFFICE_PDF_REF_MIME = "application/x-deskfox-pdf-ref"

export function isOfficePdfRefMime(mime: string | undefined): boolean {
  return mime === OFFICE_PDF_REF_MIME
}
