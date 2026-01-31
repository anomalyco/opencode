import { Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"

type LoginBootstrap = {
  shouldWarn?: boolean
  shouldBlock?: boolean
  isSecure?: boolean
}

declare global {
  interface Window {
    __OPENCODE_LOGIN__?: LoginBootstrap
  }
}

const HTTP_WARNING_KEY = "http-warning-dismissed"

export function LoginApp() {
  const bootstrap = window.__OPENCODE_LOGIN__ ?? {}
  const shouldWarn = Boolean(bootstrap.shouldWarn)
  const shouldBlock = Boolean(bootstrap.shouldBlock)

  const [state, setState] = createStore({
    username: "",
    password: "",
    rememberMe: true,
    submitting: false,
    submitLabel: "Sign In",
    error: "",
    showPassword: false,
    invalidUsername: false,
    invalidPassword: false,
    warningDismissed: false,
  })

  onMount(() => {
    if (!shouldWarn) return
    if (sessionStorage.getItem(HTTP_WARNING_KEY)) {
      setState("warningDismissed", true)
    }
  })

  const dismissWarning = () => {
    sessionStorage.setItem(HTTP_WARNING_KEY, "true")
    setState("warningDismissed", true)
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    if (shouldBlock || state.submitting) return

    setState({
      error: "",
      invalidUsername: false,
      invalidPassword: false,
    })

    let valid = true
    if (!state.username.trim()) {
      setState("invalidUsername", true)
      valid = false
    }
    if (!state.password) {
      setState("invalidPassword", true)
      valid = false
    }
    if (!valid) return

    setState({
      submitting: true,
      submitLabel: "Signing in...",
    })

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          username: state.username,
          password: state.password,
          rememberMe: state.rememberMe,
        }),
      })

      const data = await res.json()

      if (data.error === "2fa_required") {
        setState("submitLabel", "Redirecting...")
        const params = new URLSearchParams({
          token: data.twoFactorToken,
          username: data.username,
          timeout: String(data.timeoutSeconds),
        })
        window.location.href = `/auth/2fa?${params.toString()}`
        return
      }

      if (data.error === "2fa_setup_required") {
        setState("submitLabel", "Redirecting to 2FA setup...")
        const setupUrl = data.canSkip ? "/auth/2fa/setup" : "/auth/2fa/setup?required=1"
        window.location.href = setupUrl
        return
      }

      if (res.ok && data.success) {
        setState("submitLabel", "Redirecting...")
        window.location.href = "/"
        return
      }

      setState({
        error: data.message || "Authentication failed",
        submitting: false,
        submitLabel: "Sign In",
      })
    } catch {
      setState({
        error: "Connection error",
        submitting: false,
        submitLabel: "Sign In",
      })
    }
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #0a0a0a;
          color: #e5e5e5;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        .logo {
          width: 80px;
          height: 100px;
          margin-bottom: 2rem;
        }
        .card {
          width: 100%;
          max-width: 360px;
          padding: 2rem;
          background: #141414;
          border: 1px solid #262626;
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.3);
        }
        form { display: flex; flex-direction: column; gap: 1.25rem; }
        .field { display: flex; flex-direction: column; gap: 0.5rem; }
        label {
          font-size: 0.75rem;
          font-weight: 500;
          color: #a3a3a3;
          letter-spacing: 0.01em;
        }
        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        input[type="text"], input[type="password"] {
          width: 100%;
          height: 36px;
          padding: 0 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #1a1a1a;
          color: #e5e5e5;
          font-size: 14px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        input:focus {
          outline: none;
          border-color: #525252;
          box-shadow: 0 0 0 3px rgba(82,82,82,0.3), 0 0 0 1px #525252;
        }
        input.invalid {
          background: rgba(239,68,68,0.1);
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.3), 0 0 0 1px #dc2626;
        }
        input.invalid:focus {
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.3), 0 0 0 1px #dc2626;
        }
        input::placeholder { color: #525252; }
        input:disabled {
          background: #0a0a0a;
          color: #525252;
          cursor: not-allowed;
          opacity: 0.5;
        }
        .password-toggle {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          color: #737373;
          transition: background-color 0.15s, color 0.15s;
        }
        .password-toggle:hover { background: #262626; }
        .password-toggle.active { color: #0ea5e9; }
        .password-toggle svg { width: 16px; height: 16px; }
        .password-input { padding-right: 36px; }
        .checkbox-wrapper {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: -0.25rem;
        }
        input[type="checkbox"] {
          width: 16px;
          height: 16px;
          accent-color: #0ea5e9;
          cursor: pointer;
        }
        .checkbox-label {
          font-size: 0.875rem;
          color: #a3a3a3;
          cursor: pointer;
          user-select: none;
        }
        .error {
          color: #fca5a5;
          font-size: 0.75rem;
          padding: 0.75rem;
          background: rgba(239,68,68,0.15);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: 8px;
          display: none;
        }
        .error.visible { display: block; }
        button[type="submit"] {
          height: 40px;
          border: none;
          border-radius: 8px;
          background: #e5e5e5;
          color: #0a0a0a;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s;
          margin-top: 0.5rem;
        }
        button[type="submit"]:hover { background: #d4d4d4; }
        button[type="submit"]:disabled {
          background: #404040;
          color: #737373;
          cursor: not-allowed;
        }
        .http-warning {
          background: rgba(234, 179, 8, 0.15);
          border: 1px solid rgba(234, 179, 8, 0.4);
          border-radius: 8px;
          padding: 0.75rem;
          margin-bottom: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .http-warning-text {
          color: #fbbf24;
          font-size: 0.75rem;
          line-height: 1.4;
        }
        .http-warning-dismiss {
          background: transparent;
          border: 1px solid rgba(234, 179, 8, 0.4);
          color: #fbbf24;
          font-size: 0.75rem;
          padding: 0.375rem 0.75rem;
          border-radius: 6px;
          cursor: pointer;
          align-self: flex-start;
        }
        .http-warning-dismiss:hover {
          background: rgba(234, 179, 8, 0.1);
        }
        .blocked-message {
          color: #fca5a5;
          font-size: 0.875rem;
          padding: 1rem;
          background: rgba(239,68,68,0.15);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: 8px;
          margin-bottom: 1.25rem;
          text-align: center;
          line-height: 1.5;
        }
        @media (max-width: 480px) {
          .card { padding: 1.5rem; border-radius: 8px; }
          .logo { width: 60px; height: 75px; margin-bottom: 1.5rem; }
        }
      `}</style>
      <svg class="logo" viewBox="0 0 80 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M60 80H20V40H60V80Z" fill="#525252" />
        <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="#e5e5e5" />
      </svg>

      <div class="card">
        <form onSubmit={handleSubmit}>
          <Show when={shouldBlock}>
            <div class="blocked-message">
              <strong>HTTPS is required to log in.</strong>
              <br />
              Please access this page over a secure connection.
            </div>
          </Show>

          <Show when={shouldWarn && !state.warningDismissed}>
            <div class="http-warning">
              <div class="http-warning-text">
                ⚠️ You are connecting over HTTP. Your credentials may be visible to attackers on this network.
              </div>
              <button type="button" class="http-warning-dismiss" onClick={dismissWarning}>
                I understand the risks
              </button>
            </div>
          </Show>

          <div class="error" classList={{ visible: Boolean(state.error) }}>
            {state.error}
          </div>

          <div class="field">
            <label for="username">Username</label>
            <div class="input-wrapper">
              <input
                id="username"
                type="text"
                name="username"
                required
                autofocus
                autocomplete="username"
                disabled={shouldBlock}
                value={state.username}
                classList={{ invalid: state.invalidUsername }}
                onInput={(event) => {
                  const value = event.currentTarget.value
                  setState({
                    username: value,
                    invalidUsername: false,
                  })
                }}
              />
            </div>
          </div>

          <div class="field">
            <label for="password">Password</label>
            <div class="input-wrapper">
              <input
                id="password"
                type={state.showPassword ? "text" : "password"}
                name="password"
                required
                autocomplete="current-password"
                disabled={shouldBlock}
                value={state.password}
                class="password-input"
                classList={{ invalid: state.invalidPassword }}
                onInput={(event) => {
                  const value = event.currentTarget.value
                  setState({
                    password: value,
                    invalidPassword: false,
                  })
                }}
              />
              <button
                type="button"
                class="password-toggle"
                classList={{ active: state.showPassword }}
                aria-label={state.showPassword ? "Hide password" : "Show password"}
                aria-pressed={state.showPassword}
                disabled={shouldBlock}
                onClick={() => setState("showPassword", !state.showPassword)}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 4.58325C5.83333 4.58325 2.5 9.99992 2.5 9.99992C2.5 9.99992 5.83333 15.4166 10 15.4166C14.1667 15.4166 17.5 9.99992 17.5 9.99992C17.5 9.99992 14.1667 4.58325 10 4.58325Z" />
                  <circle cx="10" cy="10" r="2.5" />
                </svg>
              </button>
            </div>
          </div>

          <div class="checkbox-wrapper">
            <input
              id="rememberMe"
              type="checkbox"
              name="rememberMe"
              checked={state.rememberMe}
              disabled={shouldBlock}
              onChange={(event) => setState("rememberMe", event.currentTarget.checked)}
            />
            <label for="rememberMe" class="checkbox-label">
              Remember me
            </label>
          </div>

          <Show when={!shouldBlock}>
            <button type="submit" disabled={state.submitting}>
              {state.submitLabel}
            </button>
          </Show>
        </form>
      </div>
    </>
  )
}
