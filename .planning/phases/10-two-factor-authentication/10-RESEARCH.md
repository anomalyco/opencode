# Phase 10: Two-Factor Authentication - Research

**Researched:** 2026-01-24
**Domain:** TOTP-based 2FA with pam_google_authenticator, device trust, and setup wizard
**Confidence:** MEDIUM-HIGH

## Summary

Phase 10 adds optional TOTP-based two-factor authentication to the login flow. The implementation builds on the existing PAM authentication in Phase 3/4, adding a second authentication step after password validation. The approach uses pam_google_authenticator for TOTP validation but separates the password and OTP validation into two distinct steps to enable the "2FA required" intermediate state.

Research validates that:

1. **Detection of 2FA configuration:** Check for existence of `~/.google_authenticator` file for the user (or the path specified in PAM config)
2. **Two-step authentication flow:** After password success, return `2fa_required` status; second request validates OTP via pam_google_authenticator
3. **Device trust cookies:** Use signed JWT tokens with device fingerprint stored in secure cookie
4. **TOTP validation:** Can use pam_google_authenticator PAM module or direct TOTP validation via totp-rs crate in Rust
5. **QR code setup:** Generate QR code with otpauth:// URL format using standard TOTP parameters

**Primary recommendation:** Extend the broker protocol with an `authenticate_otp` method, detect 2FA configuration by checking the google_authenticator file existence, use secure signed cookies for device trust, and provide a setup wizard that generates QR codes client-side.

## Standard Stack

The established libraries/tools for this domain:

### Core (Rust - Broker Extension)

| Library  | Version | Purpose                    | Why Standard                                     |
| -------- | ------- | -------------------------- | ------------------------------------------------ |
| nonstick | 0.1.x   | PAM integration            | Already in use, handles pam_google_authenticator |
| totp-rs  | 5.7.x   | TOTP generation/validation | RFC-compliant, optional for direct validation    |
| base32   | latest  | Secret encoding            | Standard TOTP secret format                      |

### Core (TypeScript - Client/Server)

| Library | Version | Purpose                     | Why Standard                       |
| ------- | ------- | --------------------------- | ---------------------------------- |
| jose    | catalog | JWT for device trust tokens | Already used, secure token signing |
| qrcode  | 1.5.x   | QR code generation          | Well-maintained, SVG output        |

### Supporting

| Library | Version | Purpose                          | When to Use                 |
| ------- | ------- | -------------------------------- | --------------------------- |
| otpauth | latest  | TOTP URL parsing/generation (TS) | Setup wizard URL generation |

### Alternatives Considered

| Instead of           | Could Use            | Tradeoff                                                                 |
| -------------------- | -------------------- | ------------------------------------------------------------------------ |
| totp-rs in broker    | Pure PAM for OTP     | PAM approach keeps all auth in PAM; direct validation gives more control |
| jose JWT             | Simple signed cookie | JWT is more standard, better audit trail                                 |
| Client QR generation | Server-side QR       | Client-side keeps secrets client-side during setup                       |

**Installation (Rust broker):**

```toml
[dependencies]
# For direct TOTP validation (optional, can use PAM instead)
totp-rs = { version = "5.7", features = ["gen_secret", "otpauth"] }
base32 = "0.5"
```

**Installation (TypeScript):**

```bash
pnpm add qrcode @types/qrcode
# jose already in workspace
```

## Architecture Patterns

### Recommended Project Structure (Modifications)

```
packages/opencode-broker/src/
|-- auth/
|   |-- mod.rs
|   |-- pam.rs          # (MODIFY) Add OTP validation
|   |-- otp.rs          # (NEW) TOTP detection and validation
|   |-- rate_limit.rs
|   `-- validation.rs
|-- ipc/
|   `-- protocol.rs     # (MODIFY) Add authenticate_otp method

packages/opencode/src/
|-- auth/
|   |-- broker-client.ts # (MODIFY) Add authenticateOtp method
|   |-- device-trust.ts  # (NEW) Device trust token generation/validation
|   `-- totp-setup.ts    # (NEW) QR code generation for setup wizard
|-- server/
|   |-- routes/
|   |   `-- auth.ts      # (MODIFY) Add 2FA endpoints
|   `-- middleware/
|       `-- auth.ts      # (MODIFY) Handle device trust cookies
|-- config/
|   `-- auth.ts          # (MODIFY) Add 2FA config options
`-- session/
    `-- user-session.ts  # (MODIFY) Track 2FA completion state
