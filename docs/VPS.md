# VPS Management

OpenCode allows you to connect to multiple VPS servers via SSH and seamlessly switch between local and remote environments.

## Quick Start

### 1. Configure VPS in `opencode.json`

```json
{
  "vps": {
    "production": {
      "host": "example.com",
      "port": 22,
      "user": "ubuntu",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa"
      },
      "nickname": "Production Server"
    },
    "staging": {
      "host": "staging.example.com",
      "port": 22,
      "user": "deploy",
      "auth": {
        "type": "password",
        "promptPassword": true
      },
      "nickname": "Staging"
    }
  }
}
```

### 2. Connect to a VPS

```bash
# Using CLI
opencode vps connect production

# Or use the AI agent
> Switch to production VPS
```

### 3. Execute Commands

Once connected, commands execute on the remote server:

```bash
# Check status
opencode vps status

# Switch context
opencode vps switch production    # Switch to VPS
opencode vps switch local         # Switch back to local
```

## Configuration Reference

### VPS Connection Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | Yes | Hostname or IP address |
| `port` | number | No | SSH port (default: 22) |
| `user` | string | Yes | SSH username |
| `auth` | object | Yes | Authentication configuration |
| `nickname` | string | No | Display name for the VPS |
| `env` | object | No | Environment variables to set |
| `forwardAgent` | boolean | No | Enable SSH agent forwarding |
| `keepAliveInterval` | number | No | Keep-alive interval in ms (default: 30000) |
| `defaultDirectory` | string | No | Default working directory |

### Authentication Methods

#### SSH Key (Recommended)

```json
{
  "auth": {
    "type": "key",
    "keyPath": "~/.ssh/id_rsa",
    "passphrase": "optional-passphrase"
  }
}
```

#### Password (Interactive)

```json
{
  "auth": {
    "type": "password",
    "promptPassword": true
  }
}
```

#### SSH Agent

```json
{
  "auth": {
    "type": "agent"
  }
}
```

## CLI Commands

### List Configured VPS

```bash
opencode vps list
opencode vps list --format json
```

### Connect to VPS

```bash
opencode vps connect <name>
opencode vps connect production --password "mypassword"
```

### Disconnect from VPS

```bash
opencode vps disconnect <name>
```

### Check Status

```bash
opencode vps status
opencode vps status --format json
```

### Switch Context

```bash
opencode vps switch production    # Switch to VPS
opencode vps switch local         # Switch back to local
```

## AI Agent Integration

The AI agent can manage VPS connections using the `vps` tool:

### Available Actions

| Action | Description |
|--------|-------------|
| `exec` | Execute a shell command |
| `read` | Read a file from VPS |
| `write` | Write content to a file |
| `ls` | List directory contents |
| `switch` | Switch context (local/VPS) |
| `status` | Show VPS status |
| `connect` | Connect to a VPS |
| `disconnect` | Disconnect from VPS |

### Examples

```
User: Execute 'ls -la /var/www' on production server

AI: I'll execute that command on the production VPS.
[Uses vps tool with action: exec, command: "ls -la /var/www", vps: "production"]
```

```
User: Read the nginx config from staging

AI: I'll read the nginx configuration file.
[Uses vps tool with action: read, path: "/etc/nginx/nginx.conf", vps: "staging"]
```

```
User: Deploy the application to production

AI: I'll switch to production and run the deployment.
[Uses vps tool with action: switch, target: "production"]
[Uses vps tool with action: exec, command: "cd /var/www/app && git pull && npm install && pm2 restart all"]
```

## REST API

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/vps/config` | List configured VPS |
| GET | `/vps/connection` | List active connections |
| POST | `/vps/connection/:configKey` | Connect to VPS |
| DELETE | `/vps/connection/:vpsId` | Disconnect |
| GET | `/vps/context` | Get current context |
| POST | `/vps/context/switch` | Switch context |
| GET | `/vps/pty` | List VPS terminal sessions |
| POST | `/vps/pty` | Create terminal session |
| GET | `/vps/pty/:ptyId/connect` | WebSocket terminal connection |
| POST | `/vps/file/read` | Read remote file |
| POST | `/vps/file/write` | Write remote file |
| POST | `/vps/file/list` | List directory |
| POST | `/vps/exec` | Execute command |

## Auto-Skills Integration

Create skills that automatically trigger based on user messages:

### Example: Deploy Skill

Create `.opencode/skill/deploy/SKILL.md`:

```markdown
---
name: deploy-production
description: Deploy application to production server
triggers:
  - deploy to production
  - push to production
  - release to prod
autoInvoke: true
---

# Deploy to Production

When this skill is triggered:

1. Switch to production VPS
2. Pull latest code
3. Install dependencies
4. Restart application
5. Verify deployment
```

When a user says "deploy to production", OpenCode automatically detects and invokes this skill.

## Best Practices

### Security

1. **Use SSH keys** instead of passwords when possible
2. **Never commit** SSH keys or passwords to version control
3. **Use SSH agent** for secure key management
4. **Enable agent forwarding** only when necessary
5. **Rotate keys** regularly

### Connection Management

1. **Use meaningful nicknames** for easy identification
2. **Set appropriate timeouts** for long-running commands
3. **Configure keep-alive** to prevent connection drops
4. **Handle disconnections** gracefully in automation

### Performance

1. **Minimize context switches** when possible
2. **Batch commands** when executing multiple operations
3. **Use SFTP** for file transfers instead of command output

## Troubleshooting

### Connection Refused

- Verify the host and port are correct
- Check if SSH is running on the server
- Ensure your IP is not blocked by firewall

### Authentication Failed

- Verify username is correct
- Check key file permissions (should be 600)
- Ensure key is authorized on server
- Try SSH agent if using encrypted key

### Connection Timeout

- Check network connectivity
- Verify server is reachable
- Adjust `keepAliveInterval` setting

### Command Timeout

- Increase `timeout` parameter for long-running commands
- Consider using background execution with `nohup`
