// Client-side API helper for making requests to the worker API

export async function getSessions() {
  const response = await fetch("/api/sessions")
  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: ${response.statusText}`)
  }
  return response.json()
}

export async function getShare(id: string) {
  const response = await fetch(`/api/share/${id}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch share: ${response.statusText}`)
  }
  return response.json()
}

export async function createShare(sessionID: string) {
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionID }),
  })
  if (!response.ok) {
    throw new Error(`Failed to create share: ${response.statusText}`)
  }
  return response.json()
}

export async function syncShare(id: string, secret: string, data: any[]) {
  const response = await fetch(`/api/share/${id}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, data }),
  })
  if (!response.ok) {
    throw new Error(`Failed to sync share: ${response.statusText}`)
  }
  return response.json()
}
