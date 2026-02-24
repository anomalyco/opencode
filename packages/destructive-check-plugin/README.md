# @sureshsankaran/destructive-check-plugin

OpenCode plugin that automatically detects destructive commands and requires user permission before execution.

## Features

This plugin protects against potentially harmful operations by detecting:

- **File deletion**: `rm -rf`, `rm -fr` with dangerous paths (/, /home, /etc, etc.)
- **File overwrite**: `echo > ~/.env`, `cat > ~/.ssh/id_rsa` (any `>` redirect to sensitive files)
- **Git operations**: `git push --force`, `git reset --hard`, `git clean -f`
- **Database commands**: `DROP TABLE`, `DELETE FROM`, `TRUNCATE`
- **System operations**: `chmod 777`, `dd`, `mkfs`, `format`
- **Elevated privileges**: `sudo rm`, `sudo chmod`, `sudo dd`
- **Container/Cloud**: `kubectl delete`, `docker rm -f`, `aws s3 rm --recursive`
- **Package managers**: `npm cache clean --force`, `pip uninstall -y`
- **Network**: `iptables -F`, `ufw reset`

## Installation

### 1. Install the package

```bash
bun add @sureshsankaran/destructive-check-plugin
```

### 2. Enable in your OpenCode configuration

Add to your `opencode.json` or `.opencode/opencode.json`:

```json
{
  "plugin": ["@sureshsankaran/destructive-check-plugin"]
}
```

Or use a file path:

```json
{
  "plugin": ["file:///path/to/node_modules/@sureshsankaran/destructive-check-plugin/src/index.ts"]
}
```

## Usage

Once installed, the plugin automatically:

1. **Monitors** all tool calls and bash commands
2. **Detects** destructive patterns using regex matching
3. **Warns** in the console when a destructive command is detected
4. **Requests permission** from the user before executing dangerous operations

### Severity Levels

- **🔴 CRITICAL**: File deletion on system paths, sudo operations, system-level changes
- **🟠 HIGH**: Git history rewriting, database modifications, container deletions
- **🟡 MEDIUM**: Package manager operations, network configuration changes

### Example Output

```
[destructive-check] 🔴 CRITICAL destructive command detected
  Category: Dangerous File Deletion
  Command: rm -rf /
  ⚠️  This operation could cause data loss or system damage!
```

## Check Plugin Status

Use the built-in tool to check plugin status:

```typescript
// In OpenCode
destructive - check - status
```

Returns:

```json
{
  "enabled": true,
  "session": {
    "id": "session-123",
    "checked": 42,
    "permissionsRequested": 3
  },
  "global": {
    "checked": 156,
    "permissionsRequested": 12
  },
  "patterns": {
    "categories": ["rmDangerous", "git", "database", ...],
    "total": 45
  }
}
```

## Detected Patterns

### File Deletion

- `rm /`, `rm -rf /home`, `rm -rf /etc`
- `rm .git`, `rm package.json`
- `rm $HOME`, `rm ~/*`

### Git Operations

- `git push --force`, `git push -f`
- `git reset --hard`, `git reset HEAD~1`
- `git clean -f`, `git stash drop`
- `git branch -D`

### Database

- `DROP TABLE`, `DROP DATABASE`
- `DELETE FROM table` (without WHERE)
- `TRUNCATE TABLE`

### System

- `chmod 777 /`, `chown user /`
- `dd of=/dev/sda`
- `mkfs`, `format`, `fdisk`

### Containers/Cloud

- `kubectl delete namespace`
- `docker rm -f`, `docker system prune -a`
- `aws ec2 terminate-instances`
- `gcloud compute instances delete`

### File Overwrite via Redirect

The plugin detects overwriting (`>`) sensitive files, but allows appending (`>>`):

**Blocked (overwrite):**

- `echo 'secret' > ~/.env`
- `cat data > $HOME/.ssh/id_rsa`
- `printf '%s' > /etc/hosts`
- `command > ~/.bashrc`, `> ~/.zshrc`, `> ~/.profile`
- `> .git/config`, `> credentials`, `> *.pem`, `> *.key`

**Allowed (append):**

- `echo 'log' >> ~/.env`
- `echo 'entry' >> /var/log/app.log`

## Development

### Build

```bash
bun run build
```

### Test Locally

Link the package locally:

```bash
cd packages/destructive-check-plugin
bun link
cd /your/opencode/project
bun link @sureshsankaran/destructive-check-plugin
```

Add to your `opencode.json`:

```json
{
  "plugin": ["@sureshsankaran/destructive-check-plugin"]
}
```

## How It Works

The plugin uses three hooks:

1. **`tool.execute.before`**: Logs warnings when destructive commands are detected
2. **`permission.ask`**: Intercepts permission requests and flags destructive operations
3. **`tool.execute.after`**: Logs completion and any system blocks

## License

MIT

## Contributing

Issues and pull requests are welcome at [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode).
