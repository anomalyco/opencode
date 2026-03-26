export function targetTop(input: {
  itemTop: number
  rootTop: number
  scrollTop: number
  inset: number
}) {
  return Math.max(0, input.itemTop - input.rootTop + input.scrollTop - input.inset)
}
