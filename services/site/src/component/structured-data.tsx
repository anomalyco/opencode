import { config } from "~/config"

// Structured data (https://schema.org) for search engines, one JSON-LD script per type.

const organizationId = "https://anoma.ly/#organization"

/** One JSON-LD script. `<` is escaped so page copy can never close the script early. */
export function JsonLd(props: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      innerHTML={JSON.stringify({ "@context": "https://schema.org", ...props.data }).replace(/</g, "\\u003c")}
    />
  )
}

/** Anomaly, the company behind OpenCode. Other blocks refer to it by its `@id`. */
export const organizationData = {
  "@type": "Organization",
  "@id": organizationId,
  name: "Anomaly",
  url: "https://anoma.ly",
  logo: "https://anoma.ly/apple-touch-icon.png",
  sameAs: ["https://github.com/anomalyco", config.social.twitter, config.social.discord],
}

export function websiteData(language: string) {
  return {
    "@type": "WebSite",
    "@id": `${config.baseUrl}/#website`,
    name: "OpenCode",
    url: `${config.baseUrl}/`,
    inLanguage: language,
    publisher: { "@id": organizationId },
  }
}

export function softwareData(props: {
  name: string
  description: string
  path: string
  image: string
  operatingSystem: string
}) {
  return {
    "@type": "SoftwareApplication",
    name: props.name,
    description: props.description,
    url: `${config.baseUrl}${props.path}`,
    image: `${config.baseUrl}${props.image}`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: props.operatingSystem,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://opensource.org/licenses/MIT",
    publisher: { "@id": organizationId },
  }
}

/** A dated technical article, such as a release's notes. Release notes are written in English. */
export function techArticleData(props: {
  headline: string
  description: string
  path: string
  image: string
  date: string
  language: string
}) {
  return {
    "@type": "TechArticle",
    headline: props.headline.slice(0, 110),
    description: props.description,
    url: `${config.baseUrl}${props.path}`,
    mainEntityOfPage: `${config.baseUrl}${props.path}`,
    image: `${config.baseUrl}${props.image}`,
    datePublished: props.date,
    inLanguage: props.language,
    author: { "@id": organizationId },
    publisher: { "@id": organizationId },
    isPartOf: { "@id": `${config.baseUrl}/#website` },
  }
}

/** A trail from the home page to the current page. Paths are localized site paths. */
export function breadcrumbData(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${config.baseUrl}${item.path}`,
    })),
  }
}
