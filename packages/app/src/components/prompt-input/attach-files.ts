export async function attachFiles(list: FileList | null | undefined, add: (file: File) => Promise<void>) {
  if (!list?.length) return
  for (const file of Array.from(list)) {
    await add(file).catch(() => undefined)
  }
}
