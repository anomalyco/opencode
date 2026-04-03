import { expect, test } from "bun:test"
import path from "path"
import { Process } from "../../src/util/process"

const root = path.join(import.meta.dir, "../..")

function flags(env?: NodeJS.ProcessEnv) {
  return Process.text(
    [
      process.execPath,
      "-e",
      `import { Flag } from "./src/flag/flag"
console.log(JSON.stringify({
  claude: Flag.OPENCODE_DISABLE_CLAUDE_CODE,
  claude_skills: Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS,
  external: Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS,
}))`,
    ],
    {
      cwd: root,
      env,
    },
  ).then((out) => JSON.parse(out.text) as { claude: boolean; claude_skills: boolean; external: boolean })
}

test("claude disable does not disable agent skills", async () => {
  const out = await flags({
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
  })

  expect(out).toEqual({
    claude: true,
    claude_skills: true,
    external: false,
  })
})

test("external skills can still be disabled explicitly", async () => {
  const out = await flags({
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  })

  expect(out.external).toBe(true)
})
