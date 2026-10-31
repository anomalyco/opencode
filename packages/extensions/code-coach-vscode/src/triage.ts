/*
 * triage.ts - the deterministic part of Code Coach.
 *
 * Pure function. No model, no network, no editor dependency. Given the prompt
 * (or edit summary) and the diff about to land, it returns the findings worth
 * interrupting for, most severe first, capped at two. Silence is the default.
 *
 * Each finding carries its own teaching line (why) and its own fix, so the card
 * can render Explain why and Fix my prompt from the same object.
 */

export type Severity = "ignore" | "info" | "warn" | "critical";

export type Finding = {
  id: string;
  category: "security" | "correctness" | "maintainability";
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  tags: string[];
};

// A concept the learner has seen MASTERED_AT times should not be re-taught.
// Both the extension (via the profile) and the tests pass this list in; the
// engine drops those lessons automatically so silence stays the default.
export const MASTERED_AT = 3;

export type Decision =
  | { kind: "none" }
  | { kind: "nudge"; findings: Finding[] };

// Order matters: most severe first, capped at two in render.
const ORDER: Record<string, number> = {
  "sql-concat": 0,
  "shell-exec": 1,
  "secret-in-code": 2,
  "plaintext-password": 3,
  "xss": 4,
  "input-unvalidated": 5,
  "eval": 6,
  "no-try-catch": 7,
  "console-log": 8,
  "todo-leftover": 9,
};

function severityValue(s: Severity): number {
  return s === "critical" ? 3 : s === "warn" ? 2 : s === "info" ? 1 : 0;
}

// --- pattern helpers ------------------------------------------------------

