# Rules.ps1 - headless tests for src/Coach.Rules.ps1.
#
# No daemon, no window, no clipboard, no desktop: the rules are pure string
# matching, so every branch is asserted directly. This is the test that runs
# anywhere PowerShell runs, including a CI box with no interactive session.
#
# Exits non-zero if any check fails.

$ErrorActionPreference = 'Stop'

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'src\Coach.Rules.ps1')

$checks = 0
$fails = 0

function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  $script:checks++
  if ($Ok) {
    Write-Output ('[PASS] ' + $Name)
  } else {
    $script:fails++
    if ($Detail) { Write-Output ('[FAIL] ' + $Name + ' :: ' + $Detail) }
    else { Write-Output ('[FAIL] ' + $Name) }
  }
}

function Kind([string]$Text) { (Get-CoachDecision $Text).kind }

# --- destructive -----------------------------------------------------------

Check 'delete logs -> destructive' ((Kind 'delete all the logs from last week') -eq 'destructive')
Check 'remove cache -> destructive' ((Kind 'remove the old cache') -eq 'destructive')
Check 'clear build output -> destructive' ((Kind 'clear the build output') -eq 'destructive')
Check 'delete users table -> destructive' ((Kind 'delete the users table') -eq 'destructive')
Check 'drop table -> destructive' ((Kind 'drop table users') -eq 'destructive')
Check 'rm -rf -> destructive' ((Kind 'rm -rf node_modules') -eq 'destructive')
Check 'guarded delete -> silent' ((Kind 'delete the old logs after committing the current state first') -eq 'none')
Check 'dry run -> silent' ((Kind 'delete the cache, dry run only') -eq 'none')
Check 'one file -> silent' ((Kind 'reset this file only') -eq 'none')
Check 'delete a named file -> silent' ((Kind 'delete src/app.ts') -eq 'none')
Check 'delete all .ts files -> destructive' ((Kind 'delete all the .ts files in src') -eq 'destructive')

# --- silence ---------------------------------------------------------------

Check 'plain question -> silent' ((Kind 'summarize the current state of the parser') -eq 'none')
Check 'login bug fix -> silent' ((Kind 'fix the login flow so the second attempt works') -eq 'none')
Check 'unrelated endpoint -> silent' ((Kind 'create an API endpoint that returns the current time') -eq 'none')
Check 'empty -> silent' ((Kind '') -eq 'none')

# A login word plus a UI word is not credential handling. These came from the
# review on #59596; each one used to produce a rate-limit card.
Check 'login page styling -> silent' ((Kind 'make the login page look nicer on mobile') -eq 'none') (Kind 'make the login page look nicer on mobile')
Check 'login screen dark mode -> silent' ((Kind 'add a dark mode toggle to the login screen') -eq 'none') (Kind 'add a dark mode toggle to the login screen')
Check 'login form tests -> silent' ((Kind 'write unit tests for the login form') -eq 'none') (Kind 'write unit tests for the login form')

# --- security: the example from the design issue ---------------------------

$example = 'Add a login endpoint that checks the user''s password against the database'
$d = Get-CoachDecision $example
$ids = @($d.findings | ForEach-Object { $_.id })
Check 'password example -> security card' ($d.kind -eq 'security')
Check 'password example names two findings' (@($d.findings).Count -eq 2) (@($d.findings).Count.ToString() + ' findings')
Check 'password example finds plaintext compare' ($ids -contains 'password')
Check 'password example finds missing rate limit' ($ids -contains 'rate')
Check 'password example title counts two' ($d.title -eq '2 things before you accept this') $d.title
Check 'password example body numbers the findings' ($d.body -like '1. *' -and $d.body -like '*2. *')
Check 'password example has explain text' ($d.explain.body -like '*one-way function*')
Check 'password example has three buttons' (@($d.buttons).Count -eq 3)
$explainCount = @($d.buttons | Where-Object { $_.action -eq 'explain' }).Count
$fixCount = @($d.buttons | Where-Object { $_.action -eq 'fix' }).Count
$ignoreCount = @($d.buttons | Where-Object { $_.action -eq 'ignore' }).Count
Check 'password example offers Explain why' ($explainCount -eq 1) ($explainCount.ToString())
Check 'password example offers Fix my prompt' ($fixCount -eq 1) ($fixCount.ToString())
Check 'password example offers Ignore' ($ignoreCount -eq 1) ($ignoreCount.ToString())
Check 'fixed prompt keeps the original ask' ($d.fixed -like 'Add a login endpoint*')
Check 'fixed prompt names bcrypt or argon2' ($d.fixed -match 'bcrypt|argon2id')
Check 'fixed prompt adds rate limiting' ($d.fixed -match 'rate-limit')
Check 'fixed prompt adds generic errors' ($d.fixed -match 'generic errors')
Check 'fixed prompt is not the original' ($d.fixed -ne $example)

# --- security: suppression --------------------------------------------------

