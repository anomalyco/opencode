import { describe, expect, test } from "bun:test"
import { detectFiletype } from "../../src/util/filetype"

describe("detectFiletype", () => {
  const cases: [string, string | undefined][] = [
    ["db/schema.sql", "sql"],
    ["Dockerfile", "dockerfile"],
    ["docker/Dockerfile.prod", "dockerfile"],
    ["api.dockerfile", "dockerfile"],
    ["Containerfile", "dockerfile"],
    ["setup.cfg", "ini"],
    ["/etc/nginx/nginx.conf", "ini"],
    ["~/.config/systemd/user/beszel.service", "ini"],
    ["backup.timer", "ini"],
    ["app.container", "ini"],
    ["work.slice", "ini"],
    ["home.mount", "ini"],
    ["swapfile.swap", "ini"],
    ["dev-sda.device", "ini"],
    ["app.socket", "ini"],
    ["sync.path", "ini"],
    ["eth0.network", "ini"],
    ["br0.netdev", "ini"],
    ["10-eth.link", "ini"],
    ["base.image", "ini"],
    ["app.build", "ini"],
    ["data.volume", "ini"],
    ["web.pod", "ini"],
    ["app.kube", "ini"],
    ["/etc/systemd/system/ssh.service.d/override.conf", "ini"],
    ["firefox.desktop", "ini"],
    [".gitconfig", "ini"],
    [".env", "bash"],
    [".env.local", "bash"],
    ["config/prod.env", "bash"],
    [".envrc", "bash"],
    ["scripts/deploy.sh", "bash"],
    [".zshrc", "bash"],
    ["PKGBUILD", "bash"],
    ["Makefile", "make"],
    ["rules.mk", "make"],
    ["main.tf", "hcl"],
    ["Gemfile", "ruby"],
    ["Rakefile", "ruby"],
    ["app/views/home/index.html.erb", "erb"],
    ["app/views/home/index.haml", "haml"],
    ["Cargo.toml", "toml"],
    ["src/x.h", "c"],
    ["tsconfig.jsonc", "json"],
    ["docs/page.mdx", "markdown"],
    ["Info.plist", "xml"],
    ["src/app.tsx", "typescript"],
    ["main.py", "python"],
    ["README.unknown", undefined],
    ["bin/tool", undefined],
  ]
  for (const [file, expected] of cases) {
    test(`${file} -> ${expected}`, () => {
      expect(detectFiletype(file)).toBe(expected)
    })
  }

  test("reads a #! line on a file with no known language", () => {
    expect(detectFiletype("bin/tool", "#!/usr/bin/env python3\nprint(1)")).toBe("python")
    expect(detectFiletype("bin/tool", "#!/usr/bin/python3.12\n")).toBe("python")
    expect(detectFiletype("bin/run", "#!/bin/bash\nset -e")).toBe("bash")
    expect(detectFiletype("bin/run", "#!/usr/bin/env -S bun --silent\n")).toBe("typescript")
    expect(detectFiletype("bin/run", "#!/usr/bin/env ruby\n")).toBe("ruby")
    expect(detectFiletype("bin/run", "#!/opt/weird\n")).toBeUndefined()
    expect(detectFiletype("bin/run", "echo no shebang")).toBeUndefined()
  })

  test("reads a #! line from a diff whose first hunk starts at line 1", () => {
    const added = "Index: bin/tool\n--- bin/tool\n+++ bin/tool\n@@ -0,0 +1,2 @@\n+#!/usr/bin/env python3\n+print(1)\n"
    expect(detectFiletype("bin/tool", added)).toBe("python")
    const edited = "--- a\n+++ b\n@@ -1,3 +1,3 @@\n #!/bin/sh\n-echo a\n+echo b\n"
    expect(detectFiletype("bin/tool", edited)).toBe("bash")
    const later = "--- a\n+++ b\n@@ -10,3 +10,3 @@\n #!/bin/sh\n"
    expect(detectFiletype("bin/tool", later)).toBeUndefined()
  })

  test("prefers the file name over a #! line", () => {
    expect(detectFiletype("deploy.sh", "#!/usr/bin/env python3\n")).toBe("bash")
  })

  test("uses none for missing filenames", () => {
    expect(detectFiletype()).toBe("none")
    expect(detectFiletype("")).toBe("none")
  })
})
