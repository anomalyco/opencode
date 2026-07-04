const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "
const defaultTitle = /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function createDefaultTitle(child: boolean) {
  return (child ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
}

export function isDefaultTitle(title: string) {
  return defaultTitle.test(title)
}
