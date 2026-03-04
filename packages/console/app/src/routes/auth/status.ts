import { APIEvent } from "@solidjs/start"
import { useAuthSession } from "~/context/auth"

export async function GET(input: APIEvent) {
  const session = await useAuthSession()
  return Response.json(session.data)
}
