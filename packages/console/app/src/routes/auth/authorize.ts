import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"

export async function GET(input: APIEvent) {
  const result = await AuthClient.authorize(new URL("./callback", input.request.url).toString(), "code")
  return Response.redirect(result.url, 302)
}