```

### Pattern 1: Two-Step Authentication Flow

**What:** Separate password validation from OTP validation with intermediate token
**When to use:** All 2FA-enabled logins
**Why:** Allows UI to redirect to 2FA screen; prevents replay attacks

```typescript
// Step 1: Password authentication
POST /auth/login
Body: { username, password }
Response: { success: false, error: "2fa_required", twoFactorToken: "<short-lived-jwt>" }

// Step 2: OTP validation
POST /auth/login/2fa
Body: { twoFactorToken, code, rememberDevice? }
Response: { success: true, user: {...} }
```

### Pattern 2: 2FA Detection in Broker

**What:** Check if user has 2FA configured before requiring OTP
**When to use:** During password authentication step
**Why:** Only prompt for OTP if user has set up 2FA

```rust
// Source: pam_google_authenticator documentation
use std::path::Path;

/// Check if user has 2FA configured by checking for .google_authenticator file
pub fn has_2fa_configured(username: &str, home: &str) -> bool {
    let secret_path = format!("{}/.google_authenticator", home);
    let path = Path::new(&secret_path);

    // Check file exists and is readable
    path.exists() && path.is_file()
}

// Alternative: Check PAM-configured path
pub fn has_2fa_configured_pam(secret_path: &str) -> bool {
    Path::new(secret_path).exists()
}
```

### Pattern 3: Device Trust Token

**What:** Signed JWT stored in cookie to skip 2FA on trusted devices
**When to use:** When user selects "Remember this device"
**Why:** Balance security with convenience; revocable

```typescript
// Source: jose JWT documentation
import { SignJWT, jwtVerify } from "jose"

interface DeviceTrustPayload {
  sub: string // username
  iat: number // issued at
  exp: number // expiration
  dev: string // device fingerprint (hash of user-agent + session)
  ver: number // version for revocation
}

async function createDeviceTrustToken(
  username: string,
  deviceFingerprint: string,
  durationDays: number,
  secret: Uint8Array,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({
    sub: username,
    dev: deviceFingerprint,
    ver: 1, // Increment to revoke all devices
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + durationDays * 24 * 60 * 60)
    .sign(secret)
}

async function verifyDeviceTrust(
  token: string,
  expectedFingerprint: string,
  secret: Uint8Array,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    if (payload.dev !== expectedFingerprint) return null
    return payload.sub as string
  } catch {
    return null
  }
}
```

### Pattern 4: Short-Lived 2FA Token

**What:** Token issued after password success, required for OTP validation
**When to use:** Between password and OTP steps
**Why:** Prevents OTP-only attacks; ties OTP to recent password auth

```typescript
// Source: Security best practices
interface TwoFactorToken {
  sub: string // username
  iat: number // issued at
  exp: number // expires in 5 minutes
  uid: number // user's UID (for session creation after 2FA)
  gid: number
  home: string
  shell: string
}

// Create token after password validation succeeds
function create2FAToken(username: string, userInfo: UserInfo): string {
  // JWT with 5-minute expiration
  // Signed with server secret
}
```

### Pattern 5: OTP Validation via PAM

**What:** Use pam_google_authenticator for OTP validation
**When to use:** When validating user-entered OTP
**Why:** Consistent with PAM approach; handles rate limiting, scratch codes

```rust
// Source: nonstick documentation, pam_google_authenticator
use nonstick::{ConversationAdapter, TransactionBuilder, AuthnFlags};
use std::ffi::{OsStr, OsString};

/// Conversation handler for OTP-only authentication
struct OtpConversation {
    code: String,
}

impl ConversationAdapter for OtpConversation {
    fn prompt(&self, _request: impl AsRef<OsStr>) -> nonstick::Result<OsString> {
        // Return the OTP code for any prompt
        Ok(OsString::from(&self.code))
    }

    fn masked_prompt(&self, _request: impl AsRef<OsStr>) -> nonstick::Result<OsString> {
        // Also return OTP for masked prompts
        Ok(OsString::from(&self.code))
    }

    fn error_msg(&self, message: impl AsRef<OsStr>) {
        tracing::warn!(message = ?message.as_ref(), "PAM OTP error");
    }

    fn info_msg(&self, message: impl AsRef<OsStr>) {
        tracing::debug!(message = ?message.as_ref(), "PAM OTP info");
    }
}

