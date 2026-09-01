export interface CommandAuditResult {
  allowed: boolean
  riskLevel: "safe" | "low" | "medium" | "high" | "critical"
  reason?: string
  blockedPattern?: string
}

export class CommandGuardrails {
  // Critical blocked patterns: privilege escalation, host destruction, fork bombs, disk formatting
  private static readonly BLOCKED_PATTERNS: { regex: RegExp; reason: string; risk: "critical" | "high" }[] = [
    // Privilege escalation
    { regex: /\b(sudo|su|doas|pkexec)\b/i, reason: "Privilege escalation is forbidden in autonomous execution", risk: "critical" },
    
    // Destructive filesystem commands
    { regex: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f*|-rf|-fr)\s+(\/|~|\$HOME|\.\.)(\s|$|\/)/i, reason: "Destructive root/home filesystem deletion is forbidden", risk: "critical" },
    { regex: /\bmkfs(\.[a-zA-Z0-9]+)?\b/i, reason: "Filesystem formatting is forbidden", risk: "critical" },
    { regex: /\bdd\s+if=/i, reason: "Raw block device writing (dd) is forbidden", risk: "critical" },
    { regex: /\b(fdisk|parted|gdisk)\b/i, reason: "Disk partition modification is forbidden", risk: "critical" },
    { regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "Fork bomb execution is forbidden", risk: "critical" },
    { regex: /\bchmod\s+(-[a-zA-Z]*R)?\s*777\s+(\/|~|\$HOME)/i, reason: "Root directory permission relaxation (chmod 777) is forbidden", risk: "critical" },

    // Secret exfiltration attempts
    { regex: /\bcat\s+(~\/|\$HOME\/|\/root\/)?\.ssh\/(id_rsa|id_ed25519|id_ecdsa|authorized_keys)/i, reason: "Accessing private SSH keys is forbidden", risk: "critical" },
    { regex: /\bcat\s+\/etc\/(shadow|gshadow|passwd)/i, reason: "Accessing system authentication tables is forbidden", risk: "critical" },
    { regex: /\b(curl|wget)\s+.*\|\s*(bash|sh|zsh|python|perl)/i, reason: "Piping remote web content directly into a shell interpreter is forbidden", risk: "high" },
  ]

  public static audit(command: string): CommandAuditResult {
    const trimmed = command.trim()
    if (!trimmed) {
      return { allowed: true, riskLevel: "safe" }
    }

    for (const rule of this.BLOCKED_PATTERNS) {
      if (rule.regex.test(trimmed)) {
        return {
          allowed: false,
          riskLevel: rule.risk,
          reason: rule.reason,
          blockedPattern: rule.regex.source,
        }
      }
    }

    // Check for risky commands that require confirmation
    if (/\bgit\s+push\s+.*--force/i.test(trimmed) || /\bdrop\s+(database|table)\b/i.test(trimmed)) {
      return {
        allowed: false,
        riskLevel: "high",
        reason: "Destructive database or force-push operations require manual interactive confirmation",
      }
    }

    return {
      allowed: true,
      riskLevel: "safe",
    }
  }
}
