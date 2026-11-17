/** A navigation still under way when its command's deadline passed. The page goes on loading and reports how it ends. */
export class NavigationDeadlineError extends Error {
  constructor() {
    super("The browser page did not finish starting or navigating. Reload the tab and inspect it before retrying.")
  }
}

/** Do not leave a command behind a renderer that never starts. Do not retry the navigation for the caller. */
export function navigationDeadline<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NavigationDeadlineError()), 15_000)
  })

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}
