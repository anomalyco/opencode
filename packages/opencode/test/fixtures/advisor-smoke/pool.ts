export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer")
  const output: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        output[index] = await run(items[index])
      }
    }),
  )
  return output
}