const RE_SECRET_LITERAL =
  /((?:sk-[A-Za-z0-9_-]{1,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----))/;
const RE_PASSWORD_LITERAL = /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{6,}['"]/i;
const RE_SQL_CONCAT = /\b(query|execute|raw|sql)\s*\(|\$\{/i;
const RE_SQL_TAINT = /(req\b|req\.|request\.|user|input|search|q)\b/i;
const RE_USER_INPUT = /(req\.params|req\.query|req\.body|req\.cookies|\.query\b|\.params\b|\.body\b)/i;
const RE_SHELL_EXEC = /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/i;
const RE_INNERHTML = /\.innerHTML\s*=|\bouterHTML\s*=|dangerouslySetInnerHTML/i;
const RE_EVAL = /\beval\s*\(|\bFunction\s*\(/i;
const RE_CONSOLE = /\bconsole\.(log|info|debug|warn|error)\s*\(/i;
const RE_TODO = /\b(TODO|FIXME|XXX|HACK)\b/i;
const RE_PASSWORD_WORD = /\b(password|passwd|pwd|passphrase|credential|secret)\b/i;
const RE_HASH = /\b(bcrypt|argon2|scrypt|pbkdf2|hash|hashSync|createHash)\b/i;
const RE_RATE = /\b(rate[- ]?limit|throttle|lockout|attempts?\s+per|max[- ]?attempts|brute[- ]?force)/i;

// A risky call sitting in a diff with no try/catch anywhere near it.
function hasRiskWithoutGuard(diff: string, risky: RegExp): boolean {
  if (!risky.test(diff)) {
    return false;
  }
  // Coarse guard: treat the whole hunk as guarded if any try/catch pair exists.
  return !/try\s*\{[\s\S]*?catch/i.test(diff);
}

// --- findings -------------------------------------------------------------

function passwordFinding(): Finding {
  return {
    id: "plaintext-password",
    category: "security",
    severity: "warn",
    title: "Passwords would be compared in plaintext",
    why:
      "A hash is one-way: you store hash(password) with a per-user salt, and at login you hash what the user typed and compare in constant time. Even you can't recover the original from a hash.",
    fix:
      "Store bcrypt or argon2id with a per-user salt, compare with a constant-time function, and return generic errors so logins can't enumerate accounts.",
    tags: ["password-hashing"],
  };
}

function secretFinding(): Finding {
  return {
    id: "secret-in-code",
    category: "security",
    severity: "critical",
    title: "A secret is being committed",
    why:
      "Once a secret is in the diff it is in every clone, every backup, and every fork. Deleting the line does not delete it from history. It must never live in the repo.",
    fix:
      "Read it from an environment variable or a secret manager at runtime, and rotate the one that just landed.",
    tags: ["secrets"],
  };
}

function sqlFinding(): Finding {
  return {
    id: "sql-concat",
    category: "security",
    severity: "critical",
    title: "SQL built from input",
    why:
      "A query is code. When input is joined into the query string, the database can't tell your SQL from the input, so the input becomes code too.",
    fix:
      "Use parameterized queries or your ORM's query builder. Send the SQL and the values separately so the values are always treated as data.",
    tags: ["sql-injection"],
  };
}

function shellFinding(): Finding {
  return {
    id: "shell-exec",
    category: "security",
    severity: "critical",
    title: "Shell command built from input",
    why:
      "A shell interprets punctuation. If the input is pasted into the command string, the input can close your command and start another one.",
    fix:
      "Pass an argument array with shell disabled, and validate the input against an allowlist before it reaches exec.",
    tags: ["command-injection"],
  };
}

function xssFinding(): Finding {
  return {
    id: "xss",
    category: "security",
    severity: "warn",
    title: "User content rendered as HTML",
    why:
      "The browser cannot tell your markup from the user's markup once they are one string. A script tag in a comment then runs in every reader's browser.",
    fix:
      "Escape the output, or sanitize it with a library like DOMPurify before setting innerHTML.",
    tags: ["xss"],
  };
}

function unvalidatedFinding(): Finding {
  return {
    id: "input-unvalidated",
    category: "security",
    severity: "warn",
    title: "Input used without validation",
    why:
      "Every boundary is a place where the shape of the data can change. Validate at the boundary so the rest of the code can assume a known shape.",
    fix:
      "Validate against a schema (zod/yup) at the request boundary, and only pass the fields you expect downstream.",
    tags: ["input-validation"],
  };
}

function evalFinding(): Finding {
  return {
    id: "eval",
    category: "correctness",
    severity: "warn",
    title: "eval() runs untrusted text as code",
    why: "eval executes a string, so any input that reaches it is running as code in the process.",
    fix: "Replace eval with the parser you actually need â€” JSON.parse, a real templating engine, or explicit data fields.",
    tags: ["eval"],
  };
}

function tryCatchFinding(): Finding {
  return {
    id: "no-try-catch",
    category: "correctness",
    severity: "info",
    title: "A fallible call has no error handling",
    why: "Network, filesystem and database calls reject on failure. A swallowed or unhandled rejection leaves the session in a half-state that is expensive to debug.",
    fix: "Wrap the fallible call in try/catch (or .catch), and decide what the user actually sees on failure.",
    tags: ["error-handling"],
  };
}

function consoleFinding(): Finding {
  return {
    id: "console-log",
    category: "maintainability",
    severity: "info",
    title: "debug log left in the diff",
    why: "A stray console.log ships debug noise to the user's console and can leak sensitive values in production.",
    fix: "Remove it, or route it through your logger so it is off by default.",
    tags: ["debug-log"],
  };
}

function todoFinding(): Finding {
  return {
    id: "todo-leftover",
    category: "maintainability",
    severity: "info",
    title: "TODO left in the diff",
    why: "A TODO with no owner or deadline is technical debt that survives the PR.",
    fix: "Open an issue for it and remove the marker, or delete the line if it is dead.",
    tags: ["technical-debt"],
  };
}

// --- scorers --------------------------------------------------------------

export function score(prompt: string, diff: string, knownTags: string[] = []): Finding[] {
  const p = String(prompt ?? "");
  const d = String(diff ?? "");
  const found: Finding[] = [];
  if (!p && !d) {
    return found;
  }

  // Password handling is prompted, and the diff does not show hashing.
  if (RE_PASSWORD_WORD.test(p) && !RE_HASH.test(d)) {
    found.push(passwordFinding());
  }

  // Rate limiting on a credential prompt.
  if (RE_PASSWORD_WORD.test(p) && !RE_RATE.test(p) && !RE_RATE.test(d)) {
    if (!found.some((f) => f.id === "rate-limit")) {
      found.push({
        id: "rate-limit",
        category: "security",
        severity: "warn",
        title: "No rate limiting on the credential path",
        why:
          "A login without a limit lets a client try thousands of passwords a minute against one account. Per-IP and per-account limits with a short lockout turn that into a handful.",
        fix:
          "Rate-limit to 5 attempts per minute per IP and per account, and return generic errors.",
        tags: ["rate-limiting"],
      });
    }
  }

  if (RE_SECRET_LITERAL.test(d) || RE_PASSWORD_LITERAL.test(d)) {
    found.push(secretFinding());
  }

  if (RE_SQL_CONCAT.test(d) && RE_SQL_TAINT.test(d)) {
    found.push(sqlFinding());
  }

  if (RE_SHELL_EXEC.test(d)) {
    found.push(shellFinding());
  }

  if (RE_INNERHTML.test(d)) {
    found.push(xssFinding());
  }

  if (RE_USER_INPUT.test(d) && !/zod|yup|joi|ajv|schema|validate|allowlist|whitelist/i.test(d)) {
    found.push(unvalidatedFinding());
  }

  if (RE_EVAL.test(d)) {
    found.push(evalFinding());
  }

  if (hasRiskWithoutGuard(d, /fetch\s*\(|\.then\(|catch\s*\(|\.json\(|insertOne|insertMany|findOne|findById|save\s*\(|updateOne|deleteOne/i)) {
    found.push(tryCatchFinding());
  }

  if (RE_CONSOLE.test(d)) {
    found.push(consoleFinding());
  }

  if (RE_TODO.test(d)) {
    found.push(todoFinding());
  }

  // Drop duplicates, then order by severity *then* by the fixed order table so
  // the capped view always shows the most severe first.
  const seen = new Set<string>();
  const unique = found.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  unique.sort((a, b) => {
    const sa = ORDER[a.id] ?? 99;
    const sb = ORDER[b.id] ?? 99;
    return sa - sb;
  });

  // Don't teach something the profile already shows as mastered. The fix stays.
  return unique.filter((f) => f.tags.some((t) => !knownTags.includes(t)));
}

export function decide(prompt: string, diff: string, knownTags: string[] = []): Decision {
  const all = score(prompt, diff, knownTags);
  if (all.length === 0) {
    return { kind: "none" };
  }
  return { kind: "nudge", findings: all.slice(0, 2) };
}

