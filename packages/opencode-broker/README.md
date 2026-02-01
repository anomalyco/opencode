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
