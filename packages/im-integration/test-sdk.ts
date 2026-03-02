import { createOpencodeClient } from "@opencode-ai/sdk"

const customFetch = async (req: any) => {
  console.log("[Test] Fetching:", req.url)
  req.timeout = false
  const start = Date.now()
  try {
    const response = await fetch(req)
    console.log("[Test] Response received:", Date.now() - start, "ms", response.status)
    return response
  } catch (error) {
    console.log("[Test] Fetch error:", error)
    throw error
  }
}

console.log("[Test] Creating client...")
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  fetch: customFetch,
})

console.log("[Test] Creating session...")
const result = await client.session.create({
  title: "Test Session",
  directory: "/tmp",
})

console.log("[Test] Result:", result.error ? "ERROR" : "OK")
if (result.error) {
  console.log("[Test] Error:", result.error)
} else {
  console.log("[Test] Session ID:", result.data.id)
}
