// Agents look for llms.txt at the site root; the docs publish it under /v2.
export function GET() {
  return new Response(null, { status: 301, headers: { Location: "/v2/llms.txt" } })
}
