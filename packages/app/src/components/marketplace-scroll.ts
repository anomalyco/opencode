type ScrollTarget = {
  scrollTop: number
}

export async function preserveMarketplaceScroll<T>(
  target: () => ScrollTarget | undefined,
  task: () => T | Promise<T>,
  schedule: (callback: () => void) => unknown = requestAnimationFrame,
) {
  const scrollTop = target()?.scrollTop
  try {
    return await task()
  } finally {
    if (scrollTop !== undefined) {
      schedule(() => {
        const current = target()
        if (current) current.scrollTop = scrollTop
      })
    }
  }
}
