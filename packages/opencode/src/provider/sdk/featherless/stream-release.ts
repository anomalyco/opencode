/**
 * Wrap a Response so `release()` fires exactly once when the response body
 * is fully consumed, canceled by the consumer, or errors mid-stream.
 *
 * Releasing on response-headers-received would over-admit: probe 1 in
 * IMPLEMENTATION_PLAN.md showed the server holds the slot for the entire
 * stream and only frees it ~60 ms after the last content chunk.
 */
export function wrapResponseWithRelease(res: Response, release: () => void): Response {
  if (!res.body) {
    release()
    return res
  }

  let released = false
  const fire = () => {
    if (released) return
    released = true
    try {
      release()
    } catch {
      // release errors are advisory — never throw out of the stream wrapper
    }
  }

  const reader = res.body.getReader()
  const wrapped = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done } = await reader.read()
        if (done) {
          ctrl.close()
          fire()
          return
        }
        ctrl.enqueue(value)
      } catch (err) {
        fire()
        ctrl.error(err)
      }
    },
    async cancel(reason) {
      fire()
      try {
        await reader.cancel(reason)
      } catch {
        // already errored or canceled; release was the important part
      }
    },
  })

  return new Response(wrapped, {
    headers: res.headers,
    status: res.status,
    statusText: res.statusText,
  })
}
