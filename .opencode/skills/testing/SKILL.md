---
name: testing
description: Run and analyze bun test, Playwright e2e, and HttpApi exerciser tests
---

# Testing

## Bun Test
```bash
cd packages/opencode && bun test --timeout 30000
```
- 从包目录运行（不可从根目录）
- 不 mock 业务逻辑
- JUnit 输出: `.artifacts/unit/junit.xml`

## Playwright E2E
```bash
cd packages/app && bun run test:e2e:local
```
- Chromium, 30min timeout

## HttpApi Exerciser
```bash
cd packages/opencode && bun run test:httpapi
```
- 三种模式: coverage / auth / effect

## Effect 测试
- `testEffect(...)` from `packages/octopus/test/lib/effect.ts`
- `it.live(...)` for filesystem/git/HTTP/socket tests

## 冒烟测试
- CLI: `./dist/octopus --version`
- SDK: `import @octopus-ai/sdk`
