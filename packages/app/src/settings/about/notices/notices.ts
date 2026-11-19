import apache from "./apache-2.0.txt?raw"
import betterOfficeNotice from "./betteroffice-notice.txt?raw"
import { crates, crateTexts } from "./crates"
import { fonts } from "./fonts"
import nerdFontsLicenses from "./nerd-fonts-licenses.txt?raw"
import nerdFontsNotice from "./nerd-fonts-notice.txt?raw"

/**
 * Third-party software that ships inside the app, with the attribution its license asks redistributions to carry.
 * Notices and license texts are reproduced verbatim from each project, so they are not translated.
 */
export const notices = [
  {
    name: "OpenMono",
    detail: undefined,
    detailKey: "settings.about.notices.openMono" as const,
    // The font has no public page to link to yet.
    url: undefined,
    license: "SIL Open Font License 1.1",
    // The copyright lines of public/assets/OpenMono-OFL.txt; script/openmono.ts fails when they differ.
    notice: [
      "Copyright (c) 2015-2026, Belleve Invis (belleve@typeof.net).",
      "Copyright (c) 2025, Ahmed Hatem (https://github.com/ahatem).",
      "Copyright (c) 2026, Anomaly.",
    ].join("\n"),
    text: fonts.license,
  },
  {
    name: "Nerd Fonts",
    detail: undefined,
    detailKey: "settings.about.notices.nerdFonts" as const,
    url: "https://github.com/ryanoasis/nerd-fonts",
    license: "MIT, CC BY 4.0, Apache License 2.0, SIL Open Font License 1.1",
    notice: nerdFontsNotice.trim(),
    // The license files the patcher ships; Material Design Icons names the Apache License 2.0 without its text.
    text: `${nerdFontsLicenses.trim()}\n\n${apache}`,
  },
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
