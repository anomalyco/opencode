import { createSignal, Show } from "solid-js"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Mark } from "@opencode-ai/ui/logo"

export default function LoginPage() {
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (busy()) return
    setBusy(true)
    setError("")

    const res = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username(),
        password: password(),
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.message || "Failed to log in")
      setBusy(false)
      return
    }

    window.location.href = "/"
  }

  return (
    <div class="flex h-screen w-full flex-col items-center justify-center bg-surface-base p-4">
      <div class="w-full max-w-sm rounded-lg bg-surface-raised-base p-6 shadow-sm">
        <div class="mb-8 flex flex-col items-center gap-4">
          <Mark class="h-12 w-12" />
          <h1 class="text-16-medium text-text-strong">Sign In</h1>
        </div>

        <Show when={error()}>
          <div class="mb-4 rounded-md bg-surface-critical-base p-3 text-14-regular text-text-on-critical-base">
            {error()}
          </div>
        </Show>

        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <TextField
            type="text"
            label="Username"
            placeholder="Enter your username"
            value={username()}
            onChange={setUsername}
            disabled={busy()}
            validationState={error() ? "invalid" : "valid"}
          />

          <TextField
            type="password"
            label="Password"
            placeholder="Enter your password"
            value={password()}
            onChange={setPassword}
            disabled={busy()}
            validationState={error() ? "invalid" : "valid"}
          />

          <Button
            type="submit"
            variant="primary"
            size="large"
            disabled={busy() || !username() || !password()}
            class="mt-4 w-full justify-center"
          >
            {busy() ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  )
}
