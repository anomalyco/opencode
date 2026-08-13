export interface CatalogLocation {
  readonly screenId: string | undefined
  readonly flowId: string | undefined
  readonly variantId: string | undefined
  readonly mode: string | undefined
  readonly query: string
  readonly screenLabels: ReadonlyArray<string>
  readonly uiElements: ReadonlyArray<string>
  readonly surfaces: ReadonlyArray<string>
  readonly patterns: ReadonlyArray<string>
  readonly features: ReadonlyArray<string>
  readonly states: ReadonlyArray<string>
}

export function readCatalogLocation(url: URL): CatalogLocation {
  return {
    screenId: url.searchParams.get("screen") ?? undefined,
    flowId: url.searchParams.get("flow") ?? undefined,
    variantId: url.searchParams.get("set") ?? undefined,
    mode: url.searchParams.get("mode") ?? undefined,
    query: url.searchParams.get("q") ?? "",
    screenLabels: url.searchParams.getAll("screen-label"),
    uiElements: url.searchParams.getAll("ui-element"),
    surfaces: url.searchParams.getAll("surface"),
    patterns: url.searchParams.getAll("pattern"),
    features: url.searchParams.getAll("feature"),
    states: url.searchParams.getAll("state"),
  }
}

export function catalogBrowseUrl(
  location: Omit<CatalogLocation, "screenId" | "flowId">,
  current = new URL(window.location.href),
) {
  const url = new URL(current)
  url.searchParams.delete("screen")
  url.searchParams.delete("flow")
  set(url, "set", location.variantId ? [location.variantId] : [])
  set(url, "mode", location.mode && location.mode !== "screens" ? [location.mode] : [])
  set(url, "q", location.query ? [location.query] : [])
  set(url, "screen-label", location.screenLabels)
  set(url, "ui-element", location.uiElements)
  set(url, "surface", location.surfaces)
  set(url, "pattern", location.patterns)
  set(url, "feature", location.features)
  set(url, "state", location.states)
  return url.href
}

export function catalogDeepLink(
  screenId: string,
  options: { readonly flowId?: string; readonly variantId?: string } = {},
) {
  const url = new URL(window.location.href)
  url.hash = ""
  url.searchParams.set("screen", screenId)
  set(url, "flow", options.flowId ? [options.flowId] : [])
  set(url, "set", options.variantId ? [options.variantId] : [])
  return url.href
}

export function catalogRootUrl() {
  const url = new URL(window.location.href)
  url.hash = ""
  url.searchParams.delete("screen")
  url.searchParams.delete("flow")
  return url.href
}

function set(url: URL, key: string, values: ReadonlyArray<string>) {
  url.searchParams.delete(key)
  for (const value of values) url.searchParams.append(key, value)
}
