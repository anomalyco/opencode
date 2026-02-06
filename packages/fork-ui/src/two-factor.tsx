import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

type TwoFactorBootstrap = {
  token: string
  username: string
  timeoutSeconds: number
}

declare global {
  interface Window {
    __OPENCODE_2FA__?: TwoFactorBootstrap
  }
}

export function TwoFactorApp() {
  const bootstrap = window.__OPENCODE_2FA__
  const token = bootstrap?.token ?? ""
  const username = bootstrap?.username ?? ""
  const initialTimeout = bootstrap?.timeoutSeconds ?? 300

  const [state, setState] = createStore({
    code: "",
    rememberDevice: false,
    submitting: false,
    submitLabel: "Verify",
    error: "",
    invalidCode: false,
  })
  const [remainingSeconds, setRemainingSeconds] = createSignal(initialTimeout)

  const countdownClass = createMemo(() => {
    const remaining = remainingSeconds()
    if (remaining <= 30) return "critical"
    if (remaining <= 60) return "warning"
    return "normal"
  })

  const startCountdown = () => {
    if (!Number.isFinite(remainingSeconds()) || remainingSeconds() <= 0) {
      window.location.href = "/auth/login"
      return undefined
    }

    return window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          window.location.href = "/auth/login"
          return 0
        }
        return current - 1
      })
    }, 1000)
  }

  onMount(() => {
    const timerId = startCountdown()
    if (timerId) {
      onCleanup(() => window.clearInterval(timerId))
    }
  })

  const handleCodeInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const rawValue = event.currentTarget.value
    const digitsOnly = rawValue.replace(/\D/g, "").slice(0, 8)
    setState({
      code: digitsOnly,
      invalidCode: false,
    })

    if (digitsOnly.length === 6) {
      event.currentTarget.form?.requestSubmit()
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    if (state.submitting) return

    setState({ error: "", invalidCode: false })

    const code = state.code.trim()
    if (!code || code.length < 6) {
      setState({ invalidCode: true })
      return
    }

    setState({
      submitting: true,
      submitLabel: "Verifying...",
    })

    try {
      const res = await fetch("/auth/login/2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          twoFactorToken: token,
          code,
          rememberDevice: state.rememberDevice,
        }),
      })

      if (res.ok) {
        setState("submitLabel", "Redirecting...")
        window.location.href = "/"
        return
      }

      const data = await res.json()
      if (data.error === "token_expired") {
        window.location.href = "/auth/login"
        return
      }

      setState({
        error: data.message || "Verification failed",
        invalidCode: true,
        code: "",
        submitting: false,
        submitLabel: "Verify",
      })
    } catch {
      setState({
        error: "Connection error",
        submitting: false,
        submitLabel: "Verify",
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
          margin: 0 auto 2rem;
          display: block;
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
        .prompt {
          font-size: 0.875rem;
          color: #d4d4d4;
          text-align: center;
          margin-bottom: 0.5rem;
        }
        .prompt strong {
          color: #e5e5e5;
        }
        .hint {
          font-size: 0.75rem;
          color: #737373;
          text-align: center;
          line-height: 1.4;
        }
        .code-input {
          width: 100%;
          height: 48px;
          padding: 0 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #1a1a1a;
          color: #e5e5e5;
          font-size: 24px;
          font-family: ui-monospace, "SF Mono", Menlo, Monaco, monospace;
          text-align: center;
          letter-spacing: 0.5em;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .code-input:focus {
          outline: none;
          border-color: #525252;
          box-shadow: 0 0 0 3px rgba(82,82,82,0.3), 0 0 0 1px #525252;
        }
        .code-input.invalid {
          background: rgba(239,68,68,0.1);
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.3), 0 0 0 1px #dc2626;
        }
        .code-input::placeholder { color: #525252; letter-spacing: 0.2em; }
        .checkbox-wrapper {
          display: flex;
          align-items: center;
          gap: 0.5rem;
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
        .timer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          padding: 0.5rem;
          border-radius: 6px;
          background: rgba(82,82,82,0.2);
        }
        .timer-text { color: #a3a3a3; }
        .timer-countdown {
          font-family: ui-monospace, "SF Mono", Menlo, Monaco, monospace;
          font-weight: 600;
          min-width: 2.5em;
          text-align: center;
        }
        .timer-countdown.warning { color: #facc15; }
        .timer-countdown.critical { color: #f87171; }
        .timer-countdown.normal { color: #a3a3a3; }
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
        .back-link {
          display: block;
          text-align: center;
          margin-top: 1rem;
          font-size: 0.875rem;
          color: #737373;
          text-decoration: none;
        }
        .back-link:hover { color: #a3a3a3; }
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
          <div class="prompt">
            Enter verification code for <strong>{username}</strong>
          </div>

          <div class="error" classList={{ visible: Boolean(state.error) }}>
            {state.error}
          </div>

          <div class="field">
            <input
              type="text"
              id="code"
              name="code"
              class="code-input"
              classList={{ invalid: state.invalidCode }}
              placeholder="000000"
              maxLength={8}
              autocomplete="one-time-code"
              inputmode="numeric"
              pattern="[0-9]*"
              autofocus
              required
              value={state.code}
              onInput={handleCodeInput}
            />
          </div>

          <div class="hint">Enter 6-digit code from your authenticator app or a backup code</div>

          <div class="checkbox-wrapper">
            <input
              type="checkbox"
              id="rememberDevice"
              name="rememberDevice"
              checked={state.rememberDevice}
              onChange={(event) => setState("rememberDevice", event.currentTarget.checked)}
            />
            <label for="rememberDevice" class="checkbox-label">
              Remember this device
            </label>
          </div>

          <div class="timer">
            <span class="timer-text">Session expires in</span>
            <span class="timer-countdown" classList={{ [countdownClass()]: true }}>
              {remainingSeconds()}
            </span>
          </div>

          <button type="submit" disabled={state.submitting}>
            {state.submitLabel}
          </button>
        </form>

        <a href="/auth/login" class="back-link">
          Back to login
        </a>
      </div>
    </>
  )
}
