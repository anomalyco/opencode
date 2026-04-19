declare module "web-push" {
  export type PushSubscription = {
    endpoint: string
    expirationTime?: number | null
    keys: {
      auth: string
      p256dh: string
    }
  }

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void

  export function sendNotification(
    subscription: PushSubscription,
    payload?: string,
  ): Promise<unknown>

  const webpush: {
    sendNotification: typeof sendNotification
    setVapidDetails: typeof setVapidDetails
  }

  export default webpush
}
