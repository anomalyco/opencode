declare module "http_ece" {
  export function decrypt(
    buffer: Buffer,
    params: {
      version: "aes128gcm"
      privateKey: { getPublicKey(): Buffer; computeSecret(other: Buffer): Buffer }
      authSecret: Buffer
    },
  ): Buffer
}
