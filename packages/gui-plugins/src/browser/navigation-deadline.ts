/** A navigation still under way when its command's deadline passed. The page goes on loading and reports how it ends. */
export class NavigationDeadlineError extends Error {
  constructor() {
    super("The browser page did not finish starting or navigating. Reload the tab and inspect it before retrying.")
  }
}

/** How long a page may take to start or to load a navigation before its command stops waiting for it. */
export const NAVIGATION_DEADLINE_MS = 15_000

/** Do not leave a command behind a renderer that never starts. Do not retry the navigation for the caller. */
export function navigationDeadline<T>(work: Promise<T>, ms = NAVIGATION_DEADLINE_MS) {
  let timer: ReturnType<typeof setTimeout>

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NavigationDeadlineError()), ms)
  })

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}
