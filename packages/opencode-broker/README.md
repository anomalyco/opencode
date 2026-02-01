---
title: OpenCode Broker Service Management
---

# OpenCode Broker Service Management

## Purpose

`opencode-broker` is the privileged authentication helper for the opencode web
server. It authenticates users via PAM, runs with elevated permissions, and
exposes a Unix socket interface that the web server uses for login and user
session setup. This keeps sensitive authentication logic out of the web process
while still allowing opencode to act on behalf of authenticated system users.

## Usage Overview

- The broker runs as a background service (launchd on macOS, systemd on Linux).
- The web server connects to the broker over a Unix socket.
- If the broker is not running, authentication and user session features will
  fail.
- In most deployments, the broker is automatically managed by
  `opencode-cloud` (https://github.com/pRizz/opencode-cloud).

This package provides the `opencode-broker` service. It listens on a Unix socket
and is typically managed by the OS service manager.

## Development (local)

For local development, you can run the broker directly instead of through
launchd/systemd. This is useful for testing changes and seeing logs in the
foreground.

### Build and run (debug)

```bash
cd packages/opencode-broker
cargo run --bin opencode-broker
```

### Run with sudo (required for privileged operations)

Some broker features (PAM and user impersonation) require elevated privileges.
Run with sudo when you need those code paths:

```bash
cd packages/opencode-broker
sudo cargo run --bin opencode-broker
```

### Common troubleshooting

- If you see `Address already in use`, stop the system service or remove any
  stale socket (see socket section below).
- Ensure the broker has permission to create `/var/run/opencode/auth.sock`.

## Socket Location

By default the broker uses a Unix socket at:

`/var/run/opencode/auth.sock`

If you see errors like `Address already in use`, it usually means another broker
instance is already running or a stale socket file exists.

## macOS (launchd)

The broker is commonly installed as a LaunchDaemon:

`/Library/LaunchDaemons/com.opencode.broker.plist`

### Check status

```bash
sudo launchctl print system/com.opencode.broker
```

### Stop (system domain)

```bash
sudo launchctl stop system/com.opencode.broker
```

### Unload/disable (system domain)

```bash
sudo launchctl bootout system /Library/LaunchDaemons/com.opencode.broker.plist
```

### Re-enable (system domain)

```bash
sudo launchctl bootstrap system /Library/LaunchDaemons/com.opencode.broker.plist
sudo launchctl start system/com.opencode.broker
```

### User agent (less common)

```bash
launchctl print gui/$(id -u)/com.opencode.broker
launchctl stop gui/$(id -u)/com.opencode.broker
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.opencode.broker.plist
```

## Linux (systemd)

The broker can be installed as a systemd service:

`/etc/systemd/system/opencode-broker.service`

### Check status

```bash
sudo systemctl status opencode-broker
```

### Stop / disable

```bash
sudo systemctl stop opencode-broker
sudo systemctl disable opencode-broker
```

## Find the owning PID for the socket

On macOS:

```bash
sudo lsof -a -n -U -- /var/run/opencode/auth.sock
```

On Linux:

```bash
sudo lsof -a -n -U -- /var/run/opencode/auth.sock
```

If the socket exists but no process is listening, remove it:

```bash
sudo rm /var/run/opencode/auth.sock
```

## 2FA file debugging

The broker manages each user's `~/.google_authenticator` file. When debugging
2FA setup, it helps to verify whether the file exists and remove it between
tests.

Check if the file exists:

```bash
sudo test -f /Users/testuser/.google_authenticator && echo "exists" || echo "missing"
```

Inspect permissions/ownership:

```bash
sudo ls -l /Users/testuser/.google_authenticator
```

Remove the file (reset 2FA for that user):

```bash
sudo rm /Users/testuser/.google_authenticator
```

## macOS test users (development)

macOS user management is done via Directory Services. You will generally need
`sudo` for all of these commands.

### Recommended tool: `sysadminctl`

Note: when setting passwords via the CLI, use at least 4 characters. Shorter
passwords can lead to broken authentication prompts or other odd behavior.

Create a standard user:

```bash
sudo sysadminctl \
  -addUser testuser \
  -fullName "Test User" \
  -password "ReplaceMe123!"
```

Create an admin user:

```bash
sudo sysadminctl \
  -addUser testadmin \
  -fullName "Test Admin" \
  -password "ReplaceMe123!" \
  -admin
```

Delete a user:

```bash
sudo sysadminctl -deleteUser testuser
```

Reset a user's password:

```bash
sudo sysadminctl -resetPasswordFor testuser -newPassword "ReplaceMe123!"
```

List users:

```bash
dscl . list /Users
```

### Advanced tool: `dscl`

Manual user creation (lower-level, use with care):

```bash
sudo dscl . -create /Users/testuser
sudo dscl . -create /Users/testuser UserShell /bin/zsh
sudo dscl . -create /Users/testuser RealName "Test User"
sudo dscl . -create /Users/testuser UniqueID 501
sudo dscl . -create /Users/testuser PrimaryGroupID 20
sudo dscl . -create /Users/testuser NFSHomeDirectory /Users/testuser
sudo dscl . -passwd /Users/testuser ReplaceMe123!
sudo createhomedir -c -u testuser
```

Notes:

- `UniqueID` must be unique. Check existing IDs:
  ```bash
  dscl . -list /Users UniqueID
  ```
- `PrimaryGroupID 20` is the `staff` group (normal users).

Make the user an admin:

```bash
sudo dscl . -append /Groups/admin GroupMembership testuser
```

Delete a user:

```bash
sudo dscl . -delete /Users/testuser
sudo rm -rf /Users/testuser
```

### Check user details

```bash
id testuser
dscl . -read /Users/testuser
```

### Hide a system user from the login screen

```bash
sudo dscl . -create /Users/testuser IsHidden 1
```

### Secure Token / FileVault gotcha

On FileVault-enabled machines, some password operations require an admin
account with a Secure Token.

Check Secure Token status:

```bash
sysadminctl -secureTokenStatus adminuser
sysadminctl -secureTokenStatus testuser
```

Reset a user's password using a Secure Token admin (prompts for admin password):

```bash
sudo sysadminctl \
  -adminUser adminuser \
  -adminPassword - \
  -resetPasswordFor testuser \
  -newPassword "ReplaceMe123!"
```

If the test user needs a Secure Token (for FileVault unlock), enable it:

```bash
sudo sysadminctl \
  -adminUser adminuser \
  -adminPassword - \
  -secureTokenOn testuser \
  -password "ReplaceMe123!"
```

### Practical tips

- Avoid leading-underscore usernames (`_testuser`) for login accounts; those are
  often system/service users.
- macOS uses Directory Services. Do not edit `/etc/passwd` directly.

### GUI option (System Settings)

For most developers, the simplest and safest way to create a test user is
through the macOS UI:

1. Open **System Settings** → **Users & Groups**.
2. Unlock with the lock icon (admin password).
3. Click **Add User…**.
4. Choose **Standard** or **Administrator**.
5. Fill in the name, account name, and password, then click **Create User**.

## Linux/Ubuntu test users (development)

On Ubuntu and most Linux distros, use the standard `useradd`/`usermod` tools.
These commands also require `sudo`.

### Create a standard user

```bash
sudo useradd -m -s /bin/bash testuser
sudo passwd testuser
```

### Create an admin (sudo) user

```bash
sudo useradd -m -s /bin/bash testadmin
sudo usermod -aG sudo testadmin
sudo passwd testadmin
```

### Delete a user

```bash
sudo userdel testuser
sudo rm -rf /home/testuser
```

### Reset a user's password

```bash
sudo passwd testuser
```

### List users

```bash
getent passwd
```

### Check user details

```bash
id testuser
getent passwd testuser
```

### Hide a system user from login screen (GDM)

```bash
sudo sh -c 'cat >/etc/dconf/db/gdm.d/99-hide-users <<EOF
[org/gnome/login-screen]
disable-user-list=true
EOF'
sudo dconf update
```
