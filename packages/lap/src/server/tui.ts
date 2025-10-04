import { Hono, type Context } from "hono"
import { AsyncQueue } from "../util/queue"

interface Request {
  path: string
  body: any
}

const request = new AsyncQueue<Request>()
const response = new AsyncQueue<any>()

export async function callTui(ctx: Context) {
  const body = await ctx.req.json()
  request.push({
    path: ctx.req.path,
    body,
  })
  return response.next()
}

export const TuiRoute = new Hono()
  .get("/next", async (c) => {
    const req = await request.next()
    return c.json(req)
  })
  .post("/response", async (c) => {
    const body = await c.req.json()
    response.push(body)
    return c.json(true)
  })
