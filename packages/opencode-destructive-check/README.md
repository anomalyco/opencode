# @sureshsankaran/opencode-destructive-check

An OpenCode plugin that automatically checks for destructive commands before any tool/bash call and asks for user permission before executing them.

## Features

- Detects destructive commands across multiple categories
- Asks for permission for all severity levels (critical, high, medium)
- Works automatically for all sessions and agents
- Provides a status tool to check plugin statistics

## Installation

Add the plugin to your `opencode.json` or `.opencode/opencode.jsonc` config:

```json
{
  "plugin": ["@sureshsankaran/opencode-destructive-check"]
}
```

## How It Works

1. **`tool.execute.before` hook**: Inspects every tool call before execution, logging warnings for dangerous patterns
2. **`permission.ask` hook**: Requires user confirmation for all detected destructive operations
3. **`tool.execute.after` hook**: Logs when the system blocks dangerous operations

When a destructive command is detected, the user will be prompted to approve or deny the operation, giving full control over whether to proceed.

---

## Complete List of Restricted Commands

### Critical Severity

#### File Deletion (rmDangerous)

| Pattern               | Description                                        |
| --------------------- | -------------------------------------------------- |
| `rm /`                | Remove root directory                              |
| `rm ~`                | Remove home directory                              |
| `rm /*`               | Remove all files in root                           |
| `rm ~/*`              | Remove all files in home                           |
| `rm -rf /`            | Force recursive remove root                        |
| `rm -rf ~`            | Force recursive remove home                        |
| `rm -rf $HOME`        | Force recursive remove home via variable           |
| `rm -rf /home`        | Remove all user home directories                   |
| `rm -rf /etc`         | Remove system configuration                        |
| `rm -rf /var`         | Remove variable data (logs, databases)             |
| `rm -rf /usr`         | Remove user programs                               |
| `rm -rf /bin`         | Remove essential binaries                          |
| `rm -rf /sbin`        | Remove system binaries                             |
| `rm -rf /boot`        | Remove boot files                                  |
| `rm -rf /lib`         | Remove shared libraries                            |
| `rm -rf /opt`         | Remove optional packages                           |
| `rm -rf /root`        | Remove root user home                              |
| `rm -rf /sys`         | Remove kernel virtual filesystem                   |
| `rm -rf /proc`        | Remove process information                         |
| `rm -rf /dev`         | Remove device files                                |
| `rm -rf /mnt`         | Remove mount points                                |
| `rm -rf /tmp`         | Remove temporary files                             |
| `rm -rf .git`         | Remove git repository                              |
| `rm -rf node_modules` | Remove node modules (dangerous in wrong directory) |

#### Sudo Commands (sudo)

| Pattern            | Description                     |
| ------------------ | ------------------------------- |
| `sudo rm -rf /`    | Elevated remove root            |
| `sudo rm -rf /...` | Elevated remove any system path |
| `sudo chmod ...`   | Elevated permission changes     |
| `sudo chown ...`   | Elevated ownership changes      |
| `sudo dd ...`      | Elevated disk operations        |
| `sudo mkfs ...`    | Elevated filesystem creation    |

#### System Commands (system)

| Pattern              | Description                          |
| -------------------- | ------------------------------------ |
| `chmod 777 /`        | Make root world-writable             |
| `chmod -R 777 /`     | Recursively make root world-writable |
| `chown <user> /`     | Change root ownership                |
| `chown -R <user> /`  | Recursively change root ownership    |
| `dd ... of=/dev/...` | Write directly to device             |
| `mkfs`               | Format filesystem                    |
| `mkfs.ext4`          | Format as ext4                       |
| `mkfs.xfs`           | Format as xfs                        |
| `format C:`          | Windows format drive                 |
| `format D:`          | Windows format drive                 |
| `fdisk`              | Partition manipulation               |
| `parted`             | Partition manipulation               |

---

### High Severity

#### Git Commands (git)

| Pattern                   | Description                                  |
| ------------------------- | -------------------------------------------- |
| `git push --force`        | Force push (overwrites remote history)       |
| `git push -f`             | Force push (short form)                      |
| `git push origin --force` | Force push to origin                         |
| `git reset --hard`        | Discard all local changes                    |
| `git reset --hard HEAD~1` | Discard commits                              |
| `git clean -f`            | Force remove untracked files                 |
| `git clean -fd`           | Force remove untracked files and directories |
| `git checkout -- .`       | Discard all working directory changes        |
| `git stash drop`          | Delete stashed changes                       |
| `git branch -D`           | Force delete branch                          |
| `git reflog expire`       | Expire reflog entries                        |
| `git gc --prune`          | Garbage collect and prune                    |

#### Database Commands (database)

