export function shouldUseSessionHeaderV2(newLayoutDesigns: () => boolean) {
  return newLayoutDesigns()
}
