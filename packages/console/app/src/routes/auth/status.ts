import { APIEvent } from "@solidjs/start"
import { useAuthSession } from "~/context/auth"

export async function GET(_input: APIEvent) {
  const session = await useAuthSession()
  return Response.json(session.data)
}
