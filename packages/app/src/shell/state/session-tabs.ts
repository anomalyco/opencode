export type SessionTabs = {
  active?: string
  all: string[]
}

export type SessionTabState = {
  tabs: SessionTabs
  preview?: string
}

/** A launcher tab (e.g. the file browser) stays replaceable by the next preview even after reload. */
const sessionTabPreview = (current: SessionTabState, launchers: ReadonlySet<string>) =>
  current.preview ?? current.tabs.all.find((tab) => launchers.has(tab))

export function previewSessionTab(
  current: SessionTabState,
  tab: string,
  launchers: ReadonlySet<string> = new Set(),
): SessionTabState {
  const preview = sessionTabPreview(current, launchers)
  const previewIndex = preview ? current.tabs.all.indexOf(preview) : -1
  const existingIndex = current.tabs.all.indexOf(tab)

  if (existingIndex !== -1) {
    if (previewIndex === -1 || preview === tab) {
      return { tabs: { all: current.tabs.all, active: tab }, preview: preview === tab ? tab : undefined }
    }

    return {
      tabs: { all: current.tabs.all.filter((item) => item !== preview), active: tab },
    }
  }

  if (previewIndex === -1) {
    return { tabs: { all: [...current.tabs.all, tab], active: tab }, preview: tab }
  }

  return {
    tabs: {
      all: current.tabs.all.map((item, index) => (index === previewIndex ? tab : item)),
      active: tab,
    },
    preview: tab,
  }
}

/** A `first` tab is stored first and keeps the preview tab, so closing it selects the first remaining tab. */
export function openSessionTab(
  current: SessionTabState,
  tab: string,
  launchers: ReadonlySet<string> = new Set(),
  first = false,
): SessionTabState {
  const preview = sessionTabPreview(current, launchers)

  if (first) {
    return {
      tabs: { all: [tab, ...current.tabs.all.filter((item) => item !== tab)], active: tab },
      preview,
    }
  }

  const previewIndex = preview ? current.tabs.all.indexOf(preview) : -1
  const existingIndex = current.tabs.all.indexOf(tab)

  if (existingIndex !== -1) {
    if (previewIndex === -1 || preview === tab) {
      return { tabs: { all: current.tabs.all, active: tab } }
    }

    return {
      tabs: { all: current.tabs.all.filter((item) => item !== preview), active: tab },
    }
  }

  if (previewIndex === -1) {
    return { tabs: { all: [...current.tabs.all, tab], active: tab } }
  }

  return {
    tabs: {
      all: current.tabs.all.map((item, index) => (index === previewIndex ? tab : item)),
      active: tab,
    },
  }
}

export function closeSessionTab(current: SessionTabState, tab: string): SessionTabState {
  const all = current.tabs.all.filter((item) => item !== tab)
  const preview = current.preview === tab ? undefined : current.preview

  if (current.tabs.active !== tab) return { tabs: { ...current.tabs, all }, preview }

  const index = current.tabs.all.indexOf(tab)

  return {
    tabs: {
      all,
      active: current.tabs.all[index - 1] ?? current.tabs.all[index + 1] ?? all[0],
    },
    preview,
  }
}
