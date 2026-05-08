<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# NPM Publishing Guide

**Purpose**: Quick reference for publishing OpenAgents Control to npm

**Time to Read**: 3 minutes

---

## Core Concept

OpenAgents Control is published as `@nextsystems/oac` on npm. Users install globally and run `oac [profile]` to set up their projects.

**Key files**:
- `package.json` - Package configuration
- `bin/oac.js` - CLI entry point
- `.npmignore` - Exclude dev files
- `install.sh` - Main installer (runs when user executes `oac`)

---

## Publishing Workflow

### 1. Prepare Release

```bash
# Update version
npm version patch  # 0.7.0 -> 0.7.1
npm version minor  # 0.7.0 -> 0.8.0

# Update VERSION file
node -p "require('./package.json').version" > VERSION

# Update CHANGELOG.md with changes
```

### 2. Test Locally

```bash
# Create package
npm pack

# Install globally from tarball
npm install -g ./nextsystems-oac-0.7.1.tgz

# Test CLI
oac --version
oac --help

# Uninstall
npm uninstall -g @nextsystems/oac
```

### 3. Publish

```bash
# Login (one-time)
npm login

# Publish (scoped packages need --access public)
npm publish --access public
```

### 4. Verify

```bash
# Check it's live
npm view @nextsystems/oac

# Test installation
npm install -g @nextsystems/oac
oac --version
```

### 5. Create GitHub Release

```bash
git tag v0.7.1
git push --tags
# Create release on GitHub with changelog
```

---

## User Installation

Once published, users can:

```bash
# Global install (recommended)
npm install -g @nextsystems/oac
oac developer

# Or use npx (no install)
npx @nextsystems/oac developer
```

---

## Common Issues

**"You do not have permission to publish"**
```bash
npm whoami  # Check you're logged in
npm publish --access public  # Scoped packages need public access
```

**"Version already exists"**
```bash
npm version patch  # Bump version first
```

**"You must verify your email"**
```bash
npm profile get  # Check email verification status
```

---

## Package Configuration

**What's included** (see `package.json` → `files`):
- `.opencode/` - Agents, commands, context, profiles, skills, tools
- `scripts/` - Installation scripts
- `bin/` - CLI entry point
- `registry.json` - Component registry
- `install.sh` - Main installer
- Docs (README, CHANGELOG, LICENSE)

**What's excluded** (see `.npmignore`):
- `node_modules/`
- `evals/`
- `.tmp/`
- Dev files

---

## Security

- ✅ Enable 2FA: `npm profile enable-2fa auth-and-writes`
- ✅ Use strong npm password
- ✅ `@nextsystems` scope is protected (only you can publish)

---

## References

- **Package**: https://www.npmjs.com/package/@nextsystems/oac
- **Stats**: https://npm-stat.com/charts.html?package=@nextsystems/oac
- **Codebase**: `package.json`, `bin/oac.js`, `.npmignore`

---

**Last Updated**: 2026-01-30