/// Validate OTP via pam_google_authenticator
pub async fn validate_otp(service: &str, username: &str, code: &str) -> Result<(), AuthError> {
    // Use separate PAM service for OTP-only validation
    // e.g., /etc/pam.d/opencode-otp with only pam_google_authenticator
    let otp_service = format!("{}-otp", service);

    let conversation = OtpConversation { code: code.to_string() };

    let mut txn = TransactionBuilder::new_with_service(&otp_service)
        .username(username)
        .build(conversation.into_conversation())
        .map_err(|_| AuthError::PamError)?;

    txn.authenticate(AuthnFlags::empty())
        .map_err(|_| AuthError::PamError)?;

    Ok(())
}
```

### Pattern 6: QR Code Setup Wizard

**What:** Generate TOTP secret and QR code for authenticator app setup
**When to use:** User first-time 2FA setup
**Why:** Standard TOTP provisioning flow

```typescript
// Source: Google Authenticator Key URI Format
import QRCode from "qrcode"

interface TotpSetupData {
  secret: string // Base32 encoded secret
  otpauthUrl: string // otpauth:// URL for QR code
  qrCodeSvg: string // SVG QR code
  backupCodes?: string[] // Scratch codes (if supported)
}

async function generateTotpSetup(username: string, issuer: string = "opencode"): Promise<TotpSetupData> {
  // Generate 160-bit secret (20 bytes = 32 base32 chars)
  const secretBytes = crypto.getRandomValues(new Uint8Array(20))
  const secret = base32Encode(secretBytes)

  // Build otpauth URL
  const otpauthUrl = new URL("otpauth://totp/" + encodeURIComponent(`${issuer}:${username}`))
  otpauthUrl.searchParams.set("secret", secret)
  otpauthUrl.searchParams.set("issuer", issuer)
  otpauthUrl.searchParams.set("algorithm", "SHA1")
  otpauthUrl.searchParams.set("digits", "6")
  otpauthUrl.searchParams.set("period", "30")

  // Generate QR code
  const qrCodeSvg = await QRCode.toString(otpauthUrl.toString(), {
    type: "svg",
    errorCorrectionLevel: "M",
  })

  return {
    secret,
    otpauthUrl: otpauthUrl.toString(),
    qrCodeSvg,
  }
}
```

### Anti-Patterns to Avoid

- **Logging OTP codes:** Never log the actual code, even in debug mode
- **Long-lived 2FA tokens:** Keep the intermediate token short-lived (5 minutes max)
- **Device trust without fingerprint:** Always bind device trust to browser/user-agent
- **Storing TOTP secrets in UserSession:** Keep TOTP secrets in filesystem (PAM handles this)
- **Different timing for valid vs invalid codes:** Use constant-time comparison

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem               | Don't Build      | Use Instead                         | Why                                              |
| --------------------- | ---------------- | ----------------------------------- | ------------------------------------------------ |
| TOTP validation       | Manual HMAC-SHA1 | pam_google_authenticator or totp-rs | Time skew handling, rate limiting, scratch codes |
| Device fingerprinting | Custom hash      | Standard user-agent + session ID    | Consistent, debuggable                           |
| QR code generation    | Canvas drawing   | qrcode npm package                  | Handles error correction, sizing                 |
| Secret generation     | Math.random      | crypto.getRandomValues              | Cryptographically secure                         |
| Token signing         | Custom HMAC      | jose JWT library                    | Standard format, automatic expiration            |

**Key insight:** pam_google_authenticator already handles TOTP complexity including time skew, rate limiting, and scratch codes. Leverage it rather than reimplementing.

## Common Pitfalls

### Pitfall 1: Storing Secrets Server-Side for Setup

**What goes wrong:** Secret exposure if server database is compromised
**Why it happens:** Tempting to store secrets during setup wizard
**How to avoid:** Generate secrets client-side, only store the google_authenticator file on user's home directory after verification
**Warning signs:** Secrets appearing in server logs or database

### Pitfall 2: 2FA Token Replay

**What goes wrong:** Attacker captures 2FA token and uses it later
**Why it happens:** No binding between token and client
**How to avoid:** Short expiration (5 min), single-use tokens, IP binding (optional)
**Warning signs:** Same 2FA token accepted multiple times

### Pitfall 3: User Enumeration via 2FA Required Response

**What goes wrong:** Attacker learns which users have 2FA enabled
**Why it happens:** Different responses for 2FA vs non-2FA users
**How to avoid:** Always return `2fa_required` even for users without 2FA (prompt but accept any code)
**Alternative:** Accept this as low risk since attacker already has valid password
**Warning signs:** Can distinguish 2FA users without password

### Pitfall 4: Device Trust Cookie Theft

**What goes wrong:** Stolen cookie allows 2FA bypass
**Why it happens:** Cookie alone is sufficient
**How to avoid:** Bind to user-agent fingerprint, use Secure + HttpOnly flags, consider IP binding
**Warning signs:** Device trust works from different browser

### Pitfall 5: Setup Wizard Without Verification

**What goes wrong:** User sets up authenticator but types code wrong
**Why it happens:** Not requiring code verification before enabling 2FA
**How to avoid:** Require user to enter current code before saving configuration
**Warning signs:** Users locked out immediately after setup

### Pitfall 6: No Backup Recovery Path

**What goes wrong:** User loses phone, locked out permanently
**Why it happens:** No scratch codes or admin recovery
**How to avoid:** Generate scratch codes during setup; document admin recovery (delete ~/.google_authenticator)
**Warning signs:** Support tickets for locked out users

## Code Examples

Verified patterns from official sources and existing codebase:

### Extended Broker Protocol

```rust
// Source: Extending existing protocol.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Authenticate,
    AuthenticateOtp,   // NEW: Second step OTP validation
    Check2fa,          // NEW: Check if user has 2FA configured
    Ping,
    // ... existing methods
}

