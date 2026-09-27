import { describe, expect, test } from "bun:test"
import { inlineCodeKind } from "./markdown-inline-code-kind"

describe("inlineCodeKind", () => {
  test("leaves code expressions as normal inline code", () => {
    expect(
      inlineCodeKind(
        `case "question.asked": ... input.setStore("question", question.sessionID, [question]) / splice/insert`,
      ),
    ).toBeUndefined()
    expect(inlineCodeKind(`<SessionQuestionDock request={request} ... />`)).toBeUndefined()
    expect(inlineCodeKind(`from sync.data.question + sync.data.session.`)).toBeUndefined()
    expect(inlineCodeKind(`@opencode-ai/app <StatusPopover />)`)).toBeUndefined()
    expect(inlineCodeKind(`sync.data.session`)).toBeUndefined()
    expect(inlineCodeKind(`window.api`)).toBeUndefined()
    expect(inlineCodeKind(`1.2`)).toBeUndefined()
  })

  test("leaves prose shorthand with slashes as normal inline code", () => {
    expect(inlineCodeKind(`write/edit`)).toBeUndefined()
    expect(inlineCodeKind(`Style/tool`)).toBeUndefined()
    expect(inlineCodeKind(`session/status`)).toBeUndefined()
    expect(inlineCodeKind(`and/or`)).toBeUndefined()
    expect(inlineCodeKind(`input/output`)).toBeUndefined()
    expect(inlineCodeKind(`read/write`)).toBeUndefined()
    expect(inlineCodeKind(`client/server`)).toBeUndefined()
    expect(inlineCodeKind(`src/components`)).toBeUndefined()
  })

  test("detects file and directory paths", () => {
    expect(inlineCodeKind(`app.tsx`)).toBe("path")
    expect(inlineCodeKind(`vite.config.mjs`)).toBe("path")
    expect(inlineCodeKind(`eslint.config.cjs`)).toBe("path")
    expect(inlineCodeKind(`app.d.ts`)).toBe("path")
    expect(inlineCodeKind(`component.svelte`)).toBe("path")
    expect(inlineCodeKind(`schema.graphql`)).toBe("path")
    expect(inlineCodeKind(`Dockerfile`)).toBe("path")
    expect(inlineCodeKind(`Dockerfile.dev`)).toBe("path")
    expect(inlineCodeKind(`.gitignore`)).toBe("path")
    expect(inlineCodeKind(`Cargo.lock`)).toBe("path")
    expect(inlineCodeKind(`go.sum`)).toBe("path")
    expect(inlineCodeKind(`bun.lockb`)).toBe("path")
    expect(inlineCodeKind(`terraform.tfvars`)).toBe("path")
    expect(inlineCodeKind(`pnpm-lock.yaml`)).toBe("path")
    expect(inlineCodeKind(`packages/desktop-electron`)).toBe("path")
    expect(inlineCodeKind(`~/.config/opencode`)).toBe("path")
    expect(inlineCodeKind(`packages/app/src`)).toBe("path")
    expect(inlineCodeKind(`./scripts/setup`)).toBe("path")
    expect(inlineCodeKind(`../shared/utils`)).toBe("path")
    expect(inlineCodeKind(`dist/`)).toBe("path")
    expect(inlineCodeKind(`/usr/local/bin`)).toBe("path")
    expect(inlineCodeKind(`C:\\Users\\opencode`)).toBe("path")
    expect(inlineCodeKind(`@opencode-ai/app`)).toBe("path")
    expect(inlineCodeKind(`@scope/pkg`)).toBe("path")
  })

  test("detects urls", () => {
    expect(inlineCodeKind(`https://opencode.ai/docs`)).toBe("url")
    expect(inlineCodeKind(`http://localhost:4444`)).toBe("url")
    expect(inlineCodeKind(`file:///tmp/opencode`)).toBeUndefined()
    expect(inlineCodeKind(`ftp://opencode.ai/docs`)).toBeUndefined()
  })
})
