import { describe, expect, test } from "bun:test"
import { isSessionNotFoundError, recoverSessionNotFound } from "./directory-sync-error"

describe("isSessionNotFoundError", () => {
  test("matches SDK-wrapped session not found errors", () => {
    const error = new Error("Session not found: ses_1", {
      cause: {
        body: {
          name: "NotFoundError",
          data: {
            message: "Session not found: ses_1",
          },
        },
        status: 404,
      },
    })

    expect(isSessionNotFoundError(error)).toBe(true)
  })

  test("matches tagged session not found errors", () => {
    const error = new Error("Session not found", {
      cause: {
        body: {
          name: "SessionNotFoundError",
        },
        status: 404,
      },
    })

    expect(isSessionNotFoundError(error)).toBe(true)
  })

  test("does not match unrelated not found errors", () => {
    const error = new Error("Provider not found", {
      cause: {
        body: {
          name: "NotFoundError",
          data: {
            message: "Provider not found: openai",
          },
        },
        status: 404,
      },
    })

    expect(isSessionNotFoundError(error)).toBe(false)
  })

  test("does not match non-404 session errors", () => {
    const error = new Error("Session not found: ses_1", {
      cause: {
        body: {
          name: "NotFoundError",
          data: {
            message: "Session not found: ses_1",
          },
        },
        status: 500,
      },
    })

    expect(isSessionNotFoundError(error)).toBe(false)
  })

  test("recovers session not found rejections", async () => {
    let recovered = false

    await recoverSessionNotFound(
      Promise.reject(
        new Error("Session not found: ses_1", {
          cause: {
            body: {
              name: "NotFoundError",
              data: {
                message: "Session not found: ses_1",
              },
            },
            status: 404,
          },
        }),
      ),
      () => {
        recovered = true
      },
    )

    expect(recovered).toBe(true)
  })

  test("rethrows unrelated rejections", async () => {
    const error = new Error("Provider not found", {
      cause: {
        body: {
          name: "NotFoundError",
          data: {
            message: "Provider not found: openai",
          },
        },
        status: 404,
      },
    })
    let result: unknown

    try {
      await recoverSessionNotFound(Promise.reject(error), () => {
        result = "recovered"
      })
    } catch (caught) {
      result = caught
    }

    expect(result).toBe(error)
  })
})
