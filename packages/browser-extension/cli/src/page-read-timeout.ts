import type { Page } from "patchright-core"

const installed = new WeakSet<object>()

export type PageReadOperation = "page.title" | "page.content"

/** A bounded read did not settle; this does not establish renderer unresponsiveness. */
export class PageReadTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly operation: PageReadOperation = "page.title",
  ) {
    super(`${operation}() timed out after ${timeoutMs}ms: the page execution-context read did not complete; the context may be unavailable or busy.`)
    this.name = "PageReadTimeoutError"
  }
}

function wrapBoundedPageRead(
  read: () => Promise<string>,
  operation: PageReadOperation,
  timeoutMs: number,
): () => Promise<string> {
  return () => new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PageReadTimeoutError(timeoutMs, operation)), timeoutMs)
    Promise.resolve().then(read).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** Title and content are read-only, but Playwright passes kNoTimeout (timeout: 0) for their context waits. */
export function installPageReadTimeout(
  page: Pick<Page, "title"> & Partial<Pick<Page, "content">>,
  timeoutMs = 5_000,
): void {
  if (installed.has(page)) return
  installed.add(page)
  page.title = wrapBoundedPageRead(page.title.bind(page), "page.title", timeoutMs)
  if (page.content) {
    page.content = wrapBoundedPageRead(page.content.bind(page), "page.content", timeoutMs)
  }
}
