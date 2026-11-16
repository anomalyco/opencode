/** Do not leave a command behind a renderer that never starts. Do not retry the navigation for the caller. */
export function navigationDeadline<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The browser page did not finish starting or navigating. Reload the tab and inspect it before retrying.")), 15_000)
  })

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}
