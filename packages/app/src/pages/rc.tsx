import { createResource, Show } from "solid-js"

type RcQr = {
  url: string
  attach: string
  qr: string
}

async function fetchRcQr(): Promise<RcQr> {
  const res = await fetch("/rc/qr")
  if (!res.ok) throw new Error(`RC QR failed: ${res.status}`)
  return res.json() as Promise<RcQr>
}

export default function RcPage() {
  const [data] = createResource(fetchRcQr)

  return (
    <div class="flex flex-col items-center justify-center min-h-screen p-6 gap-6 bg-background text-foreground">
      <h1 class="text-2xl font-bold">Remote Control</h1>
      <p class="text-sm text-muted-foreground text-center max-w-md">
        Scan QR on phone or copy <code>opencode attach</code>. Add to Home Screen for app-like RC (like Claude Code).
      </p>
      <Show when={data.loading}>
        <p class="text-sm">Loading QR…</p>
      </Show>
      <Show when={data.error}>
        <p class="text-sm text-red-500">Failed: {String((data.error as Error)?.message)}</p>
      </Show>
      <Show when={data()}>
        {(rc) => (
          <div class="flex flex-col items-center gap-4 border rounded-xl p-6 bg-card">
            <img
              src={rc().qr}
              alt="RC QR"
              width={300}
              height={300}
              class="rounded-lg border bg-white"
            />
            <div class="w-full max-w-md space-y-3 text-sm">
              <div>
                <div class="font-semibold">Web URL</div>
                <div class="flex gap-2">
                  <code class="flex-1 break-all bg-muted px-2 py-1 rounded">{rc().url}</code>
                  <button
                    class="px-3 py-1 bg-primary text-primary-foreground rounded"
                    onClick={() => navigator.clipboard.writeText(rc().url)}
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <div class="font-semibold">Attach</div>
                <div class="flex gap-2">
                  <code class="flex-1 break-all bg-muted px-2 py-1 rounded">{rc().attach}</code>
                  <button
                    class="px-3 py-1 bg-primary text-primary-foreground rounded"
                    onClick={() => navigator.clipboard.writeText(rc().attach)}
                  >
                    Copy
                  </button>
                </div>
              </div>
              <a href={rc().url} target="_blank" class="block text-center text-primary underline">
                Open RC web →
              </a>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
