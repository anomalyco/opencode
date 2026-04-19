declare module "web-push" {
  export type PushSubscription = {
    endpoint: string
    expirationTime?: number | null
    keys: {
      auth: string
      p256dh: string
    }
  }

  export type SendOptions = {
    TTL?: number
    urgency?: "very-low" | "low" | "normal" | "high"
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void

  export function sendNotification(
    subscription: PushSubscription,
    payload?: string,
    options?: SendOptions,
  ): Promise<unknown>

  const webpush: {
    sendNotification: typeof sendNotification
    setVapidDetails: typeof setVapidDetails
  }

  export default webpush
}
