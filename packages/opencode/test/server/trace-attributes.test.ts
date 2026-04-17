import { describe, expect, test } from "bun:test"
import { requestAttributes } from "../../src/server/routes/instance/trace"

function fakeContext(method: string, url: string, params: Record<string, string>) {
  return {
    req: {
      method,
      url,
      param: () => params,
    },
  }
}

describe("requestAttributes", () => {
  test("includes http method and path", () => {
    const attrs = requestAttributes(fakeContext("GET", "http://localhost/session", {}))
    expect(attrs["http.method"]).toBe("GET")
    expect(attrs["http.path"]).toBe("/session")
  })

  test("strips query string from path", () => {
    const attrs = requestAttributes(fakeContext("GET", "http://localhost/file/search?query=foo&limit=10", {}))
    expect(attrs["http.path"]).toBe("/file/search")
  })

  test("tags route params with opencode.<param> prefix", () => {
    const attrs = requestAttributes(
      fakeContext("GET", "http://localhost/session/ses_abc/message/msg_def/part/prt_ghi", {
        sessionID: "ses_abc",
        messageID: "msg_def",
        partID: "prt_ghi",
      }),
    )
    expect(attrs["opencode.sessionID"]).toBe("ses_abc")
    expect(attrs["opencode.messageID"]).toBe("msg_def")
    expect(attrs["opencode.partID"]).toBe("prt_ghi")
  })

  test("produces no param attributes when no params are matched", () => {
    const attrs = requestAttributes(fakeContext("POST", "http://localhost/config", {}))
    expect(Object.keys(attrs).filter((k) => k.startsWith("opencode."))).toEqual([])
  })

  test("handles non-ID params (e.g. mcp :name) without mangling", () => {
    const attrs = requestAttributes(
      fakeContext("POST", "http://localhost/mcp/exa/connect", {
        name: "exa",
      }),
    )
    expect(attrs["opencode.name"]).toBe("exa")
  })
})
