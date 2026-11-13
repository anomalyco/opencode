import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test.each(["tmp", "C:/Windows Temp"])("installer extracts an archive under TMPDIR=%s", async (directory) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-install-"))
  try {
    const temporary = process.platform === "win32" ? path.join(root, path.basename(directory)) : directory
    await mkdir(path.join(root, "package", "bin"), { recursive: true })
    await mkdir(path.resolve(root, temporary), { recursive: true })
    await Promise.all(
      ["opencode", "opencode.exe"].map((name) =>
        Bun.write(path.join(root, "package", "bin", name), "fixture binary\n"),
      ),
    )
    const archive = path.join(root, "fixture.tgz")
    const pack = Bun.spawn(["tar", "-czf", "-", "-C", root, "package"], {
      stdout: Bun.file(archive),
      stderr: "pipe",
    })
    const [packError, packCode] = await Promise.all([new Response(pack.stderr).text(), pack.exited])
    expect(packCode, packError).toBe(0)

    // Windows checkouts may use CRLF, unlike the installer served over HTTP.
    const installer = path.join(root, "install")
    await Bun.write(
      installer,
      (await Bun.file(path.resolve(import.meta.dir, "../../../install")).text()).replaceAll("\r\n", "\n"),
    )
    const child = Bun.spawn(
      [
        process.platform === "win32" ? "sh" : "bash",
        "-c",
        // Replace only the network boundary; run the real installer and archive tools.
        // Assign after MSYS startup so it cannot normalize away the native Windows path.
        `export TMPDIR="$FIXTURE_TMPDIR"
        curl() {
          local output=""
          while [ "$#" -gt 0 ]; do
            case "$1" in
              -o|--output) output="$2"; shift 2 ;;
              -w|--write-out) printf 200; return ;;
              *) shift ;;
            esac
          done
          cp "$FIXTURE_ARCHIVE" "$output"
        }
        source "$1" --version 2.3.4 --no-modify-path`,
        "install-test",
        installer,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          HOME: root,
          TMPDIR: undefined,
          FIXTURE_TMPDIR: temporary,
          FIXTURE_ARCHIVE: archive,
          SHELL: "bash",
          BASH_ENV: undefined,
          ENV: undefined,
          GITHUB_ACTIONS: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, stderr + stdout).toBe(0)
    expect(
      await Bun.file(
        path.join(root, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode"),
      ).text(),
    ).toBe("fixture binary\n")
    expect(await readdir(path.resolve(root, temporary))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
