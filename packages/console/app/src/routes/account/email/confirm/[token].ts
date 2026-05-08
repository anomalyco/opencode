import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start"
import { EmailChange } from "@opencode-ai/console-core/email-change.js"
import { useAuthSession } from "~/context/auth"

export async function GET(input: APIEvent) {
  const result = await EmailChange.confirm({ token: input.params.token }).catch(() => undefined)
  if (!result) return redirect("/workspace?emailChange=error")
  if (!result.complete) return redirect("/workspace?emailChange=pending")

  const session = await useAuthSession()
  const current = session.data.current
  if (current && session.data.account?.[current]) {
    await session.update((value) => ({
      ...value,
      account: {
        ...value.account,
        [current]: {
          ...value.account?.[current],
          id: current,
          email: result.email,
        },
      },
    }))
  }
  return redirect("/workspace")
}
