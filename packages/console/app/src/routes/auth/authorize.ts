import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  // TODO
  // input.request.url http://localhost:3001/auth/authorize?continue=/black/subscribe
  const result = await AuthClient.authorize(
    new URL("/callback/subscribe?foo=bar", input.request.url).toString(),
    "code",
  )
  // result.url https://auth.frank.dev.opencode.ai/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fcallback&response_type=code&state=0d3fc834-bcbc-42dc-83ab-c25c2c43c7e3
  return Response.redirect(result.url + "&continue=" + url.searchParams.get("continue"), 302)
}
