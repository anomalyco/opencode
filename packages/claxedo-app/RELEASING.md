# Releasing Claxedo App

This document describes the process for creating a new release of Claxedo App.

## Pre-Release Checklist

Before creating a release, ensure the following:

- [ ] All features for this release are merged to `dev` branch
- [ ] All tests pass
- [ ] Web build works: `bun run build`
- [ ] Desktop build works: `bun run desktop:build`
- [ ] CHANGELOG.md is updated with release notes
- [ ] Version number follows semantic versioning

## Creating a Release

### Option 1: Automated Release Script

Use the release script for a streamlined process:

```bash
cd packages/claxedo-app

# Patch release (1.1.0 -> 1.1.1)
bun ./scripts/release.ts patch

# Minor release (1.1.0 -> 1.2.0)
bun ./scripts/release.ts minor

# Major release (1.1.0 -> 2.0.0)
bun ./scripts/release.ts major

# Dry run (preview changes without making them)
bun ./scripts/release.ts patch --dry-run
```

The script will:
1. Bump version in `package.json`
2. Add version entry to `CHANGELOG.md`
3. Create a git commit
4. Create a git tag (`claxedo-v{version}`)

After running the script:
```bash
# Review changes
git show HEAD

# Push to trigger CI
git push && git push --tags
```

### Option 2: Manual Release

1. **Update version**
   ```bash
   # Edit packages/claxedo-app/package.json
   # Change "version": "1.1.0" to "version": "1.2.0"
   ```

2. **Update CHANGELOG.md**
   - Move items from `[Unreleased]` to new version section
   - Add release date

3. **Commit and tag**
   ```bash
   git add packages/claxedo-app/package.json packages/claxedo-app/CHANGELOG.md
   git commit -m "chore(claxedo-app): release v1.2.0"
   git tag -a claxedo-v1.2.0 -m "Claxedo App v1.2.0"
   ```

4. **Push**
   ```bash
   git push && git push --tags
   ```

### Option 3: Manual Workflow Dispatch

Trigger a release build without creating a tag:

1. Go to Actions > Release Claxedo
2. Click "Run workflow"
3. Enter version number
4. Select platforms to build
5. Click "Run workflow"

## Code Signing Requirements

### Updater Signing (Tauri)

The auto-updater requires signing update artifacts with a Tauri signer keypair.

**Generate the keypair (run locally):**
```bash
bun x @tauri-apps/cli signer generate -w ~/.tauri/claxedo.key
```

Save the output (you will need both):
- Private key (long base64 string)
- Public key (shorter base64 string, often starting with `dW50...`)

**Required secrets:**
- `TAURI_SIGNING_PRIVATE_KEY` - entire private key output
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - the password you chose
- `TAURI_SIGNING_PUBLIC_KEY` - the public key string (safe to store as a secret or variable)

### macOS

Code signing requires an Apple Developer account and certificates.

**Required secrets:**
- `APPLE_CERTIFICATE` - Base64-encoded .p12 certificate
- `APPLE_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_SIGNING_IDENTITY` - Certificate name (e.g., "Developer ID Application: Your Name (TEAM_ID)")
- `APPLE_ID` - Apple ID email for notarization
- `APPLE_PASSWORD` - App-specific password for notarization
- `APPLE_TEAM_ID` - Your Apple Developer Team ID

**Local signing:**
```bash
# Export certificate from Keychain Access
# Set environment variables
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"

# Build with signing
bun ./scripts/desktop-build.ts --prod --sign
```

### Windows

Code signing requires an EV certificate or standard code signing certificate.

**Required secrets:**
- `TAURI_SIGNING_PRIVATE_KEY` - Private key for signing
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Key password

**Local signing:**
```bash
# Set environment variables
export TAURI_SIGNING_PRIVATE_KEY="your-private-key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"

# Build with signing
bun ./scripts/desktop-build.ts --prod --sign
```

### Linux

Linux packages (deb, rpm) don't require signing for installation but can be GPG signed for package manager verification.

## Artifact Locations

After a successful release build, artifacts are located at:

### Local Builds
```
packages/desktop/src-tauri/target/release/bundle/
├── dmg/           # macOS disk images
├── macos/         # macOS app bundles
├── nsis/          # Windows NSIS installers
├── msi/           # Windows MSI installers
├── deb/           # Debian packages
├── rpm/           # RPM packages
└── appimage/      # Linux AppImages
```

### GitHub Release
```
https://github.com/{owner}/{repo}/releases/tag/claxedo-v{version}
```

Artifacts include:
- `Claxedo_{version}_aarch64.dmg` - macOS ARM64
- `Claxedo_{version}_x64.dmg` - macOS x64
- `Claxedo_{version}_x64-setup.exe` - Windows installer
- `Claxedo_{version}_x64-setup.msi` - Windows MSI
- `claxedo_{version}_amd64.deb` - Debian/Ubuntu
- `claxedo_{version}.x86_64.rpm` - Fedora/RHEL
- `claxedo_{version}_amd64.AppImage` - Universal Linux
- Updater payloads (`*.app.tar.gz`, `*.AppImage.tar.gz`, `*.zip`) - used by `latest.json`
- `latest.json` - Auto-updater manifest

## Post-Release Verification

After the release is published:

1. **Download and test installers**
   - macOS: Download DMG, verify it opens and app runs
   - Windows: Download installer, verify installation works
   - Linux: Download AppImage, verify it runs

2. **Verify auto-updater**
   - Check `latest.json` is uploaded
   - Verify `latest.json` contains per-platform `signature` values (not empty)
   - Test update from previous version

3. **Update documentation**
   - Update any version references in docs
   - Announce release if significant

4. **Monitor for issues**
   - Watch GitHub Issues for bug reports
   - Check error tracking (if configured)

## Troubleshooting

### Build Fails on macOS

**Signing errors:**
```
Error: code signing failed: no identity found
```
- Ensure `APPLE_SIGNING_IDENTITY` matches certificate name exactly
- Check certificate is installed in Keychain
- Verify certificate is not expired

**Notarization errors:**
- Check `APPLE_ID` and `APPLE_PASSWORD` are correct
- Verify app-specific password is for correct Apple ID
- Check Apple Developer account is in good standing

### Build Fails on Windows

**Signing errors:**
```
Error: failed to sign application
```
- Verify `TAURI_SIGNING_PRIVATE_KEY` is correctly formatted
- Check password is correct

### Build Fails on Linux

**Missing dependencies:**
```
Error: cannot find -lwebkit2gtk-4.1
```
- Install required packages:
  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

### Workflow Fails

**Permission errors:**
```
Error: Resource not accessible by integration
```
- Ensure workflow has `contents: write` permission
- Check repository settings allow Actions to create releases

## Version Scheme

Claxedo follows [Semantic Versioning](https://semver.org/):

- **Major** (X.0.0): Breaking changes, major rewrites
- **Minor** (0.X.0): New features, backwards compatible
- **Patch** (0.0.X): Bug fixes, minor improvements

Release tags use the format: `claxedo-v{major}.{minor}.{patch}`

Examples:
- `claxedo-v1.0.0` - First stable release
- `claxedo-v1.1.0` - Feature release
- `claxedo-v1.1.1` - Bug fix release
