---
title: "bun audit"
description: "Check your installed packages for known security vulnerabilities"
---

Run the command in a project with a `bun.lock` file:

```bash terminal icon="terminal"
bun audit
```

Bun sends the list of installed packages and versions to NPM, and prints a report of any vulnerabilities that were found. Packages installed from registries other than the default registry are skipped.

If no vulnerabilities are found, the command prints:

```
No vulnerabilities found
```

When vulnerabilities are detected, each affected package is listed along with the severity, a short description and a link to the advisory. At the end of the report Bun prints a summary and hints for updating:

```
3 vulnerabilities (1 high, 2 moderate)
To update all dependencies to the latest compatible versions:
  bun update
To update all dependencies to the latest versions (including breaking changes):
  bun update --latest
```

### Filtering options

**`--audit-level=<low|moderate|high|critical>`** - Only show vulnerabilities at this severity level or higher:

```bash terminal icon="terminal"
bun audit --audit-level=high
```

**`--prod`** - Audit only production dependencies (excludes devDependencies):

```bash terminal icon="terminal"
bun audit --prod
```

**`--ignore <CVE>`** - Ignore specific CVEs (can be used multiple times):

```bash terminal icon="terminal"
bun audit --ignore CVE-2022-25883 --ignore CVE-2023-26136
```

### `--json`

Use the `--json` flag to print the raw JSON response from the registry instead of the formatted report:

```bash terminal icon="terminal"
bun audit --json
```

### Exit code

`bun audit` will exit with code `0` if no vulnerabilities are found and `1` if the report lists any vulnerabilities. This will still happen even if `--json` is passed.
