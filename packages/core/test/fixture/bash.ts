const executable = Bun.which("bash")

// Match the selected shell's version, not the host OS: newer Bash must keep these tests enabled.
export const bash32 =
  !!executable &&
  Bun.spawnSync(
    [executable, "--noprofile", "--norc", "-c", 'printf "%s.%s" "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"'],
    { env: { BASH_ENV: "/dev/null" }, timeout: 2_000 },
  ).stdout.toString() === "3.2"
