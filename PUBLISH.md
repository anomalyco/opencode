# Publishing SecureCode to NPM

Follow these specific commands to compile the standalone binary and sequentially push the `@kyuz0/securecode` distributions to NPM.

```bash
# 1. Verify the exact code behavior and compatibility by running tests within the package
cd packages/opencode && bun run test
cd ../..

# 2. Compile the cross-platform binaries
bun run packages/opencode/script/build.ts

# 3. Publish sequentially to NPM (Follow browser prompts for Passkey/2FA)
bun run packages/opencode/script/publish.ts
```
