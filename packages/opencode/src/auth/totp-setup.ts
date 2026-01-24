import QRCode from "qrcode"

/**
 * Result of TOTP setup generation.
 */
export interface TotpSetupData {
  /** Base32-encoded secret (for manual entry) */
  secret: string
  /** otpauth:// URL for QR code scanning */
  otpauthUrl: string
  /** SVG QR code as string */
  qrCodeSvg: string
}

/**
 * Base32 alphabet for TOTP secrets.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/**
 * Encode bytes to base32.
 */
function base32Encode(bytes: Uint8Array): string {
  let result = ""
  let bits = 0
  let value = 0

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  return result
}

/**
 * Generate TOTP setup data including secret and QR code.
 *
 * @param username - User setting up 2FA
 * @param issuer - Issuer name shown in authenticator app (default: "opencode")
 */
export async function generateTotpSetup(
  username: string,
  issuer = "opencode",
): Promise<TotpSetupData> {
  // Generate 160-bit (20 byte) secret - standard for TOTP
  const secretBytes = crypto.getRandomValues(new Uint8Array(20))
  const secret = base32Encode(secretBytes)

  // Build otpauth URL per Google Authenticator spec
  // Format: otpauth://totp/ISSUER:ACCOUNT?secret=SECRET&issuer=ISSUER&algorithm=SHA1&digits=6&period=30
  const label = encodeURIComponent(`${issuer}:${username}`)
  const otpauthUrl = new URL(`otpauth://totp/${label}`)
  otpauthUrl.searchParams.set("secret", secret)
  otpauthUrl.searchParams.set("issuer", issuer)
  otpauthUrl.searchParams.set("algorithm", "SHA1")
  otpauthUrl.searchParams.set("digits", "6")
  otpauthUrl.searchParams.set("period", "30")

  // Generate QR code as SVG
  const qrCodeSvg = await QRCode.toString(otpauthUrl.toString(), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 200,
  })

  return {
    secret,
    otpauthUrl: otpauthUrl.toString(),
    qrCodeSvg,
  }
}

/**
 * Generate the google-authenticator command to run on the server.
 * This sets up the user's ~/.google_authenticator file.
 *
 * @param secret - The base32 secret to use
 */
export function getGoogleAuthenticatorSetupCommand(secret: string): string {
  // The google-authenticator CLI can accept a secret via --secret flag
  // This generates the ~/.google_authenticator file
  return `google-authenticator -t -d -f -r 3 -R 30 -w 3 -s ~/.google_authenticator --secret=${secret}`
}
