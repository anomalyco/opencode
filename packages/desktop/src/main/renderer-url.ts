export function resolveRendererDevUrl(packaged: boolean, value?: string) {
  if (packaged || !value || !URL.canParse(value)) return undefined
  return new URL(value)
}
