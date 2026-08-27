import { expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

const pwsh = process.env.SHELL_SCAN_PWSH ?? Bun.which("pwsh")

const fixtures = [
  ...[
    "$result = Invoke-ProbeA; Invoke-ProbeB",
    "$result = (Invoke-ProbeA); Invoke-ProbeB",
    "[string]$result = Invoke-ProbeA; Invoke-ProbeB",
    "if (Invoke-ProbeA) { Invoke-ProbeB } else { Invoke-ProbeC }",
    "foreach ($item in (Invoke-ProbeA)) { Invoke-ProbeB }",
    "foreach ($item in Invoke-ProbeA) { Invoke-ProbeB }",
    "for ($i=0; $i -lt 2; $i++) { Invoke-ProbeB }",
    "while (Invoke-ProbeA) { Invoke-ProbeB; break }",
    "do { Invoke-ProbeB } until ($true)",
    "function Get-Probe { param($x); Invoke-ProbeB }; Invoke-ProbeA",
    "function Get-Probe($x = (Invoke-ProbeA)) { Invoke-ProbeB }",
    "try { Invoke-ProbeA } catch { Invoke-ProbeB } finally { Invoke-ProbeC }",
    "$x = @{ first = Invoke-ProbeA; second = @(Invoke-ProbeB; Invoke-ProbeC) }",
    "Invoke-ProbeA @(Invoke-ProbeB; Invoke-ProbeC)",
    'Invoke-ProbeA "$(Invoke-ProbeB "$(Invoke-ProbeC)")"',
    "Invoke-ProbeA <# <# ignored } #> #> literal; Invoke-ProbeB",
    '& "Inv`oke-ProbeA"; Invoke-ProbeB',
    'Invoke-ProbeBlock { & "Invoke-ProbeA" literal#value; Invoke-ProbeB }',
    'Invoke-ProbeBlock { . "Invoke-ProbeA" literal#value; Invoke-ProbeB }',
    "Invoke-ProbeBlock { ${probe}# ignored\nInvoke-ProbeB }",
    "Invoke-ProbeBlock { $result = Invoke-ProbeA literal#value; Invoke-ProbeB }",
    "Invoke-ProbeA $probe[$(Invoke-ProbeB)]",
    'Invoke-ProbeA "tab`tnewline`n`u{0041}"; Invoke-ProbeB',
    "Invoke-ProbeA |\n\n# comment\nForEach-Object { Invoke-ProbeB }",
  ],
  ...[
    "1",
    "+1",
    "-1",
    ".1",
    "0x1",
    "0b1",
    "1L",
    "1kb",
    "1.0",
    "1+1",
    "1..2",
    "-not 1",
    "-bnot 1",
    "!1",
    "!!1",
    ",1",
    "-join 1",
    "\u2013not 1",
    "\u2014not 1",
    "\u2015not 1",
    "\u2013join 1",
    "\u2014join 1",
    "\u2015join 1",
    "'x' -eq 1",
    '"x" -eq 1',
    "{} -eq 1",
  ].flatMap((expression) => [
    `${expression}#'\nInvoke-ProbeB\n#'`,
    `Invoke-ProbeBlock { ${expression}#} '\nInvoke-ProbeB\n} #'`,
  ]),
  ...[
    "$null",
    "$probe",
    "$HOME",
    "${probe}",
    "$env:PATH",
    "$true",
    "$false",
    "1",
    "1.0",
    "1kb",
    "0x1",
    "-1",
    "x2>&1",
    "x6>&1",
    ">$null",
    "> $null",
    "'x'>$null",
  ].flatMap((prefix) => [
    `Invoke-ProbeA ${prefix}#'\nInvoke-ProbeB\n#'`,
    `Invoke-ProbeBlock { Invoke-ProbeA ${prefix}#} '\nInvoke-ProbeB\n} #'`,
  ]),
  ...[" ", "\t", "\v", "\f", "\u0085", "\u00a0", "\u2000", "\u2028", "\u2029", "\ufeff"].flatMap((space) => [
    `Invoke-ProbeA \`${space}#'\nInvoke-ProbeB\n#'`,
    `Invoke-ProbeBlock { Invoke-ProbeA 2>&1\`${space}#} '\nInvoke-ProbeB\n} #'`,
  ]),
  ...Array.from({ length: 2048 }, (_, index) => {
    const tokens = [
      "x",
      " ",
      "\t",
      "\r",
      "\n",
      ";",
      "|",
      "'",
      '"',
      "''",
      '""',
      "#",
      "--%",
      "`",
      "{",
      "}",
      "2>&1",
      "Invoke-ProbeC",
    ]
    let seed = index + 1
    const body = Array.from({ length: 8 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return tokens[(seed >>> 16) % tokens.length]
    }).join("")
    return index % 2
      ? `Invoke-ProbeA ${body}\nInvoke-ProbeB\n# '`
      : `Invoke-ProbeBlock { Invoke-ProbeA ${body}\nInvoke-ProbeB\n} # '`
  }),
  ...["&", "."].flatMap((operator) =>
    ["'Invoke-ProbeA'", '"Invoke-ProbeA"'].flatMap((head) =>
      ["argument", "'argument'", '"argument"', "#ignored", "--% '"].map(
        (tail) => `${operator} ${head}${tail}\nInvoke-ProbeB\n# '`,
      ),
    ),
  ),
  ...["'", '"', "\u2018", "\u2019", "\u201c", "\u201d"].flatMap((open) =>
    ["'", '"', "\u2018", "\u2019", "\u201c", "\u201d"].flatMap((close) =>
      ["", "literal", "`", "'", '"', "''", '""', "{", "}", "#", "--%", "$(Invoke-ProbeB)"].flatMap((content) => [
        `Invoke-ProbeA ${open}${content}${close}; Invoke-ProbeB; Invoke-ProbeC '${content}'`,
        `Invoke-ProbeBlock { Invoke-ProbeA ${open}${content}${close}; Invoke-ProbeB }; Invoke-ProbeC '${content}'`,
      ]),
    ),
  ),
  ...["", "literal", "'quoted'", '"quoted"', "{}"].flatMap((prefix) =>
    ["#ignored", "<#ignored#>", "--% 'ignored", '--% "ignored'].flatMap((tail) =>
      [";", "|", "\r", "\n", "\r\n"].map(
        (separator) => `Invoke-ProbeA ${prefix}${tail}${separator}Invoke-ProbeB${separator}Invoke-ProbeC`,
      ),
    ),
  ),
  ...["''", "'x'", '"x"', "{}", "2>&1", "6>&1", "*>&1", "plain", "plain'quoted'"].flatMap((prefix) =>
    ["#", "--%", "--% ", "<# #>#"].flatMap((suffix) =>
      ["\r", "\n", "\r\n"].flatMap((newline) => [
        `Invoke-ProbeA ${prefix}${suffix}'${newline}Invoke-ProbeB${newline}# '`,
        `Invoke-ProbeA ${prefix}${suffix}\"${newline}Invoke-ProbeB${newline}# \"`,
        `Invoke-ProbeBlock { Invoke-ProbeA ${prefix}${suffix}} '${newline}Invoke-ProbeB${newline}} # '`,
      ]),
    ),
  ),
  ...[
    ...Array.from({ length: 33 }, (_, index) => String.fromCharCode(index)),
    "\u0085",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
    "\ufeff",
  ].flatMap((space) => [
    `Invoke-ProbeA${space}argument; Invoke-ProbeB`,
    `Invoke-ProbeA # ignored${space}Invoke-ProbeB`,
    `Invoke-ProbeA${space}Invoke-ProbeB`,
    `&${space}'Invoke-ProbeA'; Invoke-ProbeB`,
  ]),
  ...["Invoke-ProbeA", "& Invoke-ProbeA", "& 'Invoke-ProbeA'", '. "Invoke-ProbeA"'].flatMap((head) =>
    [
      "plain",
      "'single ; | & # { }'",
      '"double ; | & # { }"',
      "'single''quote'",
      '"double""quote"',
      "'`'",
      '"a`"}b"',
      '"it\'s } literal"',
      "left`#right",
      "left`;right",
      "left`|right",
      "left`&right",
      '"$(Invoke-ProbeB)"',
      '"$probe"',
      '"${probe}"',
      "\u2018smart single\u2019",
      "\u201csmart double\u201d",
    ].flatMap((argument) =>
      ["; ", "\n", "\r", "\r\n", " | ", " && ", " || "].map(
        (separator) => `${head} ${argument}${separator}Invoke-ProbeC`,
      ),
    ),
  ),
  ...["\n", "\r", "\r\n"].flatMap((newline) => [
    `Invoke-ProbeA # '\" } ; ignored${newline}Invoke-ProbeB`,
    `Invoke-ProbeBlock { # } ignored${newline}Invoke-ProbeB }`,
    `Invoke-ProbeBlock { Invoke-ProbeA # } ignored${newline}Invoke-ProbeB }`,
    `Invoke-ProbeA --% \"ignored${newline}Invoke-ProbeB${newline}\"`,
    `Invoke-ProbeBlock { Invoke-ProbeA --% \"ignored${newline}Invoke-ProbeB${newline}\" }`,
    `Invoke-ProbeA \`${newline}argument; Invoke-ProbeB`,
    `Invoke-ProbeA @'${newline}literal ; }${newline}'@; Invoke-ProbeB`,
    `Invoke-ProbeA @\"${newline}$(Invoke-ProbeB)${newline}\"@; Invoke-ProbeC`,
  ]),
  ...["&", ".", "Invoke-ProbeBlock", "Invoke-ProbeA | ForEach-Object"].flatMap((head) =>
    [
      "Invoke-ProbeB; Invoke-ProbeC",
      "Invoke-ProbeB '`'; Invoke-ProbeC",
      'Invoke-ProbeB "it\'s } literal"; Invoke-ProbeC',
      'Invoke-ProbeB "a`\"}b"; Invoke-ProbeC',
      'Invoke-ProbeB "a\"\"}b"; Invoke-ProbeC',
      "Invoke-ProbeBlock { Invoke-ProbeB }; Invoke-ProbeC",
      "<# <# } #> #> Invoke-ProbeB",
      'Invoke-ProbeB "$(Invoke-ProbeC)"',
      'Invoke-ProbeB "$(Invoke-ProbeA \"}\"); Invoke-ProbeC"',
    ].map((body) => `${head} { ${body} }; Invoke-ProbeA`),
  ),
  ...["> $null", ">> $null", "2>&1", "3>&1", "4>&1", "5>&1", "6>&1", "*>&1", "*> $null"].flatMap((redirect) => [
    `Invoke-ProbeA ${redirect}; Invoke-ProbeB`,
    `Invoke-ProbeBlock { Invoke-ProbeA ${redirect}; Invoke-ProbeB }`,
  ]),
  "Invoke-ProbeA --% 'ignored|Invoke-ProbeB|Invoke-ProbeC '",
  "Invoke-ProbeA --% ; Invoke-ProbeB",
  "Invoke-ProbeA --% $(Invoke-ProbeB)",
  "Invoke-ProbeA \u2018a'; Invoke-ProbeB; Invoke-ProbeC 'b\u2019",
  'Invoke-ProbeA \u201ca"; Invoke-ProbeB; Invoke-ProbeC "b\u201d',
  'Invoke-ProbeA "$(Invoke-ProbeB \"quoted\")"; Invoke-ProbeC',
  "& $probe; Invoke-ProbeC",
  "& ('Invoke-' + 'ProbeB'); Invoke-ProbeC",
  "& { Invoke-ProbeB }; Invoke-ProbeC",
  "$(Invoke-ProbeB); Invoke-ProbeC",
  "@(Invoke-ProbeB); Invoke-ProbeC",
  "Invoke-ProbeA <# ignored #>; Invoke-ProbeB",
  "Invoke-ProbeA#literal; Invoke-ProbeB",
  "Invoke-ProbeA ''#literal; Invoke-ProbeB",
  'Invoke-ProbeA ""#literal; Invoke-ProbeB',
  "Invoke-ProbeA { Invoke-ProbeB }#literal; Invoke-ProbeC",
  "Inv'oke'-ProbeA; Invoke-ProbeB",
  'Inv"oke"-ProbeA; Invoke-ProbeB',
  "Invoke-ProbeA,Invoke-ProbeB; Invoke-ProbeC",
  'Invoke-ProbeA --%"literal|Invoke-ProbeB|Invoke-ProbeC"',
  'Invoke-ProbeA x--% "literal|Invoke-ProbeB|Invoke-ProbeC"',
  "Invoke-ProbeA '--%' \"literal|Invoke-ProbeB|Invoke-ProbeC\"",
  'Invoke-ProbeA "--%" "literal|Invoke-ProbeB|Invoke-ProbeC"',
  'Invoke-ProbeA --`% "literal|Invoke-ProbeB|Invoke-ProbeC"',
  'Invoke-ProbeA `-`-`% "literal|Invoke-ProbeB|Invoke-ProbeC"',
  "Invoke-ProbeA ''--% \"literal|Invoke-ProbeB|Invoke-ProbeC\"",
  "Invoke-ProbeA 2>&1; &{Invoke-ProbeB}; Invoke-ProbeC",
  "Invoke-ProbeA 2>&1|Invoke-ProbeB",
  "Invoke-ProbeA 'x'#'\nInvoke-ProbeB\nInvoke-ProbeC ''#'",
  'Invoke-ProbeA "x"#"\nInvoke-ProbeB\nInvoke-ProbeC ""#"',
  "Invoke-ProbeA {}#'\nInvoke-ProbeB\nInvoke-ProbeC ''#'",
  "Invoke-ProbeBlock { Invoke-ProbeA 'x'#'\nInvoke-ProbeB\nInvoke-ProbeC ''#' }",
  "Invoke-ProbeA 'x'# ' \nInvoke-ProbeB\n# '",
  "Invoke-ProbeA { Invoke-ProbeB }# ' \nInvoke-ProbeC\n# '",
  "Invoke-ProbeA { Invoke-ProbeB 2>&1# } ' \nInvoke-ProbeC\n} # '",
  "Invoke-ProbeBlock { Invoke-ProbeB 2>&1# } ' \nInvoke-ProbeC\n} # '",
  "& { Invoke-ProbeB 2>&1# } ' \nInvoke-ProbeC\n} # '",
  "Invoke-ProbeA & Invoke-ProbeB",
  "Invoke-ProbeA 'safe`'; Invoke-ProbeB; '`'",
]

// Runtime execution is restricted to probes and $null/stream redirections; other cases are parser-only.
const oracle = String.raw`
$ErrorActionPreference = 'Stop'
$probe = 'Invoke-ProbeB'
$script:seen = [System.Collections.Generic.List[string]]::new()
function Invoke-ProbeA { [void]$script:seen.Add('Invoke-ProbeA'); 1 }
function Invoke-ProbeB { [void]$script:seen.Add('Invoke-ProbeB'); 1 }
function Invoke-ProbeC { [void]$script:seen.Add('Invoke-ProbeC'); 1 }
function Invoke-ProbeBlock {
  [void]$script:seen.Add('Invoke-ProbeBlock')
  foreach ($argument in $args) {
    if ($argument -is [scriptblock]) { & $argument }
  }
}
$results = foreach ($source in (ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()))) {
  $tokens = $null
  $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
  $nodes = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))
  $commands = @($nodes | ForEach-Object {
    @{
      name = $_.GetCommandName()
      text = $_.Extent.Text
      start = $_.Extent.StartOffset
      end = $_.Extent.EndOffset
    }
  })
  $script:seen.Clear()
  $runtimeError = $null
  $unsafe = @($nodes | Where-Object {
    $name = $_.GetCommandName()
    ($name -and $name -notin @('Invoke-ProbeA', 'Invoke-ProbeB', 'Invoke-ProbeC', 'Invoke-ProbeBlock', 'ForEach-Object')) -or
    (!$name -and $_.CommandElements[0] -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst])
  })
  $files = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FileRedirectionAst] -and $node.Location.Extent.Text -ne '$null'
  }, $true))
  $background = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.PipelineAst] -and $node.Background
  }, $true))
  if ($errors.Count -eq 0 -and $unsafe.Count -eq 0 -and $files.Count -eq 0 -and $background.Count -eq 0) {
    try { & ([scriptblock]::Create($source)) | Out-Null }
    catch { $runtimeError = $_.Exception.Message }
  }
  @{
    source = $source
    commands = $commands
    errors = @($errors | ForEach-Object { $_.ErrorId })
    executed = @($script:seen.ToArray())
    runtimeError = $runtimeError
  }
}
ConvertTo-Json -InputObject @($results) -Depth 10 -Compress
`

// Run with SHELL_SCAN_PWSH=/path/to/pwsh bun run test test/shell-scan/powershell-runtime.test.ts.
test.skipIf(!pwsh)(
  "successful PowerShell scans cover real parser boundaries and executed probe calls",
  async () => {
    const process = Bun.spawn([pwsh!, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", oracle], {
      stdin: new Blob([JSON.stringify(fixtures)]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 45_000,
    })
    const [output, error, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect({ code, error }).toEqual({ code: 0, error: "" })
    const results: Array<{
      source: string
      commands: Array<{ name: string | null; text: string; start: number; end: number }>
      errors: string[]
      executed: string[]
      runtimeError: string | null
    }> = JSON.parse(output)
    expect(results).toHaveLength(fixtures.length)
    const failures: string[] = []
    let scanned = 0
    let executed = 0
    for (const result of results) {
      const scan = ShellScan.scanPowerShell(result.source)
      if (scan.kind === "opaque" || result.errors.length > 0) continue
      scanned++
      executed += result.executed.length
      const missing = result.commands.filter(
        (command) =>
          command.name !== null &&
          !scan.commands.some(
            (candidate) =>
              candidate.words[0]?.toLowerCase() === command.name?.toLowerCase() &&
              candidate.resource === command.text.trim(),
          ),
      )
      const unobserved = result.executed.filter(
        (name) => !scan.commands.some((command) => command.words[0]?.toLowerCase() === name.toLowerCase()),
      )
      if (missing.length || unobserved.length)
        failures.push(
          JSON.stringify({
            source: result.source,
            missing: missing.map((command) => command.text),
            unobserved,
            scanned: scan.commands.map((command) => command.words[0]),
          }),
        )
    }
    expect(scanned).toBeGreaterThan(100)
    expect(executed).toBeGreaterThan(100)
    expect(failures).toEqual([])
  },
  60_000,
)
