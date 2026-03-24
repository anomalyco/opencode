// Browser-compatible 'open' module
export default function open(target: string): Promise<void> {
  window.open(target, "_blank")
  return Promise.resolve()
}
