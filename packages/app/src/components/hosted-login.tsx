import { Card } from "@opencode-ai/ui/card"
import { Logo } from "@opencode-ai/ui/logo"
import { createSignal } from "solid-js"
import { useHosted } from "@/context/hosted"

export function HostedLogin() {
  const hosted = useHosted()
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!email().trim() || !password()) return
    await hosted.login(email(), password())
  }

  return (
    <div class="min-h-screen w-full flex items-center justify-center px-4">
      <Card class="w-full max-w-[420px] p-6 flex flex-col gap-5">
        <div class="flex flex-col items-center gap-3 text-center">
          <Logo class="w-48 opacity-18" />
          <div class="flex flex-col gap-1">
            <h1 class="text-18-medium text-text-strong">Sign in to Numeral</h1>
            <p class="text-14-regular text-text-weak">Use your customer account to access shared workspaces.</p>
          </div>
        </div>

        <form class="flex flex-col gap-3" onSubmit={submit}>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            Email
            <input
              type="email"
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
              class="h-10 rounded-lg border border-border-base bg-surface-base px-3 text-14-regular text-text-strong"
              autocomplete="username"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-weak">
            Password
            <input
              type="password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              class="h-10 rounded-lg border border-border-base bg-surface-base px-3 text-14-regular text-text-strong"
              autocomplete="current-password"
            />
          </label>
          <button
            type="submit"
            disabled={hosted.loading()}
            class="h-10 rounded-lg bg-surface-inverse-base px-4 text-14-medium text-text-inverse disabled:opacity-50"
          >
            {hosted.loading() ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div class="min-h-5 text-12-regular text-icon-critical-base">{hosted.error()}</div>
      </Card>
    </div>
  )
}
