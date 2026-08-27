const results = await Promise.all(
  Array.from({ length: 6 }, async (_, index) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "test",
        "test/session-revert.test.ts",
        "--rerun-each",
        "5",
        "--timeout",
        process.argv[2],
      ],
      { cwd: "packages/core", stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    console.info("[DEBUG-revert] process", index, "exit", exit)
    console.info(
      (stdout + stderr)
        .split("\n")
        .filter((line) => /DEBUG-revert|timed out|\(fail\)| pass| fail|Ran /.test(line))
        .join("\n"),
    )
    return exit
  }),
)

if (results.some((exit) => exit !== 0)) process.exit(1)
