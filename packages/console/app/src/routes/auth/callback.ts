import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { AuthClient } from "~/context/auth"
import { useAuthSession } from "~/context/auth"

export async function GET(input: APIEvent) {
  const url = new URL(input.request.url)
  try {
    const code = url.searchParams.get("code")
    if (!code) throw new Error("No code found")
    const result = await AuthClient.exchange(code, `${url.origin}${url.pathname}`)
    if (result.err) throw new Error(result.err.message)
    const decoded = AuthClient.decode(result.tokens.access, {} as any)
    if (decoded.err) throw new Error(decoded.err.message)
    const session = await useAuthSession()
    const id = decoded.subject.properties.accountID
    await session.update((value) => {
      return {
        ...value,
        account: {
          ...value.account,
          [id]: {
            id,
            email: decoded.subject.properties.email,
          },
        },
        current: id,
      }
    })
    return redirect("/auth")
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        error: e.message,
        cause: Object.fromEntries(url.searchParams.entries()),
      }),
      { status: 500 },
    )
  }
}
