import { GEMINI_REDIRECT_URI } from "./constants"

interface OAuthListenerOptions {
  timeoutMs?: number
}

export interface OAuthListener {
  waitForCallback(): Promise<URL>
  close(): Promise<void>
}

const redirectUri = new URL(GEMINI_REDIRECT_URI)
const callbackPath = redirectUri.pathname || "/"

const SUCCESS_RESPONSE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Opencode Gemini OAuth</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "Roboto", "Google Sans", arial, sans-serif;
        background: #f1f3f4;
        color: #202124;
      }
      main {
        width: min(448px, calc(100% - 3rem));
        background: #ffffff;
        border-radius: 28px;
        padding: 2.5rem 2.75rem;
        box-shadow: 0 1px 2px rgba(60, 64, 67, 0.3), 0 2px 6px rgba(60, 64, 67, 0.15);
      }
      header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      .logo {
        width: 40px;
        height: 40px;
        display: inline-flex;
      }
      .logo svg {
        width: 100%;
        height: 100%;
      }
      .brand {
        font-size: 1.1rem;
        font-weight: 500;
        letter-spacing: 0.01em;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.75rem;
        font-weight: 500;
        letter-spacing: -0.01em;
      }
      p {
        margin: 0 0 1.75rem;
        font-size: 1.05rem;
        line-height: 1.6;
        color: #3c4043;
      }
      .note {
        margin: 1.5rem 0 0;
        font-size: 0.92rem;
        color: #5f6368;
      }
      .action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.65rem 1.85rem;
        border-radius: 999px;
        background: #1a73e8;
        color: #ffffff;
        font-weight: 500;
        font-size: 0.95rem;
        letter-spacing: 0.02em;
        text-decoration: none;
        transition: box-shadow 0.2s ease, transform 0.2s ease;
      }
      .action:hover {
        transform: translateY(-1px);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(60, 64, 67, 0.15);
      }
      .action:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.3);
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #131314;
          color: #e8eaed;
        }
        main {
          background: #202124;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4);
        }
        p {
          color: #e8eaed;
        }
        .note {
          color: #bdc1c6;
        }
        .action {
          background: #8ab4f8;
          color: #202124;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 46 46" xmlns="http://www.w3.org/2000/svg" role="img">
            <title>Gemini linked to Opencode</title>
            <path fill="#4285F4" d="M43.6 23.5c0-1.5-.1-3-.4-4.4H23v8.3h11.6c-.5 2.8-2 5.1-4.2 6.7v5.5h6.8c4-3.7 6.4-9.1 6.4-16.1z"/>
            <path fill="#34A853" d="M23 45c5.8 0 10.6-1.9 14.1-5.2l-6.8-5.5c-1.9 1.3-4.3 2-7.3 2-5.6 0-10.4-3.7-12.1-8.7H3.8v5.6C7.3 39.9 14.6 45 23 45z"/>
            <path fill="#FBBC04" d="M10.9 28.6c-.5-1.3-.8-2.7-.8-4.1 0-1.5.3-2.8.8-4.1v-5.6H3.8C2.3 17.7 1.5 20.2 1.5 24s.8 6.3 2.3 9.2l6.9-5.6z"/>
            <path fill="#EA4335" d="M23 9.5c3.2 0 6 .9 8.3 2.7l6.2-6.2C33.6 2.2 28.8 0 23 0 14.6 0 7.3 5.1 3.8 12.4l7.1 5.6c1.7-5 6.5-8.5 12.1-8.5z"/>
          </svg>
        </span>
        <span class="brand">Gemini linked to Opencode</span>
      </header>
      <h1>You're connected to Opencode</h1>
      <p>Your Google account is now linked to Opencode. You can close this window and continue in the CLI.</p>
      <a class="action" href="javascript:window.close()">Close window</a>
      <p class="note">Need to reconnect later? Re-run the authentication command in Opencode.</p>
    </main>
  </body>
</html>`

export async function startOAuthListener({ timeoutMs = 5 * 60 * 1000 }: OAuthListenerOptions = {}): Promise<OAuthListener> {
  const port = redirectUri.port
    ? Number.parseInt(redirectUri.port, 10)
    : redirectUri.protocol === "https:"
      ? 443
      : 80

  let settled = false
  let resolveCallback: (url: URL) => void
  let rejectCallback: (error: Error) => void

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url: URL) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve(url)
    }
    rejectCallback = (error: Error) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      reject(error)
    }
  })

  const timeoutHandle = setTimeout(() => {
    rejectCallback(new Error("Timed out waiting for OAuth callback"))
  }, timeoutMs)
  timeoutHandle.unref?.()

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== callbackPath) {
        return new Response("Not found", { status: 404 })
      }

      resolveCallback(url)

      queueMicrotask(() => {
        server.stop()
      })

      return new Response(SUCCESS_RESPONSE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      })
    },
  })

  return {
    waitForCallback: () => callbackPromise,
    close: async () => {
      server.stop()
      if (!settled) {
        rejectCallback(new Error("OAuth listener closed before callback"))
      }
    },
  }
}
