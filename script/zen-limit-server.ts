const retryAfterSeconds = 15 * 60

// const response = {
//   type: "error",
//   error: {
//     type: "FreeUsageLimitError",
//     message: "Free usage exceeded, subscribe to Go https://opencode.ai/go",
//   },
//   metadata: {},
// }

const response = {
  type: "error",
  error: {
    type: "GoUsageLimitError",
    message: "Subscription quota exceeded. You can continue using free models.",
  },
  metadata: {
    workspace: "wrk_01K6XGM22R6FM8JVABE9XDQXGH",
    limit: "5 hour",
    resetAt: retryAfterSeconds,
  },
}

Bun.serve({
  port: 4141,
  fetch() {
    return Response.json(response, {
      status: 429,
      headers: {
        "retry-after": String(retryAfterSeconds),
      },
    })
  },
})

console.log("Zen limit repro server listening on http://localhost:4141")
