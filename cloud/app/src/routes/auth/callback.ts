import type { APIEvent } from "@solidjs/start/server"
import { AuthClient, useAuthSession } from "~/context/auth"

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  const code = url.searchParams.get("code")
  if (!code) throw new Error("No code found")
  const redirectURI = `${url.origin}${url.pathname}`
  console.log({
    redirectURI,
    code,
  })
  const result = await AuthClient.exchange(code, `${url.origin}${url.pathname}`)
  if (result.err) {
    throw new Error(result.err.message)
  }
  const decoded = AuthClient.decode(result.tokens.access, {} as any)
  if (decoded.err) throw new Error(decoded.err.message)
  const session = await useAuthSession()
  const id = decoded.subject.properties.accountID
  await session.update((value) => {
    return {
      ...value,
      account: {
        [id]: {
          id,
          email: decoded.subject.properties.email,
        },
      },
      current: id,
    }
  })
  return {
    result,
  }
}
