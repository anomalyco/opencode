import { Title, Meta } from "@solidjs/meta"
import { createSignal, onMount, Show } from "solid-js"
import { Splash } from "@opencode-ai/ui/logo"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { Card } from "@opencode-ai/ui/card"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { IconButton } from "@opencode-ai/ui/icon-button"
import "./login.css"

export default function Login() {
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [showPassword, setShowPassword] = createSignal(false)
  const [rememberMe, setRememberMe] = createSignal(false)
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [submitted, setSubmitted] = createSignal(false)
  let usernameInputRef: HTMLInputElement | undefined

  onMount(() => {
    usernameInputRef?.focus()
  })

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setSubmitted(true)

    // Validate required fields
    if (!username().trim() || !password()) {
      return
    }

    setError("")
    setLoading(true)

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          username: username(),
          password: password(),
        }),
      })

      if (res.ok) {
        window.location.href = "/"
      } else {
        const data = await res.json()
        setError(data.message || "Authentication failed")
      }
    } catch {
      setError("Connection error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main data-page="login">
      <Title>Login - opencode</Title>
      <Meta name="description" content="Login to opencode" />

      <Splash />

      <Card>
        <form onSubmit={handleSubmit}>
          <Show when={error()}>
            <div data-slot="error-message">{error()}</div>
          </Show>

          <TextField
            name="username"
            label="Username"
            type="text"
            value={username()}
            onChange={setUsername}
            required
            autoComplete="username"
            ref={usernameInputRef}
            validationState={submitted() && !username().trim() ? "invalid" : undefined}
          />

          <div data-slot="password-wrapper">
            <label data-slot="password-label">Password</label>
            <div data-slot="password-field">
              <TextField
                name="password"
                hideLabel
                label="Password"
                type={showPassword() ? "text" : "password"}
                value={password()}
                onChange={setPassword}
                required
                autoComplete="current-password"
                validationState={submitted() && !password() ? "invalid" : undefined}
              />
              <IconButton
                icon="eye"
                type="button"
                variant="ghost"
                aria-pressed={showPassword()}
                aria-label={showPassword() ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword())}
                data-slot="password-toggle"
              />
            </div>
          </div>

          <Checkbox checked={rememberMe()} onChange={setRememberMe}>
            Remember me
          </Checkbox>

          <Button type="submit" variant="primary" disabled={loading()}>
            {loading() ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </Card>
    </main>
  )
}