/// Parameters for OTP authentication (step 2)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticateOtpParams {
    /// Username to validate OTP for
    pub username: String,
    /// The TOTP code entered by user
    #[serde(skip_serializing)]
    pub code: String,
}

/// Parameters for checking 2FA status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check2faParams {
    /// Username to check
    pub username: String,
    /// User's home directory
    pub home: String,
}

/// Response with 2FA requirement status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticateResult {
    /// Whether authentication succeeded
    pub success: bool,
    /// Whether 2FA is required
    pub requires_2fa: Option<bool>,
    /// Error message if failed
    pub error: Option<String>,
}
```

### Extended BrokerClient

```typescript
// Source: Extending existing broker-client.ts

/**
 * Check if user has 2FA configured.
 */
async check2fa(username: string, home: string): Promise<boolean> {
  const id = crypto.randomUUID()

  const request: BrokerRequest = {
    id,
    version: 1,
    method: "check2fa",
    username,
    home,
  }

  try {
    const response = await this.sendRequest(request)
    return response.id === id && response.success
  } catch {
    return false
  }
}

/**
 * Validate OTP code for user.
 */
async authenticateOtp(username: string, code: string): Promise<AuthResult> {
  const id = crypto.randomUUID()

  const request: BrokerRequest = {
    id,
    version: 1,
    method: "authenticateotp",
    username,
    code,
  }

  try {
    const response = await this.sendRequest(request)

    if (response.id !== id) {
      return { success: false, error: "authentication service unavailable" }
    }

    return {
      success: response.success,
      error: response.error,
    }
  } catch {
    return { success: false, error: "authentication service unavailable" }
  }
}
```

### PAM Configuration for OTP-Only Service

```
# /etc/pam.d/opencode-otp
# Used for OTP validation only (after password already validated)
auth required pam_google_authenticator.so nullok
```

### 2FA Login Page HTML (Consistent with existing login page style)

```typescript
// Source: Extending existing auth.ts generateLoginPageHtml pattern
function generate2FAPageHtml(username: string, countdown: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Two-Factor Authentication - opencode</title>
  <style>
    /* Same base styles as login page */
    .countdown { color: #737373; font-size: 0.75rem; margin-top: 0.5rem; }
    .countdown.warning { color: #fbbf24; }
  </style>
</head>
<body>
  <!-- Same logo -->
  <div class="card">
    <form id="otpForm">
      <p class="subtitle">Enter code for ${escapeHtml(username)}</p>
      <div id="error" class="error"></div>

      <div class="field">
        <label for="code">Verification Code</label>
        <input type="text" id="code" name="code"
               inputmode="numeric" autocomplete="one-time-code"
               pattern="[0-9]{6,8}" maxlength="8" required autofocus>
        <p class="hint">Enter 6-digit code from your authenticator app</p>
      </div>

      <div class="checkbox-wrapper">
        <input type="checkbox" id="rememberDevice" name="rememberDevice">
        <label for="rememberDevice" class="checkbox-label">Remember this device</label>
      </div>

      <div class="countdown" id="countdown">Time remaining: <span id="timer">${countdown}</span>s</div>

      <button type="submit" id="submitBtn">Verify</button>
    </form>
  </div>

  <script>
    // Auto-submit when 6 digits entered
    const codeInput = document.getElementById('code');
    codeInput.addEventListener('input', () => {
      if (/^[0-9]{6}$/.test(codeInput.value)) {
        document.getElementById('otpForm').requestSubmit();
      }
    });

    // Countdown timer
    let remaining = ${countdown};
    const timerSpan = document.getElementById('timer');
    const countdownDiv = document.getElementById('countdown');

    setInterval(() => {
      remaining--;
      timerSpan.textContent = remaining;
      if (remaining <= 60) countdownDiv.classList.add('warning');
      if (remaining <= 0) window.location.href = '/auth/login';
    }, 1000);
  </script>
</body>
</html>`
}
```

## State of the Art

| Old Approach                  | Current Approach     | When Changed | Impact                         |
| ----------------------------- | -------------------- | ------------ | ------------------------------ |
| SMS OTP                       | TOTP apps            | 2020+        | More secure, works offline     |
| Single input (password + OTP) | Separate screens     | Current      | Better UX, clearer flow        |
| Custom TOTP validation        | PAM module           | Always       | Consistent, handles edge cases |
| No device trust               | 30-day trust cookies | Current      | Balance security/convenience   |

**Deprecated/outdated:**

- **SMS-based 2FA:** SIM swap attacks; TOTP is preferred
- **HOTP (counter-based):** TOTP is more convenient and standard
- **Single combined password+OTP field:** Separate screens are clearer

## Open Questions

Things that couldn't be fully resolved:

1. **Direct TOTP validation vs PAM for OTP**
   - What we know: Can use pam_google_authenticator or totp-rs directly
   - What's unclear: Whether separate PAM service for OTP is cleaner than direct validation
   - Recommendation: Use PAM approach for consistency; configure /etc/pam.d/opencode-otp

2. **User enumeration via 2FA check**
   - What we know: Checking ~/.google_authenticator reveals if user has 2FA
   - What's unclear: Whether to always prompt for 2FA or reveal status
   - Recommendation: Accept as low risk since attacker needs valid password first

3. **Setup wizard secret storage**
   - What we know: google-authenticator CLI writes to ~/.google_authenticator
   - What's unclear: Whether to run CLI via broker or write file directly
   - Recommendation: Run google-authenticator CLI as user via broker for proper setup

4. **macOS compatibility**
   - What we know: pam_google_authenticator available via brew
   - What's unclear: Whether OpenPAM on macOS handles it identically
   - Recommendation: Test on macOS; may need platform-specific PAM config

## Sources

### Primary (HIGH confidence)

- [pam_google_authenticator man page](https://www.mankier.com/8/pam_google_authenticator) - PAM module configuration
- [Google Authenticator PAM GitHub](https://github.com/google/google-authenticator-libpam) - Official module
- [RFC 6238 TOTP](https://datatracker.ietf.org/doc/html/rfc6238) - TOTP specification
- [totp-rs crate](https://docs.rs/totp-rs/latest/totp_rs/) - Rust TOTP library
- [nonstick crate](https://docs.rs/nonstick/latest/nonstick/) - PAM bindings used by broker
- [jose JWT library](https://github.com/panva/jose) - Token signing

### Secondary (MEDIUM confidence)

- [ArchWiki Google Authenticator](https://wiki.archlinux.org/title/Google_Authenticator) - Practical setup guide
- [Device trust patterns](https://medium.com/@guillaume.viguierjust/making-two-factor-authentication-more-user-friendly-through-trusted-devices-257acc27b24b) - Implementation guidance
- [SSSD PAM two-factor design](https://sssd.io/design-pages/pam_conversation_for_otp.html) - Two-step PAM flow

### Tertiary (LOW confidence)

- Existing codebase patterns (auth.ts, broker-client.ts) - Verified by reading files

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - PAM module well-documented, crates verified
- Authentication flow: HIGH - Two-step pattern is standard
- Device trust: MEDIUM - Implementation approach clear, details to validate
- Setup wizard: MEDIUM - QR code approach standard, CLI integration needs testing
- macOS compatibility: MEDIUM - Should work but needs testing

**Research date:** 2026-01-24
**Valid until:** 2026-02-24 (30 days - stable domain)

---

_Phase: 10-two-factor-authentication_
_Research complete: 2026-01-24_