| Pattern                       | Description                       |
| ----------------------------- | --------------------------------- |
| `DROP TABLE <name>`           | Delete database table             |
| `DROP DATABASE <name>`        | Delete entire database            |
| `DROP SCHEMA <name>`          | Delete database schema            |
| `DROP INDEX <name>`           | Delete database index             |
| `TRUNCATE TABLE <name>`       | Remove all rows from table        |
| `DELETE FROM <table>;`        | Delete all rows (no WHERE clause) |
| `DELETE FROM <table>`         | Delete all rows (no WHERE clause) |
| `ALTER TABLE <name> DROP ...` | Drop column or constraint         |

#### Container/Cloud Commands (container)

| Pattern                             | Description                         |
| ----------------------------------- | ----------------------------------- |
| `kubectl delete namespace`          | Delete Kubernetes namespace         |
| `kubectl delete ns`                 | Delete Kubernetes namespace (short) |
| `kubectl delete pod`                | Delete Kubernetes pod               |
| `kubectl delete deployment`         | Delete Kubernetes deployment        |
| `kubectl delete service`            | Delete Kubernetes service           |
| `docker rm -f`                      | Force remove container              |
| `docker rm --force`                 | Force remove container              |
| `docker system prune -a`            | Remove all unused Docker data       |
| `docker system prune --all`         | Remove all unused Docker data       |
| `docker volume rm`                  | Remove Docker volume                |
| `aws s3 rm --recursive`             | Recursively delete S3 objects       |
| `aws s3 rm s3://bucket --recursive` | Delete entire S3 bucket contents    |
| `aws ec2 terminate-instances`       | Terminate EC2 instances             |
| `gcloud ... delete`                 | Google Cloud delete operations      |
| `gcloud compute instances delete`   | Delete GCP instances                |
| `gcloud container clusters delete`  | Delete GKE clusters                 |

---

### Medium Severity

#### Package Manager Commands (packages)

| Pattern                   | Description                      |
| ------------------------- | -------------------------------- |
| `npm cache clean --force` | Force clean npm cache            |
| `yarn cache clean`        | Clean yarn cache                 |
| `pip uninstall -y`        | Auto-confirm pip uninstall       |
| `pip uninstall --yes`     | Auto-confirm pip uninstall       |
| `brew uninstall --force`  | Force uninstall Homebrew package |

#### Network Commands (network)

| Pattern              | Description                |
| -------------------- | -------------------------- |
| `iptables -F`        | Flush all iptables rules   |
| `iptables --flush`   | Flush all iptables rules   |
| `iptables -t nat -F` | Flush NAT table            |
| `ufw reset`          | Reset firewall to defaults |

---

## Protected File Paths

The plugin also asks for permission when file operations target these dangerous paths:

### System Directories

| Path    | Description           |
| ------- | --------------------- |
| `/`     | Root directory        |
| `/*`    | All files in root     |
| `/home` | User home directories |
| `/etc`  | System configuration  |
| `/var`  | Variable data         |
| `/usr`  | User programs         |
| `/bin`  | Essential binaries    |
| `/sbin` | System binaries       |
| `/boot` | Boot files            |
| `/lib`  | Shared libraries      |
| `/opt`  | Optional packages     |
| `/root` | Root user home        |
| `/sys`  | Kernel filesystem     |
| `/proc` | Process information   |
| `/dev`  | Device files          |

### User Directories

| Path    | Description             |
| ------- | ----------------------- |
| `~`     | Current user home       |
| `~/`    | Current user home       |
| `$HOME` | Home directory variable |

### Project/Config Files

| Path                | Description                                 |
| ------------------- | ------------------------------------------- |
| `.git`              | Git repository                              |
| `.env`              | Environment variables (may contain secrets) |
| `.ssh`              | SSH keys and config                         |
| `package.json`      | Node.js project config                      |
| `package-lock.json` | Node.js dependency lock                     |
| `yarn.lock`         | Yarn dependency lock                        |
| `bun.lockb`         | Bun dependency lock                         |
| `Cargo.toml`        | Rust project config                         |
| `go.mod`            | Go module config                            |
| `pyproject.toml`    | Python project config                       |
| `requirements.txt`  | Python dependencies                         |

---

## Available Tools

### `destructive-check-status`

Returns the current status of the plugin including:

- Number of commands checked
- Number of permissions requested
- Last matched destructive pattern
- Pattern categories and counts

Example output:

```json
{
  "enabled": true,
  "session": {
    "id": "session-123",
    "checked": 45,
    "permissionsRequested": 2
  },
  "global": {
    "checked": 120,
    "permissionsRequested": 5
  },
  "patterns": {
    "categories": ["rmDangerous", "git", "database", "system", "sudo", "container", "packages", "network"],
    "total": 52
  },
  "dangerousPaths": 28
}
```

---

## Severity Levels

| Severity     | Action              | Categories                      |
| ------------ | ------------------- | ------------------------------- |
| **Critical** | Permission required | `rmDangerous`, `sudo`, `system` |
| **High**     | Permission required | `git`, `database`, `container`  |
| **Medium**   | Permission required | `packages`, `network`           |

All severity levels require user permission before execution.

---

## License

MIT
