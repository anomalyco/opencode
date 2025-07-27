import { Global } from "../global"
import { Installation } from "../installation"
import path from "path"

export namespace Trace {
  export function init() {
    if (!Installation.isDev()) return
    const writer = Bun.file(path.join(Global.Path.data, "log", "fetch.log")).writer()

    const originalFetch = globalThis.fetch
    // @ts-expect-error
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method || "GET"

      const urlObj = new URL(url)

      writer.write(`\n${method} ${urlObj.pathname}${urlObj.search} HTTP/1.1\n`)
      writer.write(`Host: ${urlObj.host}\n`)

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            writer.write(`${key}: ${value}\n`)
          })
        } else {
          for (const [key, value] of Object.entries(init.headers)) {
            writer.write(`${key}: ${value}\n`)
          }
        }
      }

      if (init?.body) {
        writer.write(`\n${init.body}`)
      }
      writer.flush()
      const response = await originalFetch(input, init)
      const clonedResponse = response.clone()
      writer.write(`\nHTTP/1.1 ${response.status} ${response.statusText}\n`)
      response.headers.forEach((value, key) => {
        writer.write(`${key}: ${value}\n`)
      })
      if (clonedResponse.body) {
        clonedResponse.text().then(async (x) => {
          writer.write(`\n${x}\n`)
        })
      }
      writer.flush()

      return response
    }
  }
}
