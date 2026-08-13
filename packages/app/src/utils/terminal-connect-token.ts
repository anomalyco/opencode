export async function terminalConnectToken(input: {
  url: string
  id: string
  directory: string
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}) {
  const url = new URL(`${input.url}/api/pty/${input.id}/connect-token`)
  url.searchParams.set("location[directory]", input.directory)

  // TODO: Luke should check this for stupidity once special PTY endpoints have generated client support.
  const response = await (input.fetch ?? fetch)(url, {
    method: "POST",
    headers: { "x-opencode-ticket": "1" },
  })
  if (!response.ok) return { status: response.status }

  const result = (await response.json()) as { data?: { ticket?: string } }
  return { status: response.status, ticket: result.data?.ticket }
}