$safe = 'Add a login endpoint. Hash passwords with bcrypt, compare in constant time, rate-limit to 5 attempts per minute per IP'
Check 'hashed and rate limited -> silent' ((Kind $safe) -eq 'none') (Kind $safe)
$bcryptFindings = @((Get-CoachDecision 'Add a login endpoint that stores bcrypt passwords in the database').findings | Where-Object { $_.id -eq 'password' })
$limitedFindings = @((Get-CoachDecision 'Add a login endpoint that checks the password against the database, rate limited to 5 per minute').findings | Where-Object { $_.id -eq 'rate' })
Check 'bcrypt alone suppresses the hash finding' ($bcryptFindings.Count -eq 0) ($bcryptFindings.Count.ToString())
Check 'rate limiting alone suppresses the rate finding' ($limitedFindings.Count -eq 0) ($limitedFindings.Count.ToString())

# --- security: single finding ----------------------------------------------

$one = Get-CoachDecision 'add a password reset endpoint'
Check 'password reset endpoint -> security' ($one.kind -eq 'security')
Check 'password reset endpoint names one finding' (@($one.findings).Count -eq 1) (@($one.findings).Count.ToString() + ' findings')
Check 'password reset endpoint title is singular' ($one.title -eq '1 thing before you accept this') $one.title
Check 'single finding fixed prompt skips hashing' ($one.fixed -notmatch 'bcrypt|argon2') $one.fixed
Check 'single finding fixed prompt adds the rate limit' ($one.fixed -match 'Rate-limit') $one.fixed

# --- security: the card is not password-only --------------------------------

$secret = Get-CoachDecision 'hardcode the Stripe API key in the config'
$secretIds = @($secret.findings | ForEach-Object { $_.id })
Check 'hardcoded key -> security' ($secret.kind -eq 'security')
Check 'hardcoded key names the secret finding' ($secretIds -contains 'secret')
Check 'hardcoded key fix says environment' ($secret.fixed -match 'environment')
Check 'read key from environment -> silent' ((Kind 'read the Stripe API key from the environment') -eq 'none')

$sql = Get-CoachDecision 'build a SQL query from the user''s input'
$sqlIds = @($sql.findings | ForEach-Object { $_.id })
Check 'sql from input -> security' ($sql.kind -eq 'security')
Check 'sql from input names the sql finding' ($sqlIds -contains 'sql')
Check 'sql fix says parameterized' ($sql.fixed -match 'parameterized')
Check 'parameterized query -> silent' ((Kind 'use a parameterized query for the user search') -eq 'none')

$cmd = Get-CoachDecision 'run the user''s command with child_process.exec'
$cmdIds = @($cmd.findings | ForEach-Object { $_.id })
Check 'command from input -> security' ($cmd.kind -eq 'security')
Check 'command from input names the command finding' ($cmdIds -contains 'command')
Check 'command fix says no shell' ($cmd.fixed -match 'no shell')
Check 'args array -> silent' ((Kind 'run the user''s command with an args array and no shell') -eq 'none')

$html = Get-CoachDecision 'render user comments as raw HTML'
$htmlIds = @($html.findings | ForEach-Object { $_.id })
Check 'user html -> security' ($html.kind -eq 'security')
Check 'user html names the html finding' ($htmlIds -contains 'html')
Check 'html fix says escape' ($html.fixed -match 'Escape')
Check 'sanitized html -> silent' ((Kind 'sanitize the HTML before rendering user comments') -eq 'none')

$input = Get-CoachDecision 'accept a file upload and save it to disk'
$inputIds = @($input.findings | ForEach-Object { $_.id })
Check 'unvalidated upload -> security' ($input.kind -eq 'security')
Check 'unvalidated upload names the input finding' ($inputIds -contains 'input')
Check 'input fix says schema' ($input.fixed -match 'schema')
Check 'validated upload -> silent' ((Kind 'validate the file upload with a schema before saving') -eq 'none')

# Every class gets the same three actions, not a password-only script.
foreach ($card in @($secret, $sql, $cmd, $html, $input)) {
  $actions = @($card.buttons | ForEach-Object { $_.action })
  Check ('class card offers explain/fix/ignore: ' + $card.findings[0].id) (($actions -contains 'explain') -and ($actions -contains 'fix') -and ($actions -contains 'ignore'))
}

# The card stays a nudge: three findings collapse to the two most severe.
$many = Get-CoachDecision 'add a login endpoint that checks the password against the database and hardcodes the API key'
Check 'three findings cap at two' (@($many.findings).Count -eq 2) (@($many.findings).Count.ToString() + ' findings')
Check 'the cap keeps the two auth findings' ((@($many.findings | ForEach-Object { $_.id }) -join ',') -eq 'password,rate')

# --- precedence -------------------------------------------------------------

Check 'destructive wins over security' ((Kind 'delete the password table') -eq 'destructive')

Write-Output ''
Write-Output ('checks: ' + $checks + '  failed: ' + $fails)
if ($fails -gt 0) { exit 1 }
Write-Output 'rules: PASS'
