type UpdateClient = {
  channel: string | null
  allowPrerelease: boolean | null
  allowDowngrade: boolean
}

export function configureStableUpdates(client: UpdateClient) {
  client.channel = "latest"
  client.allowPrerelease = false
  client.allowDowngrade = false
}
