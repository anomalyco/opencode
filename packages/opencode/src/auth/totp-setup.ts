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
export async function generateTotpSetup(username: string, issuer = "opencode"): Promise<TotpSetupData> {
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
 * Generate the command to set up ~/.google_authenticator on the server.
 *
 * ## Why we write the file directly
 *
 * The google-authenticator CLI always generates its own secret and doesn't
 * accept a pre-generated one. To provide a better UX (showing QR code in
 * web UI), we write the file directly in the format the PAM module expects.
 *
 * ## File format reference
 *
 * The ~/.google_authenticator file format is defined by google-authenticator-libpam:
 * https://github.com/google/google-authenticator-libpam
 *
 * Format:
 * - Line 1: Base32-encoded shared secret (RFC 4648, no padding)
 * - Subsequent lines: Configuration options, each prefixed with `" ` (quote + space)
 * - Optional: 8-digit scratch/backup codes, one per line
 *
 * Valid configuration options (from pam_google_authenticator.c):
 * - `" TOTP_AUTH` - Enable time-based one-time passwords (vs HOTP counter-based)
 * - `" HOTP_COUNTER N` - Counter value for HMAC-based codes (mutually exclusive with TOTP)
 * - `" STEP_SIZE N` - Time step in seconds, default 30, valid 1-60
 * - `" WINDOW_SIZE N` - Codes accepted before/after current time, default 3, valid 1-100
 * - `" DISALLOW_REUSE` - Prevent reuse of same code within time window
 * - `" RATE_LIMIT N M` - Allow N attempts per M seconds (N: 1-100, M: 1-3600)
 * - `" TIME_SKEW N` - Clock offset adjustment in time steps
 *
 * ## Multi-user support
 *
 * Each Unix user has their own ~/.google_authenticator file in their home
 * directory. The PAM module reads from the authenticating user's home,
 * so multiple users can each have independent 2FA configurations.
 *
 * ## Security considerations
 *
 * - File permissions set to 400 (owner read-only) to protect the secret
 * - The command checks for existing file and prompts before overwriting
 * - Secret is passed via heredoc to avoid shell history exposure
 *
 * @param secret - The base32-encoded secret (must match QR code shown to user)
 * @returns Shell command that safely creates the authenticator file
 */
export function getGoogleAuthenticatorSetupCommand(secret: string): string {
  // Build the file content following the google-authenticator-libpam format
  // Reference: https://github.com/google/google-authenticator-libpam/blob/master/src/pam_google_authenticator.c
  //
  // Options used:
  // - TOTP_AUTH: Time-based OTP (standard 30-second window)
  // - RATE_LIMIT 3 30: Max 3 attempts per 30 seconds (brute-force protection)
  // - WINDOW_SIZE 3: Accept codes from 1 step before to 1 step after current time
  //                  (compensates for clock skew up to ~30 seconds)
  // - DISALLOW_REUSE: Each code can only be used once (replay protection)
  //
  // Note: We don't include scratch/backup codes - users can add them manually
  // by appending 8-digit numbers to the file if desired.

  const fileContent = `${secret}
" TOTP_AUTH
" RATE_LIMIT 3 30
" WINDOW_SIZE 3
" DISALLOW_REUSE`

  // Command explanation:
  // 1. Check if file exists and warn user (but allow override)
  // 2. Use heredoc to avoid secret appearing in shell history via echo
  // 3. Set restrictive permissions (400 = owner read-only)
  return `bash -lc 'set -euo pipefail
target="$HOME/.google_authenticator"
if [ -f "$target" ]; then
  printf "Warning: %s exists and will be replaced.\\n" "$target"
  printf "Continue? [y/N] "
  read -r confirm </dev/tty || exit 1
  if [ "$confirm" != "y" ]; then
    exit 1
  fi
  rm -f "$target"
fi
cat > "$target" << "EOF"
${fileContent}
EOF
chmod 400 "$target"
echo "2FA configured successfully"'`
}
