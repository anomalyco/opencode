# Security Architecture: Enhanced OpenCode Universal Agent Ecosystem

## 1. Threat Model & Security Posture

Third-party extensions, skills, rules, and MCP servers originate from external or untrusted sources (e.g. public GitHub repositories, zip archives, community registries). They must be treated as **untrusted code and inputs**.

The enhanced ecosystem enforces defense-in-depth across five key vectors:
1. **Source Inspection & AST Analysis**: Before any extension code is loaded or executed.
2. **Permission Boundary**: Explicit capabilities requested by extensions.
3. **Execution Isolation & Sandboxing**: Restricting filesystem and network scope.
4. **Secret Protection**: Preventing leakage of API tokens and environment variables.
5. **Transactional Installation & Rollback**: Safe recovery from failed or corrupted installations.

---

## 2. Static Security Inspection

When importing an extension (via Git repository, archive, or local directory), the Security Engine performs automated checks before registering files:

### Checks:
- **Path Traversal Prevention**: Ensures no filenames contain `..`, absolute drives, or attempt to break out of the extension target sandbox.
- **Dangerous Executable Patterns**: Scans scripts for unconstrained operations (e.g., `rm -rf /`, `format`, arbitrary remote curl-to-bash execution without integrity pins).
- **Embedded Credential Detection**: Identifies hardcoded API keys, private keys, or credentials embedded directly into files.
- **Dependency Audit**: Inspects `package.json` or requirements files for known malicious packages or excessive native dependency compilation.

---

## 3. Sandboxing & Runtime Permissions

- **Explicit Approval for Scripts**: Skills or plugins that include executable binaries or scripts (e.g. Python, Node, Bash scripts in a skill's `scripts/` folder) require explicit user consent before execution.
- **Process Isolation**: MCP servers and external scripts execute in isolated child processes with dedicated working directories and sanitized environment variables.
- **Filesystem Access Boundaries**: Extensions are constrained to their declared workspace directories unless granted global read permissions.

---

## 4. Secret & Credential Protection

- MCP configurations often require API keys (e.g., `GITHUB_TOKEN`, `DATABASE_URL`).
- All secret environment variables are:
  1. Stored securely using OpenCode's credential vault.
  2. Redacted from diagnostic logs, error traces, and UI display.
  3. Transferred to child processes only via direct process environment handles, never logged to stdout/stderr.

---

## 5. Safe Installation, Updates, and Rollback

All installation, update, and removal operations are **transactional**:
- Prior to altering any files or configuration, a snapshot is created in `.opencode/backup/extensions/<timestamp>/`.
- If an installation fails, file verification fails, or the extension crashes during health-check verification:
  1. The transaction is aborted.
  2. The filesystem state is rolled back to the snapshot.
  3. The user is notified with an error report explaining the failure without stranding corrupted files.
