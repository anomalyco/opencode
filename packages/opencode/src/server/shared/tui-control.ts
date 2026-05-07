import z from "zod"
import { AsyncQueue } from "@/util/queue"

export const TuiRequest = z.object({
  path: z.string(),
  body: z.any(),
})

export type TuiRequest = z.infer<typeof TuiRequest>

const request = new AsyncQueue<TuiRequest>()
const response = new AsyncQueue<unknown>()

export function nextTuiRequest() {
  return request.next()
}

export function submitTuiRequest(body: TuiRequest) {
  request.push(body)
}

export function submitTuiResponse(body: unknown) {
  response.push(body)
}

export function nextTuiResponse() {
  return response.next()
}
