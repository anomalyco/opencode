import type { APIEvent } from "@solidjs/start/server"

// Development only: the video editor's API (src/component/video-editor/server.ts). Production builds drop the
// import, so this route only answers 404 there.
async function handle(event: APIEvent) {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 })
  const { handle } = await import("~/component/video-editor/server")
  return handle(event).catch((error: unknown) => new Response(String(error), { status: 400 }))
}

export const GET = handle
export const POST = handle
export const PUT = handle
