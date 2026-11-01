import type { Page, Route } from "@playwright/test"
import type { MockRequest, MockResponse, PrepareContext } from "@hona/strobe-bench"

type Handler = Parameters<Page["route"]>[1]

type Fulfill = {
  status?: number
  headers?: Record<string, string>
  body?: string | Buffer
  json?: object
  contentType?: string
}

/**
 * `page`, with its routes answered through strobe's `mock` (`prepare`'s `ctx.mock`). Playwright's routing turns the
 * browser's HTTP cache off for the whole page, so a case that reloads in `reset` would refetch every script, which no
 * person does; `mock` pauses only the mocked URLs. Everything else on the page is Playwright's, so the e2e mock server
 * and its fixtures run unchanged: routes keep Playwright's order (the latest answers first, `fallback` passes on).
 * Routes take URL globs and last for the whole case.
 */
export function cached(page: Page, mock: PrepareContext<unknown>["mock"]) {
  page.route = async (url, handler) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminates Playwright's own URL matcher union
    if (typeof url !== "string") throw new Error("strobe mocks URL globs; no benchmark routes by RegExp or predicate")

    await mock(url.replaceAll("**", "*"), (request) => answer(request, handler))

    return { dispose: kept, [Symbol.asyncDispose]: kept }
  }

  // The mock terminal's socket: no benchmark opens a terminal.
  page.routeWebSocket = async () => {}

  return page
}

async function kept() {
  throw new Error("a strobe mock cannot be removed")
}

// Runs a Playwright route handler against a paused request and resolves with what it fulfilled.
function answer(request: MockRequest, handler: Handler) {
  const done = Promise.withResolvers<MockResponse | undefined>()

  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
  )

  const route = {
    request: () => ({
      url: () => request.url,
      method: () => request.method,
      headers: () => headers,
      headerValue: async (name: string) => headers[name.toLowerCase()] ?? null,
      postDataBuffer: () => (request.body === undefined ? null : Buffer.from(request.body)),
    }),
    fulfill: async (response: Fulfill) => done.resolve(fulfilled(response)),
    fallback: async () => done.resolve(undefined),
    continue: async () => done.resolve(undefined),
  }

  // SAFETY: the e2e mock server and the benchmark fixtures call only these members of a route and its request.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const playwright = route as unknown as Route

  // A handler that throws after answering (an unmocked API request) reports in the runner's log.
  Promise.resolve(handler(playwright, playwright.request())).catch((error) => {
    console.error(error)
    done.resolve(undefined)
  })

  return done.promise
}

function fulfilled(response: Fulfill): MockResponse {
  const headers = { ...response.headers }

  if (response.contentType) headers["content-type"] = response.contentType

  if (response.json === undefined) return { status: response.status ?? 200, headers, body: response.body }
  headers["content-type"] = "application/json"

  return { status: response.status ?? 200, headers, body: JSON.stringify(response.json) }
}
