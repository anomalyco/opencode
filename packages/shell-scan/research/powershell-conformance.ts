import { ShellScan } from "../src/index.js"

const pwsh = process.env.PWSH ?? Bun.which("pwsh")
if (!pwsh) {
  console.error("Set PWSH to a PowerShell executable")
  process.exit(2)
}
const versionProcess = Bun.spawnSync(
  [pwsh, "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"],
  { stdout: "pipe", stderr: "pipe" },
)
const oracleMajor = Number(versionProcess.stdout.toString().trim())
if (versionProcess.exitCode !== 0 || !Number.isInteger(oracleMajor) || oracleMajor < 5)
  throw new Error(`PowerShell 5 or newer required: ${versionProcess.stderr.toString().trim()}`)

const commands = ["Get-ChildItem", "Write-Output", "Remove-Item", "Test-Path"] as const
const arguments_ = ["", " value", " 'single ; | # text'", ' "double ; | # text"', " foo`;bar"] as const
const separators = [";", "|", ...(oracleMajor >= 7 ? ["&&", "||"] : []), "\n", "\r", "\r\n"] as const
const sources = new Set<string>()

for (const command of commands) {
  for (const argument of arguments_) sources.add(command + argument)
}
for (const left of commands) {
  for (const separator of separators) {
    for (const right of commands) sources.add(`${left} left${separator}${right} right`)
  }
}
for (const command of commands) {
  sources.add(`# comment\n${command}`)
  sources.add(`# comment\r${command}`)
  sources.add(`# comment\r\n${command}`)
  sources.add(`${command} before # ignored\nWrite-Output after`)
  sources.add(`${command} before # ignored\rWrite-Output after`)
  sources.add(`${command} before # ignored\r\nWrite-Output after`)
  sources.add(`${command} one > output.txt`)
  sources.add(`${command} one 2>&1`)
  sources.add(`${command} one\n\nWrite-Output two`)
}

const unsupported = [
  "$Command value",
  "& $Command value",
  'Write-Output "$(Get-ChildItem)"',
  "return Remove-Item victim",
  "throw Get-ChildItem",
  "[string]$x = Remove-Item victim",
  "Invoke-`\nExpression 'Remove-Item victim'",
  "<# comment #> Remove-Item victim",
  "#Requires -Modules Evil\nWrite-Output ok",
] as const
for (const source of unsupported) sources.add(source)
const malformed = ['Write-Output "unterminated', "Get-ChildItem |", "Write-Output ok`", "Get-ChildItem &&"] as const
for (const source of malformed) sources.add(source)

let randomState = 0x50a7e11
const random = (length: number) => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
  return randomState % length
}
for (let iteration = 0; iteration < 2_500; iteration++) {
  const left = commands[random(commands.length)]
  const right = commands[random(commands.length)]
  const separator = separators[random(separators.length)]
  const argument = arguments_[random(arguments_.length)]
  const forms = [
    `${left} fuzz${iteration}${separator}${right}${argument}`,
    `${left.toLowerCase()} fuzz${iteration}${separator}${right.toUpperCase()}${argument}`,
    `${left} fuzz${iteration} > output${iteration}; ${right}${argument}`,
    `${left} fuzz${iteration} # ignored\n${right}${argument}`,
    `${left} fuzz${iteration} # ignored\r${right}${argument}`,
    `${left} fuzz${iteration} # ignored\r\n${right}${argument}`,
    `${left}\`\n fuzz${iteration}; ${right}${argument}`,
    `Microsoft.PowerShell.Management\\${left} fuzz${iteration}; ${right}${argument}`,
  ]
  sources.add(forms[random(forms.length)])
}

const process_ = Bun.spawnSync([pwsh, "-NoProfile", "-NonInteractive", "-File", "research/powershell-oracle.ps1"], {
  cwd: import.meta.dir + "/..",
  stdin: new TextEncoder().encode(JSON.stringify([...sources])),
  stdout: "pipe",
  stderr: "pipe",
})
if (process_.exitCode !== 0) {
  console.error(process_.stderr.toString())
  process.exit(process_.exitCode)
}

const oracle = JSON.parse(process_.stdout.toString()) as {
  version: string
  results: Array<{
    source: string
    commands: Array<{ name: string | null; text: string; start: number; end: number }>
    errors: string[]
  }>
}
const version = Number(oracle.version.split(".")[0])
if (version !== oracleMajor)
  throw new Error(`PowerShell version changed during oracle run: ${oracleMajor} to ${oracle.version}`)
const returned = new Set(oracle.results.map((result) => result.source))
if (
  oracle.results.length !== sources.size ||
  returned.size !== sources.size ||
  [...sources].some((source) => !returned.has(source))
)
  throw new Error(`PowerShell oracle returned ${oracle.results.length} results for ${sources.size} unique sources`)
const evaluated = oracle.results.map((item) => ({ item, scanned: ShellScan.scanPowerShell(item.source) }))
const findings = evaluated.flatMap(({ item, scanned }) => {
  if (unsupported.includes(item.source as (typeof unsupported)[number]) && scanned.kind !== "opaque")
    return [{ source: item.source, reason: "unsupported-scanned", expected: [], actual: [], missing: [] }]
  if (item.errors.length > 0)
    return scanned.kind === "opaque"
      ? []
      : [{ source: item.source, reason: "malformed-scanned", expected: [], actual: [], missing: item.errors }]
  if (scanned.kind === "opaque") return []
  if (item.commands.some((command) => command.name === null))
    return [{ source: item.source, reason: "dynamic-head-scanned", expected: [], actual: [], missing: [] }]
  const expected = item.commands.map((command) => normalize(command.name ?? ""))
  const actual = scanned.commands.map((command) => normalize(command.words[0] ?? ""))
  let index = 0
  const missing = expected.filter((name) => {
    while (index < actual.length && actual[index] !== name) index++
    if (index >= actual.length) return true
    index++
    return false
  })
  const invalidExtent = item.commands.find((command) => item.source.slice(command.start, command.end) !== command.text)
  if (invalidExtent)
    return [{ source: item.source, reason: "invalid-extent", expected, actual, missing: [invalidExtent.text] }]
  return missing.length > 0 ? [{ source: item.source, reason: "missing-command", expected, actual, missing }] : []
})
const scannedCount = evaluated.filter(({ scanned }) => scanned.kind === "scanned").length
if (scannedCount < 1_900) throw new Error(`PowerShell scanned coverage fell below floor: ${scannedCount}`)

console.log(
  JSON.stringify(
    {
      schema: 1,
      powershell: oracle.version,
      generated: sources.size,
      parsed: oracle.results.filter((result) => result.errors.length === 0).length,
      scanned: scannedCount,
      violations: findings.length,
      findings,
    },
    null,
    2,
  ),
)
if (findings.length > 0) process.exitCode = 1

function normalize(name: string) {
  return name.replace(/`?[\r\n]+/g, "").toLowerCase()
}
