# PAM Configuration Guide

This guide covers PAM (Pluggable Authentication Modules) setup for OpenCode authentication, including basic password authentication, two-factor authentication (2FA), and integration with LDAP/Active Directory.

## Quick Start (For PAM Experts)

If you're already familiar with PAM, here's the minimal setup:

1. **Install PAM configuration:**

   ```bash
   # Linux
   sudo cp packages/opencode-broker/service/opencode.pam /etc/pam.d/opencode

   # macOS
   sudo cp packages/opencode-broker/service/opencode.pam.macos /etc/pam.d/opencode
   ```

2. **Build and install broker:**

   ```bash
   cd packages/opencode-broker
   cargo build --release
   sudo cp target/release/opencode-broker /usr/local/bin/
   sudo chmod 4755 /usr/local/bin/opencode-broker  # setuid root
   ```

3. **Start broker service:**

   ```bash
   # Linux (systemd)
   sudo cp packages/opencode-broker/service/opencode-broker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now opencode-broker

   # macOS (launchd)
   sudo cp packages/opencode-broker/service/com.opencode.broker.plist /Library/LaunchDaemons/
   sudo launchctl load /Library/LaunchDaemons/com.opencode.broker.plist
   ```

4. **Enable authentication in opencode:**

   ```json
   {
     "auth": {
       "enabled": true
     }
   }
   ```

5. **Verify setup:**

   ```bash
   # Linux
   sudo systemctl status opencode-broker
   ls -l /run/opencode/broker.sock

   # macOS
   sudo launchctl list | grep opencode
   ls -l /run/opencode/broker.sock  # or /var/run/opencode/broker.sock
   ```

