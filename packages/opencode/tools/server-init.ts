import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_FILE = join(homedir(), ".config", "opencode", "ssh-defaults.json")

interface SshDefaults {
  host?: string
  username?: string
  keyPath?: string
  port?: number
}

function readDefaults(): SshDefaults {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
  } catch { /* ignore */ }
  return {}
}

function getSshKey(keyPath?: string): string | null {
  const fp = keyPath || join(homedir(), ".ssh", "id_ed25519")
  if (existsSync(fp)) return readFileSync(fp, "utf-8")
  const rsa = keyPath || join(homedir(), ".ssh", "id_rsa")
  if (existsSync(rsa)) return readFileSync(rsa, "utf-8")
  return null
}

function runSSH(host: string, username: string, keyPath: string | undefined, port: number, command: string) {
  const args = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "BatchMode=yes",
    "-p", String(port),
  ]
  if (keyPath) args.push("-i", keyPath)
  args.push(`${username}@${host}`, command)

  const cmd = ["ssh", ...args.map((a) => (a.includes(" ") ? `"${a}"` : a))].join(" ")

  const result = spawnSync(cmd, [], {
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
    shell: true,
    windowsHide: true,
  })

  return {
    success: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    exitCode: result.status ?? 1,
  }
}

export const tool = {
  name: "server-init",
  description: "Initialize a fresh Linux server: install Docker, Nginx, PM2, Node.js, fail2ban, UFW. Requires SSH access configured via ssh-config.",
  schema: {
    input: {
      host: "string",
      username: "string",
      keyPath: "string",
      port: "number",
      addSSHKey: "string",
      hostname: "string",
      components: "string",
    },
    output: {
      success: "boolean",
      log: "string",
      error: "string",
    },
  },
}

export default function serverInit(input: {
  host?: string
  username?: string
  keyPath?: string
  port?: number
  addSSHKey?: string
  hostname?: string
  components?: string
}) {
  const defaults = readDefaults()
  const host = input.host ?? defaults.host
  const username = input.username ?? defaults.username
  const keyPath = input.keyPath ?? defaults.keyPath
  const port = input.port ?? defaults.port ?? 22

  if (!host || !username) return { success: false, log: "", error: "host and username required (set via ssh-config or pass directly)" }

  const logs: string[] = []
  let ok = true

  function run(cmd: string, label: string) {
    const r = runSSH(host!, username!, keyPath, port, cmd)
    logs.push(`## ${label}`)
    logs.push(`$ ${cmd}`)
    if (r.stdout) logs.push(r.stdout)
    if (!r.success) {
      logs.push(`ERROR: ${r.stderr}`)
      ok = false
    }
    return r
  }

  const selected = input.components ? input.components.split(",").map((s) => s.trim()) : ["docker", "nginx", "node", "pm2", "fail2ban", "ufw", "tailscale"]

  if (selected.includes("tailscale") && input.hostname) {
    const sshKey = getSshKey(keyPath)
    if (sshKey) {
      run(`mkdir -p ~/.ssh && echo ${JSON.stringify(input.addSSHKey || sshKey)} >> ~/.ssh/authorized_keys`, "Add SSH key")
    }
  }

  run("apt-get update -qq", "Update packages")

  if (selected.includes("docker")) {
    run("curl -fsSL https://get.docker.com | sh", "Install Docker")
    run(`usermod -aG docker ${username}`, "Add user to docker group")
  }

  if (selected.includes("docker") && selected.includes("compose")) {
    run("apt-get install -y docker-compose-plugin", "Install Docker Compose plugin")
  }

  if (selected.includes("nginx")) {
    run("apt-get install -y nginx", "Install Nginx")
    run("systemctl enable nginx && systemctl start nginx", "Enable Nginx")
  }

  if (selected.includes("node")) {
    run("curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs", "Install Node.js 22")
  }

  if (selected.includes("pm2")) {
    run("npm install -g pm2", "Install PM2")
    run("pm2 startup systemd -u " + username + " --hp /home/" + username, "PM2 startup")
  }

  if (selected.includes("fail2ban")) {
    run("apt-get install -y fail2ban", "Install fail2ban")
    run("systemctl enable fail2ban && systemctl start fail2ban", "Enable fail2ban")
  }

  if (selected.includes("ufw")) {
    run("ufw allow OpenSSH", "UFW allow SSH")
    run("ufw allow 'Nginx Full'", "UFW allow HTTP/HTTPS")
    run("ufw --force enable", "Enable UFW")
  }

  if (selected.includes("tailscale")) {
    run("curl -fsSL https://tailscale.com/install.sh | sh", "Install Tailscale")
  }

  if (selected.includes("hostname") && input.hostname) {
    run(`hostnamectl set-hostname ${input.hostname}`, "Set hostname")
  }

  run("apt-get autoremove -y && apt-get autoclean -y", "Cleanup")

  logs.push("---")
  logs.push(ok ? "Server initialization complete" : "Some steps failed")

  return { success: ok, log: logs.join("\n"), error: ok ? "" : "Check log for errors" }
}
