export async function GET() {
  const response = await fetch(
    "https://raw.githubusercontent.com/daemon-blockint-tech/daemoncode/refs/heads/dev/packages/sdk/openapi.json",
  )
  const json = await response.json()
  return json
}