Done! For 2FA setup, skip to [Two-Factor Authentication](#two-factor-authentication-2fa).

---

## What is PAM?

**PAM (Pluggable Authentication Modules)** is a flexible authentication framework used on UNIX-like systems. Instead of hardcoding authentication logic into every application, PAM allows system administrators to configure authentication policies centrally.

### How PAM Works

When an application (like OpenCode) needs to authenticate a user, it calls into PAM with a **service name** (e.g., "opencode"). PAM reads the corresponding configuration file (`/etc/pam.d/opencode`) and executes a **stack** of authentication modules in order.

Each module can:

- **Succeed** (user credentials valid)
- **Fail** (credentials invalid)
- **Be ignored** (module result doesn't affect outcome)

The final authentication result depends on the **control flags** (explained below) and the combined results of all modules.

### Module Types

PAM modules are organized by type:

- **`auth`** - Authenticates the user (verifies credentials like password, OTP)
- **`account`** - Checks account validity (not expired, not locked, time restrictions)
- **`password`** - Handles password changes
- **`session`** - Sets up/tears down user sessions (environment, logging, mounts)

Most OpenCode configurations only need `auth` and `account` modules.

---

## Control Flags Explained

Control flags determine what happens when a module succeeds or fails:

| Flag             | Behavior                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **`required`**   | Must succeed for authentication to succeed. Continues to next module even on failure (to prevent timing attacks). |
| **`requisite`**  | Must succeed. Stops immediately on failure (early exit).                                                          |
| **`sufficient`** | If succeeds, immediately succeeds (skip remaining modules). If fails, continues to next module.                   |
| **`optional`**   | Result is ignored unless it's the only module in the stack.                                                       |

### Example: Order Matters

Consider this PAM configuration:

```
auth    sufficient    pam_unix.so
auth    required      pam_deny.so
```

**What happens:**

1. `pam_unix.so` runs first (checks password)
2. If password is correct, `sufficient` flag causes immediate success (skips `pam_deny.so`)
3. If password is wrong, continues to `pam_deny.so` which always fails
4. Result: Authentication succeeds only if password is correct

Now reverse the order:

```
auth    required      pam_deny.so
auth    sufficient    pam_unix.so
```

**What happens:**

1. `pam_deny.so` runs first and always fails
2. `required` flag means we must continue (no early exit)
3. `pam_unix.so` runs and checks password
4. Result: Authentication **always fails** because `pam_deny.so` failed and was `required`

**Takeaway:** Place more permissive modules (`sufficient`) before restrictive ones (`required`).

---

## Basic Setup (Linux)

### 1. Install PAM Configuration File

OpenCode provides a basic PAM configuration for Linux systems:

```bash
sudo cp packages/opencode-broker/service/opencode.pam /etc/pam.d/opencode
```

**File contents (`/etc/pam.d/opencode`):**

```
# PAM configuration for OpenCode authentication
# Install to /etc/pam.d/opencode

# Standard UNIX authentication
auth       required     pam_unix.so
account    required     pam_unix.so

# Optional: Enable TOTP 2FA (uncomment when pam_google_authenticator is installed)
# auth       required     pam_google_authenticator.so
```

**What each line does:**

| Line                           | Module        | Purpose                                           |
| ------------------------------ | ------------- | ------------------------------------------------- |
| `auth required pam_unix.so`    | `pam_unix.so` | Validates username/password against `/etc/shadow` |
| `account required pam_unix.so` | `pam_unix.so` | Checks account status (not expired, not locked)   |

This is the simplest configuration - it just checks system passwords.

### 2. Install opencode-broker

The **opencode-broker** is a privileged process that handles PAM authentication on behalf of the OpenCode web server. It runs as root (or with setuid) to access PAM and spawn user processes.

#### Build from source:

```bash
cd packages/opencode-broker
cargo build --release
sudo cp target/release/opencode-broker /usr/local/bin/
```

#### Set permissions:

**Option A: setuid (recommended for single-user systems):**

```bash
sudo chmod 4755 /usr/local/bin/opencode-broker
```

**Option B: Run as root via systemd (recommended for multi-user systems):**

```bash
sudo chmod 755 /usr/local/bin/opencode-broker
# Service runs as root (see next step)
```

### 3. Configure systemd Service

OpenCode includes a systemd service file for the broker:

```bash
sudo cp packages/opencode-broker/service/opencode-broker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable opencode-broker
sudo systemctl start opencode-broker
```

**Service file (`opencode-broker.service`):**

```ini
[Unit]
Description=OpenCode Authentication Broker
Documentation=https://github.com/opencode-ai/opencode
After=network.target

[Service]
Type=notify
ExecStart=/usr/local/bin/opencode-broker
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadWritePaths=/run/opencode

# Socket directory
RuntimeDirectory=opencode
RuntimeDirectoryMode=0755

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opencode-broker

[Install]
WantedBy=multi-user.target
```

**Key settings:**

- **`Type=notify`** - Broker signals readiness via sd_notify
- **`RuntimeDirectory=opencode`** - Creates `/run/opencode` for socket
- **`ProtectHome=read-only`** - Security hardening (broker can read home directories but not write)
- **`ReadWritePaths=/run/opencode`** - Socket directory is writable

#### Verify service is running:

```bash
sudo systemctl status opencode-broker
```

Expected output:

```
● opencode-broker.service - OpenCode Authentication Broker
     Loaded: loaded (/etc/systemd/system/opencode-broker.service; enabled)
     Active: active (running) since ...
```

#### Verify socket exists:

```bash
ls -l /run/opencode/broker.sock
```

Expected output:

```
srw-rw-rw- 1 root root 0 Jan 25 10:00 /run/opencode/broker.sock
```

### 4. Configure OpenCode

Enable authentication in your `opencode.json` configuration:

**Minimal configuration:**

```json
{
  "auth": {
    "enabled": true
  }
}
```

**With options:**

```json
{
  "auth": {
    "enabled": true,
    "sessionTimeout": "7d",
    "rememberMeDuration": "90d",
    "requireHttps": "warn",
    "rateLimiting": true,
    "rateLimitMax": 5,
    "rateLimitWindow": "15m",
    "allowedUsers": []
  }
}
```

See [Configuration Reference](#configuration-reference) for all available options.

---

## Basic Setup (macOS)

macOS uses **Open Directory** instead of traditional `/etc/shadow` password files. OpenCode provides a macOS-specific PAM configuration.

### 1. Install PAM Configuration File

```bash
sudo cp packages/opencode-broker/service/opencode.pam.macos /etc/pam.d/opencode
```

**File contents (`/etc/pam.d/opencode`):**

```
# PAM configuration for OpenCode authentication (macOS)
# Install to /etc/pam.d/opencode

# macOS Open Directory authentication
auth       required     pam_opendirectory.so
account    required     pam_opendirectory.so
```

**Key difference from Linux:** Uses `pam_opendirectory.so` instead of `pam_unix.so`.

### 2. macOS-Specific Considerations

#### TCC (Transparency, Consent, and Control)

On macOS Monterey (12.0) and later, processes that access authentication may require **Full Disk Access** permission.

If authentication fails with permission errors:

1. Open **System Settings > Privacy & Security > Full Disk Access**
2. Add `/usr/local/bin/opencode-broker` to the allowed list
3. Restart the broker service

#### System Updates Reset PAM

**Important:** macOS system updates may reset files in `/etc/pam.d/`. After updating macOS:

1. Verify PAM file still exists: `sudo cat /etc/pam.d/opencode`
2. If missing, re-install: `sudo cp packages/opencode-broker/service/opencode.pam.macos /etc/pam.d/opencode`

Consider keeping a backup or script to restore PAM configuration after updates.

### 3. Install opencode-broker

Same as Linux:

```bash
cd packages/opencode-broker
cargo build --release
sudo cp target/release/opencode-broker /usr/local/bin/
sudo chmod 4755 /usr/local/bin/opencode-broker
```

### 4. Configure launchd Service

macOS uses **launchd** instead of systemd:

```bash
sudo cp packages/opencode-broker/service/com.opencode.broker.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.opencode.broker.plist
```

**Service file (`com.opencode.broker.plist`):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.opencode.broker</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/opencode-broker</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>/var/log/opencode-broker.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/opencode-broker.log</string>

    <key>WorkingDirectory</key>
    <string>/</string>

    <key>UserName</key>
    <string>root</string>

    <key>GroupName</key>
    <string>wheel</string>
</dict>
</plist>
```

#### Verify service is running:

```bash
sudo launchctl list | grep opencode
```

Expected output:

```
-	0	com.opencode.broker
```

#### Verify socket exists:

```bash
ls -l /run/opencode/broker.sock
# or
ls -l /var/run/opencode/broker.sock
```

### 5. Configure OpenCode

Same as Linux - enable authentication in `opencode.json`:

```json
{
  "auth": {
    "enabled": true
  }
}
```

---

## Two-Factor Authentication (2FA)

OpenCode supports **TOTP (Time-based One-Time Password)** 2FA using Google Authenticator or compatible apps.

### Architecture

OpenCode uses a **two-step authentication flow**:

1. **Password validation** - Uses standard PAM service (`opencode`)
2. **OTP validation** - Uses separate PAM service (`opencode-otp`)

This separation allows:

- Different PAM configurations for password vs. OTP
- Users without 2FA can still authenticate (via `nullok` option)
- Independent rate limiting for password and OTP attempts

### 1. Install google-authenticator PAM Module

**Linux (Debian/Ubuntu):**

```bash
sudo apt update
sudo apt install libpam-google-authenticator
```

**Linux (RHEL/Fedora):**

```bash
sudo dnf install google-authenticator
```

**macOS (Homebrew):**

```bash
brew install oath-toolkit google-authenticator-libpam
```

### 2. Install OTP PAM Configuration

OpenCode provides a separate PAM configuration for OTP validation:

```bash
sudo cp packages/opencode-broker/service/opencode-otp.pam /etc/pam.d/opencode-otp
```

**File contents (`/etc/pam.d/opencode-otp`):**

```
# PAM configuration for opencode OTP validation
# Used after password authentication succeeds
auth required pam_google_authenticator.so nullok
```

**Key option: `nullok`**

- **`nullok`** - Allows authentication to succeed if user has **not** set up 2FA
- Without `nullok` - All users **must** have 2FA configured or authentication fails

**Recommendation:** Start with `nullok` to allow gradual 2FA adoption. Remove `nullok` once all users have enrolled.

### 3. Enable 2FA in OpenCode

Add 2FA configuration to `opencode.json`:

**Basic 2FA (optional for users):**

```json
{
  "auth": {
    "enabled": true,
    "twoFactorEnabled": true
  }
}
```

**Required 2FA (enforced for all users):**

```json
{
  "auth": {
    "enabled": true,
    "twoFactorEnabled": true,
    "twoFactorRequired": true
  }
}
```

**With custom timeouts:**

```json
{
  "auth": {
    "enabled": true,
    "twoFactorEnabled": true,
    "twoFactorTokenTimeout": "5m",
    "deviceTrustDuration": "30d",
    "otpRateLimitMax": 5,
    "otpRateLimitWindow": "15m"
  }
}
```

### 4. User Setup

Each user must configure 2FA individually:

#### Command-Line Setup (required for PAM)

Users must run the `google-authenticator` command on the server to create the `.google_authenticator` file:

```bash
# Run as the user who will authenticate
google-authenticator
```

**Interactive prompts:**

1. **"Do you want authentication tokens to be time-based?"** - Answer **yes**
2. Scan QR code with authenticator app (Google Authenticator, Authy, 1Password, etc.)
3. **"Do you want to update your ~/.google_authenticator file?"** - Answer **yes**
4. **"Do you want to disallow multiple uses?"** - Answer **yes** (recommended)
5. **"Do you want to allow codes from 30 seconds ago?"** - Answer **yes** (clock skew tolerance)
6. **"Do you want to enable rate-limiting?"** - Answer **yes** (recommended)

This creates `~/.google_authenticator` with the TOTP secret.

#### Web UI Setup (optional)

OpenCode provides a web-based 2FA setup wizard at `/auth/setup-2fa`. This:

- Generates QR code in browser
- Walks user through authenticator app setup
- Tests OTP code before enabling

**However:** Users must still run `google-authenticator` on the server for PAM to work. The web UI helps with the authenticator app setup, but the final step requires shell access.

#### Backup Codes

During `google-authenticator` setup, emergency backup codes are displayed. Users should:

- **Save backup codes** in a secure location
- Use backup codes if they lose their authenticator device
- Regenerate codes by running `google-authenticator` again

### 5. Testing 2FA

1. Log out of OpenCode
2. Enter username and password
3. If user has 2FA configured, OTP prompt appears
4. Enter 6-digit code from authenticator app
5. Authentication succeeds

If user does **not** have 2FA configured (and `nullok` is set), authentication succeeds after password only.

### 6. Enforcing 2FA

To require all users to set up 2FA:

1. **Remove `nullok` from PAM:**

   ```bash
   sudo nano /etc/pam.d/opencode-otp
   # Change:
   # auth required pam_google_authenticator.so nullok
   # To:
   # auth required pam_google_authenticator.so
   ```

2. **Enable `twoFactorRequired` in config:**

   ```json
   {
     "auth": {
       "twoFactorRequired": true
     }
   }
   ```

3. **Notify users** to set up 2FA before enforcement date

4. **Test with a non-2FA user** to confirm enforcement works

Users without 2FA will be unable to authenticate until they run `google-authenticator`.

---

## LDAP/Active Directory Integration

For enterprise environments, integrate OpenCode with LDAP or Active Directory using **SSSD** (System Security Services Daemon).

### Why SSSD?

Modern Linux distributions recommend **SSSD** over legacy `pam_ldap.so`:

- Better performance (caching)
- Offline authentication support
- Kerberos integration
- Active Directory support
- Maintained and secure

### Setup Overview

1. **Install and configure SSSD** (distribution-specific)
2. **Update OpenCode PAM configuration** to use `pam_sss.so`
3. **Verify authentication** works

### Distribution-Specific Guides

SSSD configuration varies by Linux distribution and directory service. Consult your distribution's documentation:

**Red Hat/Fedora:**

- [RHEL - Configuring SSSD](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/configuring_authentication_and_authorization_in_rhel/configuring-sssd-to-use-ldap-and-require-tls-authentication_configuring-authentication-and-authorization-in-rhel)

**Ubuntu/Debian:**

- [Ubuntu - SSSD and Active Directory](https://ubuntu.com/server/docs/service-sssd)

**SUSE:**

- [SUSE - Authentication with SSSD](https://documentation.suse.com/sles/15-SP4/html/SLES-all/cha-security-sssd.html)

### PAM Configuration for SSSD

Once SSSD is configured, update `/etc/pam.d/opencode`:

```
# PAM configuration for OpenCode with SSSD/LDAP
auth       required     pam_sss.so
account    required     pam_sss.so
```

Or combine with local users:

```
# Try SSSD first, fall back to local users
auth       sufficient   pam_sss.so
auth       required     pam_unix.so
account    sufficient   pam_sss.so
account    required     pam_unix.so
```

### Kerberos Authentication

If your environment uses **Kerberos**, PAM handles it transparently through SSSD:

1. Configure SSSD with Kerberos realm
2. Use `pam_sss.so` in PAM configuration
3. No OpenCode-specific configuration needed

Users authenticate with their Kerberos principal (e.g., `user@REALM`).

### Testing LDAP/AD Authentication

1. **Verify SSSD is working:**

   ```bash
   id ldapuser
   getent passwd ldapuser
   ```

2. **Test PAM authentication:**

   ```bash
   pamtester opencode ldapuser authenticate
   ```

3. **Test OpenCode login** with LDAP user

---

## opencode-broker Details

The **opencode-broker** is a privileged daemon that handles authentication and user process spawning for OpenCode.

### What the Broker Does

1. **PAM authentication** - Validates user credentials via PAM
2. **User process spawning** - Creates PTY (pseudo-terminal) processes as authenticated users
3. **Session management** - Tracks active user sessions
4. **IPC** - Communicates with OpenCode web server via Unix socket

### Why a Separate Process?

The OpenCode web server runs as a non-root user. To:

- Access PAM (requires privileged access)
- Spawn processes as different users (requires `setuid` or root)
- Securely isolate authentication logic

...we use a separate **broker** process with elevated privileges.

### Security Model

The broker follows **principle of least privilege**:

- **Runs as root** (or setuid root)
- **Listens only on Unix socket** (not network-accessible)
- **Socket permissions: 0666** (any local user can connect)
- **Authentication via PAM** (broker validates credentials, doesn't trust client)
- **Rate limiting** (protects against brute force)
- **No shell access** (spawns processes directly, not via shell)

**Trust model:** Any local user can connect to the socket, but must provide valid credentials to authenticate.

### Socket Location

**Linux:**

```
/run/opencode/broker.sock
```

**macOS:**

```
/run/opencode/broker.sock
# or
/var/run/opencode/broker.sock
```

The socket is created by the broker on startup. Default permissions: `srw-rw-rw-` (0666).

### Environment Variables

Configure the broker via environment variables:

| Variable               | Default                     | Purpose                                     |
| ---------------------- | --------------------------- | ------------------------------------------- |
| `OPENCODE_SOCKET_PATH` | `/run/opencode/broker.sock` | Unix socket path                            |
| `RUST_LOG`             | `info`                      | Log level (error, warn, info, debug, trace) |

**Example (systemd):**

```ini
[Service]
Environment="OPENCODE_SOCKET_PATH=/custom/path/broker.sock"
Environment="RUST_LOG=debug"
```

### Troubleshooting the Broker

#### Broker won't start

**Check systemd status:**

```bash
sudo systemctl status opencode-broker
sudo journalctl -u opencode-broker -n 50
```

**Common issues:**

- Socket directory doesn't exist → Check `RuntimeDirectory` in service file
- Permission denied → Ensure broker binary is setuid or service runs as root
- Port/socket already in use → Check for stale socket file, remove it

#### Socket doesn't exist

```bash
ls -l /run/opencode/broker.sock
```

**If missing:**

1. Check broker is running: `sudo systemctl status opencode-broker`
2. Check logs: `sudo journalctl -u opencode-broker`
3. Verify socket path matches config

#### Authentication fails

**Check PAM configuration:**

```bash
sudo ls -l /etc/pam.d/opencode
sudo cat /etc/pam.d/opencode
```

**Test PAM directly:**

```bash
# Install pamtester
sudo apt install pamtester  # Debian/Ubuntu
sudo dnf install pamtester  # RHEL/Fedora

# Test authentication
pamtester opencode yourusername authenticate
```

**Check broker logs:**

```bash
sudo journalctl -u opencode-broker -f
```

Look for PAM errors or authentication failures.

#### Permission denied errors

**macOS TCC (Monterey+):**

1. System Settings > Privacy & Security > Full Disk Access
2. Add `/usr/local/bin/opencode-broker`
3. Restart broker

**Linux SELinux/AppArmor:**
Check security framework logs:

```bash
# SELinux
sudo ausearch -m avc -ts recent
sudo sealert -a /var/log/audit/audit.log

# AppArmor
sudo dmesg | grep apparmor
```

---

## Configuration Reference

All authentication options from `packages/opencode/src/config/auth.ts`:

| Option                  | Type                       | Default      | Description                                                                      |
| ----------------------- | -------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `enabled`               | boolean                    | `false`      | Enable authentication                                                            |
| `method`                | "pam"                      | `"pam"`      | Authentication method (currently only PAM supported)                             |
| `pam.service`           | string                     | `"opencode"` | PAM service name (corresponds to `/etc/pam.d/<service>`)                         |
| `sessionTimeout`        | duration                   | `"7d"`       | Session timeout duration (e.g., "15m", "24h", "7d")                              |
| `rememberMeDuration`    | duration                   | `"90d"`      | Remember me cookie duration                                                      |
| `requireHttps`          | "off" \| "warn" \| "block" | `"warn"`     | HTTPS requirement: "off" allows HTTP, "warn" logs warnings, "block" rejects HTTP |
| `rateLimiting`          | boolean                    | `true`       | Enable rate limiting for login attempts                                          |
| `rateLimitWindow`       | duration                   | `"15m"`      | Rate limit window duration                                                       |
| `rateLimitMax`          | number                     | `5`          | Maximum login attempts per window                                                |
| `allowedUsers`          | string[]                   | `[]`         | Users allowed to authenticate. Empty array allows any system user                |
| `sessionPersistence`    | boolean                    | `true`       | Persist sessions to disk across restarts                                         |
| `trustProxy`            | boolean                    | `undefined`  | Trust X-Forwarded-Proto header for reverse proxy HTTPS detection                 |
| `csrfVerboseErrors`     | boolean                    | `false`      | Enable verbose CSRF error messages for debugging                                 |
| `csrfAllowlist`         | string[]                   | `[]`         | Additional routes to exclude from CSRF validation                                |
| `twoFactorEnabled`      | boolean                    | `false`      | Enable two-factor authentication support                                         |
| `twoFactorRequired`     | boolean                    | `false`      | Require users to set up 2FA before accessing the app                             |
| `twoFactorTokenTimeout` | duration                   | `"5m"`       | How long the 2FA token is valid after password success                           |
| `deviceTrustDuration`   | duration                   | `"30d"`      | How long "remember this device" lasts for 2FA                                    |
| `otpRateLimitMax`       | number                     | `5`          | Maximum OTP attempts per rate limit window                                       |
| `otpRateLimitWindow`    | duration                   | `"15m"`      | OTP rate limit window duration                                                   |

### Example Configurations

**Minimal (password auth only):**

```json
{
  "auth": {
    "enabled": true
  }
}
```

**Production (HTTPS required, 2FA optional):**

```json
{
  "auth": {
    "enabled": true,
    "requireHttps": "block",
    "sessionTimeout": "12h",
    "rememberMeDuration": "90d",
    "twoFactorEnabled": true,
    "rateLimiting": true,
    "rateLimitMax": 5,
    "rateLimitWindow": "15m"
  }
}
```

**High-security (2FA required, short sessions):**

```json
{
  "auth": {
    "enabled": true,
    "requireHttps": "block",
    "sessionTimeout": "1h",
    "rememberMeDuration": "7d",
    "twoFactorEnabled": true,
    "twoFactorRequired": true,
    "deviceTrustDuration": "7d",
    "rateLimiting": true,
    "rateLimitMax": 3,
    "rateLimitWindow": "15m",
    "otpRateLimitMax": 3,
    "allowedUsers": ["admin", "developer"]
  }
}
```

**Behind reverse proxy (trust X-Forwarded-Proto):**

```json
{
  "auth": {
    "enabled": true,
    "requireHttps": "block",
    "trustProxy": true
  }
}
```

**Custom PAM service:**

```json
{
  "auth": {
    "enabled": true,
    "pam": {
      "service": "my-custom-pam-service"
    }
  }
}
```

This corresponds to `/etc/pam.d/my-custom-pam-service`.

---

## Security Considerations

### PAM Service Isolation

OpenCode uses a **dedicated PAM service** (`/etc/pam.d/opencode`) rather than sharing a service like `login` or `sshd`. This allows:

- **Customized authentication rules** for OpenCode
- **Independent 2FA policies** (can enable 2FA for OpenCode without affecting SSH)
- **Audit isolation** (PAM logs show "opencode" service)

### Broker Socket Permissions

The broker socket has **0666 permissions** (world-readable/writable). This is safe because:

1. Socket is only accessible to **local users** (Unix socket, not network)
2. **PAM authenticates all requests** (broker doesn't trust client)
3. **Rate limiting** prevents brute force attacks
4. **No privilege escalation** without valid credentials

**Alternative (more restrictive):** Change socket permissions to 0660 and set a specific group:

```bash
# In systemd service file:
RuntimeDirectoryMode=0750

# After socket is created:
sudo chown root:opencode /run/opencode/broker.sock
sudo chmod 660 /run/opencode/broker.sock
```

Then only users in the `opencode` group can authenticate.

### Rate Limiting

OpenCode implements **IP-based rate limiting**:

- Default: **5 attempts per 15 minutes**
- Applied **before PAM authentication** (protects PAM from brute force)
- Separate rate limits for **password** and **OTP** attempts

Configure via:

```json
{
  "auth": {
    "rateLimitMax": 5,
    "rateLimitWindow": "15m",
    "otpRateLimitMax": 5,
    "otpRateLimitWindow": "15m"
  }
}
```

**Privacy:** Failed login attempts are logged with masked usernames (e.g., `pe***r`) to reduce exposure in logs.

### Allowed Users Restriction

Restrict authentication to specific users:

```json
{
  "auth": {
    "allowedUsers": ["alice", "bob", "charlie"]
  }
}
```

**Use cases:**

- Limit access to specific developers
- Prevent system service accounts from authenticating
- Implement organization-specific access control

**Empty array** (default) allows any system user who can authenticate via PAM.

### HTTPS Enforcement

Configure HTTPS requirement:

```json
{
  "auth": {
    "requireHttps": "block" // or "warn" or "off"
  }
}
```

| Mode      | Behavior                                             |
| --------- | ---------------------------------------------------- |
| `"off"`   | Allow HTTP (not recommended for production)          |
| `"warn"`  | Log warnings but allow HTTP (default)                |
| `"block"` | Reject HTTP connections (recommended for production) |

**Localhost exemption:** `localhost` and `127.0.0.1` are always allowed over HTTP (developer experience).

**Behind reverse proxy:** Use `trustProxy: true` to trust `X-Forwarded-Proto` header.

### Session Security

Sessions are protected via:

- **CSRF tokens** (double-submit cookie pattern)
- **HttpOnly cookies** (prevents JavaScript access)
- **Secure cookies** (HTTPS-only when TLS is detected)
- **SameSite=Strict** (prevents cross-site request forgery)
- **Session binding** (HMAC signature prevents token fixation)

Sessions are **in-memory** by default (lost on restart). For persistent sessions, enable:

```json
{
  "auth": {
    "sessionPersistence": true
  }
}
```

---

## Additional Resources

**PAM Documentation:**

- [Linux PAM Documentation](http://www.linux-pam.org/Linux-PAM-html/)
- [Red Hat PAM Guide](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/configuring_authentication_and_authorization_in_rhel/configuring-user-authentication-using-authconfig_configuring-authentication-and-authorization-in-rhel)

**2FA Setup:**

- [Google Authenticator PAM Module](https://github.com/google/google-authenticator-libpam)

**OpenCode Files:**

- PAM configuration: `packages/opencode-broker/service/opencode.pam`
- Broker systemd service: `packages/opencode-broker/service/opencode-broker.service`
- Auth config schema: `packages/opencode/src/config/auth.ts`

**Troubleshooting:**

- Check broker logs: `sudo journalctl -u opencode-broker -f`
- Test PAM: `pamtester opencode <username> authenticate`
- Verify socket: `ls -l /run/opencode/broker.sock`
