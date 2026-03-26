const PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Override patterns
  { pattern: /ignore previous instructions/i, label: "override: ignore previous instructions" },
  { pattern: /ignore all previous/i, label: "override: ignore all previous" },
  { pattern: /disregard your instructions/i, label: "override: disregard your instructions" },
  { pattern: /forget your instructions/i, label: "override: forget your instructions" },
  { pattern: /you are now/i, label: "override: you are now" },
  { pattern: /your new instructions are/i, label: "override: your new instructions are" },
  // Data exfiltration
  { pattern: /send this to/i, label: "exfil: send this to" },
  { pattern: /email the contents/i, label: "exfil: email the contents" },
  { pattern: /upload the contents/i, label: "exfil: upload the contents" },
  { pattern: /base64 encode everything/i, label: "exfil: base64 encode everything" },
  // Shell injection
  { pattern: /`[^`]+`/, label: "shell: backtick command" },
  { pattern: /\$\(/, label: "shell: $() substitution" },
  { pattern: /;\s*rm\s/, label: "shell: ; rm" },
  { pattern: /&&\s*curl/i, label: "shell: && curl" },
  // Jailbreak
  { pattern: /DAN mode/i, label: "jailbreak: DAN mode" },
  { pattern: /developer mode enabled/i, label: "jailbreak: developer mode enabled" },
  { pattern: /jailbreak/i, label: "jailbreak: jailbreak marker" },
]

export function scanForInjection(text: string): { safe: boolean; detections: string[] } {
  const detections: string[] = []
  for (const { pattern, label } of PATTERNS) {
    if (pattern.test(text)) {
      detections.push(label)
    }
  }
  return { safe: detections.length === 0, detections }
}
