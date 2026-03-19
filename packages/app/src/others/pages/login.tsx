import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Splash } from "@opencode-ai/ui/logo"
import { createSignal, Show } from "solid-js"
import { useAuth } from "../context/auth"

interface LoginPageProps {
  onLoginSuccess: () => void
}

export function LoginPage(props: LoginPageProps) {
  const auth = useAuth()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")

  const handleSubmit = async (e: Event) => {
    e.preventDefault()

    const success = await auth.login(username(), password())
    if (success) {
      props.onLoginSuccess()
    }
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-8">
        {/* Logo */}
        <Splash class="w-16 h-20" />

        {/* Title */}
        <div class="text-center">
          <h1 class="text-20-semibold text-text-strong">OpenCode</h1>
          <p class="text-14-regular text-text-base mt-1">Sign in to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} class="w-full flex flex-col gap-4">
          <TextField
            label="Username"
            placeholder="Enter your username"
            value={username()}
            onChange={setUsername}
            required
            disabled={auth.isLoading}
          />

          <TextField
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={password()}
            onChange={setPassword}
            required
            disabled={auth.isLoading}
          />

          {/* Error Message */}
          <Show when={auth.error}>
            <div class="text-14-regular text-danger-base bg-danger-surface p-3 rounded-lg">{auth.error}</div>
          </Show>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="primary"
            class="w-full mt-2"
            disabled={auth.isLoading || !username() || !password()}
          >
            {auth.isLoading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        {/* Help Text */}
        <p class="text-12-regular text-text-weak text-center">
          Contact your administrator if you don't have an account.
        </p>
      </div>
    </div>
  )
}
