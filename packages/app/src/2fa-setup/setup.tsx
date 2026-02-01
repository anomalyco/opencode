import { Show, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

type TwoFactorSetupBootstrap = {
  username: string
  secret: string
  qrCodeSvg: string
  setupCommand: string
  alreadyConfigured: boolean
  required?: boolean
}

declare global {
  interface Window {
    __OPENCODE_2FA_SETUP__?: TwoFactorSetupBootstrap
  }
}

function getCsrfToken(): string {
  const cookies = document.cookie.split("; ")
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=")
    if (name.trim() === "opencode_csrf") {
      return decodeURIComponent(valueParts.join("="))
    }
  }
  return ""
}

export function TwoFactorSetupApp() {
  const bootstrap = window.__OPENCODE_2FA_SETUP__
  const username = bootstrap?.username ?? ""
  const secret = bootstrap?.secret ?? ""
  const qrCodeSvg = bootstrap?.qrCodeSvg ?? ""
  const setupCommand = bootstrap?.setupCommand ?? ""
  const alreadyConfigured = Boolean(bootstrap?.alreadyConfigured)
  const required = Boolean(bootstrap?.required)

  const [state, setState] = createStore({
    code: "",
    submitting: false,
    submitLabel: "Verify & Enable 2FA",
    error: "",
    success: "",
    successVisible: false,
    codeDisabled: false,
    skipDisabled: false,
    skipLabel: "Skip for now",
  })
  const [copyLabel, setCopyLabel] = createSignal("Copy")
  let redirectTimer: number | undefined

  onCleanup(() => {
    if (redirectTimer) {
      window.clearInterval(redirectTimer)
    }
  })

  const handleCopy = async () => {
    const markCopied = () => {
      setCopyLabel("Copied!")
      window.setTimeout(() => setCopyLabel("Copy"), 2000)
    }

    try {
      await navigator.clipboard.writeText(setupCommand)
      markCopied()
      return
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = setupCommand
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      try {
        document.execCommand("copy")
        markCopied()
      } finally {
        document.body.removeChild(textarea)
      }
    }
  }

  const handleCodeInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const cleaned = event.currentTarget.value.replace(/\D/g, "").trim()
    if (cleaned !== event.currentTarget.value) {
      event.currentTarget.value = cleaned
    }
    setState({ code: cleaned })
    if (cleaned.length === 6) {
      event.currentTarget.form?.requestSubmit()
    }
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()
    if (state.submitting) return

    setState({ error: "" })

    const code = state.code.trim()
    if (!code || code.length !== 6) {
      setState("error", "Please enter a 6-digit code")
      return
    }

    setState({
      submitting: true,
      submitLabel: "Verifying...",
    })

    try {
      const res = await fetch("/auth/2fa/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": getCsrfToken(),
        },
        body: JSON.stringify({ code }),
      })

      if (res.ok) {
        setState({
          successVisible: true,
          success: "Verified... redirecting in 3",
          submitLabel: "Verified",
          submitting: true,
          codeDisabled: true,
        })

        let remaining = 3
        redirectTimer = window.setInterval(() => {
          remaining -= 1
          if (remaining <= 0) {
            if (redirectTimer) window.clearInterval(redirectTimer)
            window.location.href = "/"
            return
          }
          setState("success", `Verified... redirecting in ${remaining}`)
        }, 1000)
        return
      }

      const data = await res.json()
      setState({
        error: data.message || "Invalid code - make sure you ran the setup command first",
        submitting: false,
        submitLabel: "Verify & Enable 2FA",
        code: "",
      })
    } catch {
      setState({
        error: "Connection error",
        submitting: false,
        submitLabel: "Verify & Enable 2FA",
      })
    }
  }

  const handleSkip = async () => {
    if (state.skipDisabled) return
    setState({ skipDisabled: true, skipLabel: "Skipping..." })

    try {
      const res = await fetch("/auth/2fa/skip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": getCsrfToken(),
        },
      })

      if (res.ok) {
        window.location.href = "/"
        return
      }

      const data = await res.json()
      setState({
        error: data.message || "Failed to skip setup",
        skipDisabled: false,
        skipLabel: "Skip for now",
      })
    } catch {
      setState({
        error: "Connection error",
        skipDisabled: false,
        skipLabel: "Skip for now",
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
        .card {
          width: 100%;
          max-width: 480px;
          padding: 2rem;
          background: #141414;
          border: 1px solid #262626;
          border-radius: 12px;
        }
        h1 {
          font-size: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .subtitle {
          color: #737373;
          font-size: 0.875rem;
          margin-bottom: 1.5rem;
        }
        .warning {
          background: rgba(234, 179, 8, 0.15);
          border: 1px solid rgba(234, 179, 8, 0.4);
          border-radius: 8px;
          padding: 0.75rem;
          margin-bottom: 1.5rem;
          color: #fbbf24;
          font-size: 0.875rem;
        }
        .required-banner {
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.4);
          border-radius: 8px;
          padding: 0.75rem;
          margin-bottom: 1.5rem;
          color: #60a5fa;
          font-size: 0.875rem;
          text-align: center;
        }
        .skip-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid #333;
          text-align: center;
        }
        .skip-note {
          font-size: 0.75rem;
          color: #737373;
          margin-bottom: 0.75rem;
        }
        .skip-btn {
          background: transparent;
          border: 1px solid #525252;
          color: #a3a3a3;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.15s;
        }
        .skip-btn:hover {
          border-color: #737373;
          color: #e5e5e5;
        }
        .step {
          margin-bottom: 1.5rem;
        }
        .step-title {
          font-size: 0.875rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #a3a3a3;
        }
        .qr-container {
          display: flex;
          justify-content: center;
          padding: 1rem;
          background: #fff;
          border-radius: 8px;
          margin-bottom: 0.75rem;
        }
        .qr-container svg {
          width: 200px;
          height: 200px;
        }
        .secret-display {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.875rem;
          background: #1a1a1a;
          padding: 0.75rem;
          border-radius: 6px;
          word-break: break-all;
          text-align: center;
          color: #0ea5e9;
        }
        .command-container {
          position: relative;
          margin-top: 0.5rem;
        }
        .command-display {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.7rem;
          background: #1a1a1a;
          padding: 0.75rem;
          padding-right: 3rem;
          border-radius: 6px;
          white-space: pre-wrap;
          word-break: break-all;
          color: #a3a3a3;
          max-height: 150px;
          overflow-y: auto;
        }
        .copy-btn {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          background: #333;
          border: none;
          border-radius: 4px;
          padding: 0.35rem 0.5rem;
          cursor: pointer;
          color: #a3a3a3;
          font-size: 0.7rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          transition: all 0.15s;
        }
        .copy-btn:hover {
          background: #444;
          color: #e5e5e5;
        }
        .copy-btn.copied {
          background: #166534;
          color: #4ade80;
        }
        .copy-btn svg {
          width: 14px;
          height: 14px;
        }
        .install-details {
          margin-top: 0.75rem;
          border: 1px solid #333;
          border-radius: 6px;
          background: #1a1a1a;
        }
        .install-details summary {
          padding: 0.75rem;
          cursor: pointer;
          font-size: 0.75rem;
          color: #0ea5e9;
        }
        .install-details summary:hover {
          color: #38bdf8;
        }
        .install-details[open] summary {
          border-bottom: 1px solid #333;
        }
        .install-commands {
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .install-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          font-size: 0.75rem;
        }
        .install-row .os {
          color: #737373;
          min-width: 100px;
          flex-shrink: 0;
        }
        .install-row code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #a3a3a3;
          background: #0a0a0a;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
        }
        .safety-info {
          padding: 0.75rem;
          font-size: 0.75rem;
          line-height: 1.5;
          color: #a3a3a3;
        }
        .safety-info p {
          margin: 0 0 0.5rem 0;
        }
        .safety-info p:last-child {
          margin-bottom: 0;
        }
        .safety-info strong {
          color: #e5e5e5;
        }
        .safety-info code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          background: #0a0a0a;
          padding: 0.125rem 0.375rem;
          border-radius: 3px;
          font-size: 0.7rem;
        }
        .verify-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        label {
          font-size: 0.75rem;
          font-weight: 500;
          color: #a3a3a3;
        }
        input[type="text"] {
          width: 100%;
          height: 40px;
          padding: 0 12px;
          border: 1px solid #333;
          border-radius: 8px;
          background: #1a1a1a;
          color: #e5e5e5;
          font-size: 16px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          letter-spacing: 0.2em;
          text-align: center;
        }
        input:focus {
          outline: none;
          border-color: #525252;
        }
        .error {
          color: #fca5a5;
          font-size: 0.75rem;
          padding: 0.5rem;
          background: rgba(239,68,68,0.15);
          border-radius: 6px;
          display: none;
        }
        .error.visible { display: block; }
        .success {
          color: #4ade80;
          font-size: 0.875rem;
          padding: 0.75rem;
          background: rgba(74, 222, 128, 0.15);
          border-radius: 8px;
          text-align: center;
          display: none;
        }
        .success.visible { display: block; }
        button {
          height: 40px;
          border: none;
          border-radius: 8px;
          background: #e5e5e5;
          color: #0a0a0a;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
        }
        button:hover { background: #d4d4d4; }
        button:disabled { background: #404040; color: #737373; cursor: not-allowed; }
        .back-link {
          display: block;
          text-align: center;
          margin-top: 1rem;
          color: #737373;
          font-size: 0.75rem;
          text-decoration: none;
        }
        .back-link:hover { color: #a3a3a3; text-decoration: underline; }
        .note {
          font-size: 0.75rem;
          color: #737373;
          margin-top: 0.5rem;
        }
      `}</style>

      <div class="card">
        <h1>Set Up Two-Factor Authentication</h1>
        <p class="subtitle">for {username}</p>

        <Show when={required}>
          <div class="required-banner">
            Two-factor authentication is required. Please complete setup to continue.
          </div>
        </Show>

        <Show when={alreadyConfigured}>
          <div class="warning">
            You already have 2FA configured. Setting up again will replace your existing configuration.
          </div>
        </Show>

        <div class="step">
          <div class="step-title">Step 1: Scan QR Code</div>
          <p class="note">
            Scan this code with your authenticator app (Apple Passwords, Google Authenticator, Authy, 1Password,
            etc.)
          </p>
          <div class="qr-container" innerHTML={qrCodeSvg} />
          <p class="note">Or enter this secret manually:</p>
          <div class="secret-display">{secret}</div>
        </div>

        <div class="step">
          <div class="step-title">Step 2: Install and configure PAM module on the server (if needed)</div>
          <p class="note">
            Install <strong>libpam-google-authenticator</strong> on the same machine where opencode is running. This
            PAM module validates TOTP codes.
          </p>
          <details class="install-details">
            <summary>Installation instructions</summary>
            <div class="install-commands">
              <div class="install-row">
                <span class="os">Ubuntu/Debian:</span>
                <code>sudo apt install libpam-google-authenticator</code>
              </div>
              <div class="install-row">
                <span class="os">Fedora/RHEL:</span>
                <code>sudo dnf install google-authenticator</code>
              </div>
              <div class="install-row">
                <span class="os">Arch Linux:</span>
                <code>sudo pacman -S libpam-google-authenticator</code>
              </div>
              <div class="install-row">
                <span class="os">macOS:</span>
                <code>brew install google-authenticator-libpam</code>
              </div>
            </div>
            <p class="note" style={{ "margin-top": "0.75rem" }}>
              This is free, open source software:{" "}
              <a href="https://github.com/google/google-authenticator-libpam" target="_blank" rel="noopener">
                github.com/google/google-authenticator-libpam
              </a>
            </p>
          </details>
          <details class="install-details">
            <summary>PAM service file setup (required)</summary>
            <div class="safety-info">
              <p>
                Create the PAM service file at <code>/etc/pam.d/opencode-otp</code>:
              </p>
              <p>
                <strong>Linux:</strong>
              </p>
              <p>
                <code>echo &quot;auth required pam_google_authenticator.so nullok&quot; | sudo tee /etc/pam.d/opencode-otp</code>
              </p>
              <p>
                <strong>macOS (Apple Silicon):</strong>
              </p>
              <p>
                <code>
                  echo &quot;auth required /opt/homebrew/lib/security/pam_google_authenticator.so nullok&quot; | sudo tee
                  /etc/pam.d/opencode-otp
                </code>
              </p>
              <p>
                <strong>macOS (Intel):</strong>
              </p>
              <p>
                <code>
                  echo &quot;auth required /usr/local/lib/security/pam_google_authenticator.so nullok&quot; | sudo tee
                  /etc/pam.d/opencode-otp
                </code>
              </p>
            </div>
          </details>
        </div>

        <div class="step">
          <div class="step-title">Step 3: Run Setup Command on the Server</div>
          <p class="note">Run this command on the opencode server to create your 2FA configuration file:</p>
          <div class="command-container">
            <div class="command-display" id="setupCommand">
              {setupCommand}
            </div>
            <button type="button" class="copy-btn" classList={{ copied: copyLabel() !== "Copy" }} onClick={handleCopy}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>{copyLabel()}</span>
            </button>
          </div>
          <p class="note">This creates ~/.google_authenticator with the secret from Step 1.</p>
          <details class="install-details">
            <summary>Is this safe? Will it affect my system login?</summary>
            <div class="safety-info">
              <p>
                <strong>No, this will not affect your system login.</strong>
              </p>
              <p>
                The command creates a file at <code>~/.google_authenticator</code> containing your TOTP secret. This
                file is completely inert by itself.
              </p>
              <p>
                It only affects authentication when a PAM service explicitly loads it. Your system&apos;s login, sudo,
                and SSH use their own PAM configs which remain untouched. Opencode uses a separate PAM service file (
                <code>opencode-otp</code>) that only opencode reads.
              </p>
              <p>
                <strong>Multi-user:</strong> Each user has their own <code>~/.google_authenticator</code> in their home
                directory. Multiple users can independently configure 2FA.
              </p>
              <p>
                <strong>Existing file:</strong> The command will prompt before overwriting an existing configuration.
              </p>
              <p>
                <strong>Reversibility:</strong> Run <code>rm ~/.google_authenticator</code> to remove 2FA.
              </p>
            </div>
          </details>
        </div>

        <div class="step">
          <div class="step-title">Step 4: Verify Setup</div>
          <p class="note">Enter a code from your authenticator app to verify it&apos;s working:</p>
          <form class="verify-form" onSubmit={handleSubmit}>
            <div class="error" classList={{ visible: Boolean(state.error) }}>
              {state.error}
            </div>
            <div class="success" classList={{ visible: state.successVisible }}>
              {state.success}
            </div>
            <div class="field">
              <input
                type="text"
                inputmode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={state.code}
                disabled={state.codeDisabled}
                onInput={handleCodeInput}
              />
            </div>
            <button type="submit" disabled={state.submitting}>
              {state.submitLabel}
            </button>
          </form>
        </div>

        <Show when={!required}>
          <div class="skip-section">
            <p class="skip-note">You can set up 2FA later from your session menu.</p>
            <button type="button" class="skip-btn" disabled={state.skipDisabled} onClick={handleSkip}>
              {state.skipLabel}
            </button>
          </div>
        </Show>

        <a href="/" class="back-link">
          {required ? "Back to login" : "Back to opencode"}
        </a>
      </div>
    </>
  )
}
