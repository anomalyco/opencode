import apache from "./apache-2.0.txt?raw"
import betterOfficeNotice from "./betteroffice-notice.txt?raw"
import { crates, crateTexts } from "./crates"

/**
 * Third-party software that ships inside the app, with the attribution its license asks redistributions to carry.
 * Notices and license texts are reproduced verbatim from each project, so they are not translated.
 */
export const notices = [
  {
    name: "BetterOffice",
    detail: "@betteroffice/docx, @betteroffice/xlsx, @betteroffice/pptx, @betteroffice/fonts",
    detailKey: undefined,
    url: "https://github.com/openooxml/betteroffice",
    license: "Apache License 2.0",
    notice: `${betterOfficeNotice.trim()}\nCopyright 2026 The OpenOOXML contributors`,
    text: apache,
  },
  {
    name: "eigenpal docx editor",
    detail: undefined,
    detailKey: "settings.about.notices.eigenpal" as const,
    url: "https://github.com/eigenpal/docx-editor",
    license: "Apache License 2.0",
    notice: "Copyright 2026 EigenPal Inc.",
    text: apache,
  },
]

/**
 * The Rust crates the BetterOffice wasm engines compile in, generated from the published Cargo.lock and crate
 * tarballs. Each crate keeps its own copyright lines; license texts are stored once and referenced by id.
 */
export const crateNotices = {
  crates,
  texts: [...crateTexts, { id: "apache-2.0", license: "Apache-2.0", title: "Apache License 2.0", text: apache }],
}
