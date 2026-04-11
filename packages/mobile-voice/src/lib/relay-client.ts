export type RegisterDeviceInput = {
  relayBaseURL: string
  secret: string
  deviceToken: string
  bundleId?: string
  apnsEnv?: "sandbox" | "production"
}

export type UnregisterDeviceInput = {
  relayBaseURL: string
  secret: string
  deviceToken: string
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "")
}

async function postRelay(path: string, relayBaseURL: string, body: Record<string, unknown>): Promise<void> {
  const relay = normalizeBase(relayBaseURL)
  const response = await fetch(`${relay}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Relay request failed (${response.status}): ${text || response.statusText}`)
  }
}

export async function registerRelayDevice(input: RegisterDeviceInput): Promise<void> {
  await postRelay("/v1/device/register", input.relayBaseURL, {
    secret: input.secret,
    deviceToken: input.deviceToken,
    bundleId: input.bundleId,
    apnsEnv: input.apnsEnv,
  })
}

export async function unregisterRelayDevice(input: UnregisterDeviceInput): Promise<void> {
  await postRelay("/v1/device/unregister", input.relayBaseURL, {
    secret: input.secret,
    deviceToken: input.deviceToken,
  })
}

export async function sendRelayTestEvent(input: {
  relayBaseURL: string
  secret: string
  sessionID: string
}): Promise<void> {
  await postRelay("/v1/event", input.relayBaseURL, {
    secret: input.secret,
    eventType: "permission",
    sessionID: input.sessionID,
    title: "APN relay test",
    body: "If you can read this, APN relay registration is working.",
  })
}
