import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const cont = url.searchParams.get("continue") ?? ""
  const callbackUrl = new URL(`./callback${cont}`, input.request.url)
  const result = await AuthClient.authorize(callbackUrl.toString(), "code")
  return Response.redirect(result.url, 302)
}
