import { expect, test } from "bun:test"
import { formatShellCommand } from "../../src/util/format-command"

test("keeps short commands unchanged", () => {
  expect(formatShellCommand("")).toBe("")
  expect(formatShellCommand("git status")).toBe("git status")
})

test("leaves commands of exactly the default threshold length unchanged", () => {
  const command = "a".repeat(55) + " && b"
  expect(command.length).toBe(60)
  expect(formatShellCommand(command)).toBe(command)
})

test("splits short commands when an explicit threshold is given", () => {
  expect(formatShellCommand("a && b || c", 4)).toBe("a &&\n  b ||\n  c")
})

test("splits at top-level operators with two-space continuation", () => {
  expect(formatShellCommand("cat a.txt | grep x ; rm -rf /tmp/build ; echo done && git add -A")).toBe(
    "cat a.txt |\n  grep x ;\n  rm -rf /tmp/build ;\n  echo done &&\n  git add -A",
  )
})

test("does not split inside single-quoted strings", () => {
  expect(formatShellCommand("echo 'a ; b && c | d' && echo more text here to pad", 40)).toBe(
    "echo 'a ; b && c | d' &&\n  echo more text here to pad",
  )
})

test("does not split backtick command substitutions", () => {
  expect(formatShellCommand("echo `a ; b` && echo more text here for padding", 40)).toBe(
    "echo `a ; b` &&\n  echo more text here for padding",
  )
})

test("does not treat escaped quotes as closing double quotes", () => {
  expect(formatShellCommand(String.raw`echo "a \" ; b" && echo more text here for padding`, 40)).toBe(
    'echo "a \\" ; b" &&\n  echo more text here for padding',
  )
})

test("keeps heredoc bodies intact while splitting surrounding commands", () => {
  expect(formatShellCommand("cat > out.txt <<EOF\nline one\nline two\nEOF\necho finished", 40)).toBe(
    "cat > out.txt <<EOF\nline one\nline two\nEOF\necho finished",
  )
})

test("does not split operators inside arithmetic expansion", () => {
  expect(formatShellCommand("echo $(( 1 + 2 )) && echo $(( 3 * 4 )) && echo five", 40)).toBe(
    "echo $(( 1 + 2 )) &&\n  echo $(( 3 * 4 )) &&\n  echo five",
  )
})

test("does not split operators inside shell comments", () => {
  const command = "git add -A  # add everything; do not commit secrets || echo done"
  expect(command.length).toBeGreaterThan(40)
  expect(formatShellCommand(command, 40)).toBe(command)
})

test("keeps escaped characters together", () => {
  expect(formatShellCommand("echo a\\nb && cd dir && echo c", 20)).toBe("echo a\\nb &&\n  cd dir &&\n  echo c")
})

test("preserves existing newlines", () => {
  expect(formatShellCommand("echo a && echo b\necho c && echo d && echo e extra padding words", 20)).toBe(
    "echo a &&\n  echo b\necho c &&\n  echo d &&\n  echo e extra padding words",
  )
})
