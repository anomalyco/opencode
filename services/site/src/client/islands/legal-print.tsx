import { render } from "solid-js/web"
import { LegalPrint, legalReferences } from "~/component/site/legal-print"
import { siteSettings } from "~/component/site/settings"
import { parseLocale, route, strip } from "~/lib/language"
import { legalSections } from "~/lib/legal"
import { architectLayout, savedLayout } from "~/lib/legal/architect"
import { resolvePattern } from "~/lib/legal/cover-pattern"
import { legalDocuments } from "~/lib/legal-documents"
import { $, html } from "../dom"

let shown = false

/**
 * The legal document's print cover and colophon (legal-print.tsx), rendered where the server would
 * put them: the cover first on the page, the colophon after the text. Synchronous, so a `beforeprint`
 * listener can call it and the printout has them. As legal.tsx picks them, with production's settings
 * and a layout saved in the layout editor.
 */
export function showPrint() {
  const document = legalDocuments.find((item) => item.path === strip(location.pathname))
  const page = $('[data-slot="page"]')
  const body = $('[data-component="legal-body"]')
  if (shown || !document || !page || !body) return
  shown = true
  const locale = parseLocale(html.dataset.locale) ?? "en"
  const sections = legalSections(document.body)
  const references = legalReferences(document.body, (path) => route(locale, path))
  const pattern = resolvePattern(siteSettings.architectPattern)
  const [cover, colophon] = [0, 1].map(() => {
    const host = window.document.createElement("div")
    host.style.display = "contents"
    return host
  })
  page.prepend(cover)
  body.append(colophon)
  render(
    () => (
      <LegalPrint
        style={siteSettings.legalPrintStyle}
        part="cover"
        layout={savedLayout() ?? architectLayout(siteSettings.architectCover, siteSettings.architectInterior)}
        divider={siteSettings.architectRule}
        labelCase={siteSettings.architectLabelCase}
        pattern={pattern === "grid" ? undefined : pattern}
        patternId={siteSettings.architectPattern}
        document={document}
        sections={sections}
        references={references}
      />
    ),
    cover,
  )
  render(
    () => (
      <LegalPrint
        style={siteSettings.legalPrintStyle}
        part="colophon"
        labelCase={siteSettings.architectLabelCase}
        document={document}
        sections={sections}
        references={references}
      />
    ),
    colophon,
  )
}
