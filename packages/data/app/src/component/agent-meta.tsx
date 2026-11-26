import { Link } from "@solidjs/meta"
import { Show } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { jsonUrl, markdownUrl } from "../lib/language"

export function JsonLd(props: { data: object }) {
  // Escape "<" so values from the catalog can never close the script element.
  return <script type="application/ld+json" innerHTML={JSON.stringify(props.data).replaceAll("<", "\\u003c")} />
}

export function FormatLinks(props: { path: string; json?: boolean }) {
  return (
    <>
      <Link rel="alternate" type="text/markdown" href={markdownUrl(props.path)} />
      <Show when={props.json !== false}>
        <Link rel="alternate" type="application/json" href={jsonUrl(props.path)} />
      </Show>
    </>
  )
}

export function LastModified(props: { value: string | null | undefined }) {
  const event = getRequestEvent()
  if (event && props.value) event.response.headers.set("Last-Modified", new Date(props.value).toUTCString())
  return null
}

export function breadcrumbList(items: { name: string; url: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

export const openCodeOrganization = { "@type": "Organization", name: "OpenCode", url: "https://opencode.ai" }
