# Coach.Rules.ps1 - the deterministic decisions behind every card.
#
# Pure string matching. No model call, no network, no session access. Kept in
# its own file so tests/Rules.ps1 can assert every branch without a desktop.
#
# Two kinds of card:
#   destructive - a delete/rewrite ask with no recovery point
#   security    - a build ask that would produce a known-unsafe pattern:
#                 plaintext passwords, no rate limit, a committed secret, SQL
#                 built from input, a shell command built from input, unescaped
#                 HTML, or unvalidated input
#
# Findings are ordered by severity and capped at two, so the card stays a nudge
# and not a report. Silence is the default and the overwhelmingly common answer.

$script:ReGuard = '(?i)\b(backup|backed up|commit\w*\s+(?:first|before|the current)|dry[- ]?run|snapshot|confirm|only|specific|this file|one file)\b'
$script:ReFile = '(?i)\b[\w./\\-]+\.(ps1|psm1|psd1|js|mjs|cjs|ts|tsx|jsx|py|cs|go|rs|rb|java|kt|swift|json|ya?ml|toml|md|css|html|sql|sh|bash|bat|cmd|c|h|cpp|hpp)\b'
$script:ReHard = '(?i)\b(rm\s+-rf|git\s+clean|force[- ]?push|drop\s+table|truncate\s+table)\b'
$script:ReVerb = '(?i)\b(delete|deletes|deleting|reset|resets|resetting|drop|drops|dropping|truncate|truncates|truncating|overwrite|overwrites|overwriting|wipe|wipes|wiping|purge|purges|purging|destroy|destroys|destroying|remove|removes|removing|clear|clears|clearing)\b'
$script:ReObject = '(?i)\b(files?|folders?|directories?|dirs?|data|database|db|tables?|rows?|records?|logs?|history|branch(es)?|commits?|repo(sitory)?|worktree|build|output|cache|config|credentials?|secrets?|disk|drive|migrations?)\b'

$script:ReCredential = '(?i)\b(password|passwd|passphrase|passwords|credential|credentials|login|log in|signin|sign in|sign-in)\b'
$script:ReBuild = '(?i)\b(add|adds|adding|create|creates|creating|build|builds|building|implement|implements|implementing|make|makes|making|write|writes|writing|set up|setup|wire|wires|wiring)\b'
$script:ReAuthSurface = '(?i)\b(endpoint|route|form|page|handler|service|flow|api|controller|view|screen|middleware|portal|backend)\b'
$script:ReCompare = '(?i)\b(compare|compares|comparing|check|checks|checking|verify|verifies|verifying|validate|validates|validating|against the database|against the db|against db|store|stores|storing|save|saves|saving|plaintext|plain[- ]text|==|===|equals)\b'
# A login word plus a UI word is not credential handling. A card only fires when
# the ask actually does something with a credential, so "make the login page look
# nicer" and "write unit tests for the login form" stay silent.
$script:ReCredHandling = '(?i)\b(compare|compares|comparing|check\w*|verify|verif\w*|validat\w*|authenticat\w*|store\w*|sav\w*|hash\w*|against\s+the\s+(?:database|db)|==|===|equals|reset\w*|change\w*|updat\w*)\b'
$script:ReHashed = '(?i)\b(bcrypt|argon2\w*|scrypt|pbkdf2|hash|hashed|hashes|hashing|salt|salted|salting|constant[- ]?time|timing[- ]?safe)\b'
$script:ReRateLimit = '(?i)\b(rate[- ]?limit\w*|ratelimit\w*|throttl\w*|backoff|lockout|lock[- ]?out|attempts? per|max(imum)? attempts|captcha|fail2ban|brute[- ]?force protection)\b'

$script:ReSecretNoun = '(?i)\b(api[- ]?key|access[- ]?key|secret[- ]?key|private[- ]?key|token|secret|credentials?)\b'
$script:ReSecretPlace = '(?i)(\bhard[- ]?code\w*\b|\binline\b|\bpaste\b|\bembed\b|\bcommit\w*\b|\bput\s+(?:it|them|the\s+\w+)?\s*(?:in|into)\s+(?:the\s+)?(?:code|source|repo|config|file)\b|\bstore\s+(?:it|them)?\s*in\s+(?:the\s+)?(?:code|source|repo|config)\b|\badd\s+(?:it|them|the\s+\w+)?\s*to\s+(?:the\s+)?(?:code|source|config)\b)'
$script:ReSecretSafe = '(?i)\b((?:env|environment)(?:\s+variable)?|secret\s+manager|vault|keychain|process\.env|os\.environ|do not commit|never commit|rotate)\b'

$script:ReSql = '(?i)\b(sql|query|select\s+.*\s+from|where\s+clause)\b'
$script:ReSqlUnsafe = '(?i)(\b(?:from|with|using)\s+(?:the\s+)?user(?:''s)?\b|\buser(?:''s)?\s+(?:input|search|query|name|id|filter)\b|\brequest\.(?:body|query|params)\b|\bquery\s+string\b|\bstring\s+(?:concat|interpolation)\b|\bconcat\w*\b|\binterpolat\w*\b)'
$script:ReSqlSafe = '(?i)\b(parameteri[sz]ed|prepared\s+statement|bind\s+parameter|placeholders?|orm|query\s+builder|kysely|prisma|drizzle)\b'

$script:ReCmd = '(?i)\b(exec|execsync|spawn|spawnsync|child_process|system\(|shell|bash\s+-c|run\s+(?:a\s+)?command|execute\s+(?:a\s+)?command)\b'
$script:ReCmdUnsafe = '(?i)(\buser(?:''s)?\s+(?:input|command|filename|path|argument|args?)\b|\brequest\.(?:body|query|params)\b|\bquery\s+string\b|\bform\s+input\b|\bfilename\s+from\b)'
$script:ReCmdSafe = '(?i)\b(allow[- ]?list|args?\s+array|no\s+shell|shell:\s*false|sanitiz\w*|escape\w*|validate\w*)\b'

$script:ReHtml = '(?i)\b(html|innerhtml|dangerouslysetinnerhtml|markup|rich\s+text)\b'
$script:ReHtmlUnsafe = '(?i)(\b(?:render|display|show|insert|output|set)\w*\b[^.]{0,40}\buser(?:''s)?\s+(?:inputs?|data|content|comments?|posts?|messages?)\b|\buser(?:''s)?\s+(?:inputs?|data|content|comments?|posts?|messages?)\b[^.]{0,40}\b(?:html|innerhtml|markup)\b)'
$script:ReHtmlSafe = '(?i)\b(escape\w*|sanitiz\w*|textcontent|encode\w*|dompurify|markdown|plain\s+text)\b'

$script:ReInput = '(?i)\b(user(?:''s)?\s+(?:inputs?|data|content)|request\.(?:body|query|params)|form\s+(?:data|input)|file\s+uploads?|uploaded\s+files?|query\s+param\w*)\b'
$script:ReInputVerb = '(?i)\b(accept\w*|take\w*|read\w*|parse\w*|save\w*|store\w*|handle\w*|process\w*|upload\w*|insert\w*|write\w*)\b'
$script:ReValidate = '(?i)\b(validat\w*|sanitiz\w*|schema|zod|yup|joi|ajv|type\s*check|whitelist|allow[- ]?list|escape\w*|limit\w*)\b'

$script:Guardrail = 'Before you delete or rewrite anything, commit the current state, take a backup, and run the change against one target first; confirm the result before widening it.'

$script:FindingPassword = @{
  id    = 'password'
  label = 'Passwords would be compared in plaintext'
  body  = 'Nothing here says the password is hashed, so the obvious implementation compares the stored value with == . Passwords must be one-way: store hash(password) with a per-user salt, and compare in constant time.'
  why   = 'A hash is a one-way function. You store hash(password), and at login you hash what the user typed and compare. Even you cannot recover the original. Two users who pick the same password would produce the same hash, which is why a per-user salt is the next concept.'
  fix   = 'Use bcrypt or argon2id with a per-user salt, and compare in constant time.'
}

$script:FindingRate = @{
  id    = 'rate'
  label = 'No rate limiting on the credential path'
  body  = 'Nothing here limits attempts, so one client can try thousands of passwords a minute against the same account.'
  why   = 'A login endpoint without a limit turns a slow guess into an offline-speed one. Rate limiting per IP and per account, with a short lockout, is what reduces thousands of attempts a minute to a handful.'
  fix   = 'Rate-limit to 5 attempts per minute per IP and per account, and return generic errors that do not reveal whether an account exists.'
}

$script:FindingSecret = @{
  id    = 'secret'
  label = 'A secret would be committed to the repo'
  body  = 'The ask puts a key or token in code or config that goes into git, so it ends up in every clone and every backup, and rotating it later is painful.'
  why   = 'A secret in a repo is not private even after you delete it: it stays in the history, in forks, and in every machine that pulled it. The only safe place is a value injected at runtime from a secret manager or environment variable, so the repo never contains it.'
  fix   = 'Read the value from an environment variable or secret manager at runtime, and never commit it.'
}

$script:FindingSql = @{
  id    = 'sql'
  label = 'SQL built from input'
  body  = 'The ask builds a query from user input, so a quote in the input can end the query and run something else.'
  why   = 'A query is code. When you join input into the string, the database cannot tell your SQL from the input, so the input becomes code too. A parameterized query sends the query and the values separately, and the database treats the values as data no matter what they contain.'
  fix   = 'Use parameterized queries with bind parameters, never string concatenation, and validate the input.'
}

$script:FindingCommand = @{
  id    = 'command'
  label = 'Shell command built from input'
  body  = 'The ask passes user-controlled text to a shell, so a semicolon or a backtick in the input runs an extra command.'
  why   = 'A shell interprets punctuation. If the input is pasted into the command string, the input can close your command and start another one. Passing an argument array with no shell keeps the input as one argument, and an allowlist keeps the set of commands small.'
  fix   = 'Pass an argument array with no shell, and allowlist the commands you accept.'
}

$script:FindingHtml = @{
  id    = 'html'
  label = 'User content rendered as HTML'
  body  = 'The ask inserts user content into HTML without escaping it, so a script tag in a comment runs in every reader''s browser.'
  why   = 'The browser cannot tell your markup from the user''s markup once they are one string. Escaping turns the angle brackets into text, and sanitizing with a library keeps a small allowlist of tags. Both keep the user''s words visible without letting them become code.'
  fix   = 'Escape the output, or sanitize it with a library like DOMPurify before inserting HTML.'
}

$script:FindingInput = @{
  id    = 'input'
  label = 'Input used without validation'
  body  = 'The ask reads user input and uses it directly, so an empty, oversized, or malformed value reaches the rest of the code.'
  why   = 'Every boundary is a place where the shape of the data can change. Validating at the boundary means the rest of the code can assume a known shape, and the error is a clear rejection instead of a crash or a corrupt row later.'
  fix   = 'Validate the input against a schema at the boundary, then store only the fields you expect.'
}

function Test-Destructive([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if ($t -match $script:ReGuard) { return $false }
  if ($t -match $script:ReHard) { return $true }
  if (-not (($t -match $script:ReVerb) -and ($t -match $script:ReObject))) { return $false }
  # Naming one file is a specific target, not a broad sweep. "delete all the
  # .ts files" still counts, because the ask is not one target.
  if (($t -match $script:ReFile) -and -not ($t -match '(?i)\b(all|everything|every)\b')) { return $false }
  return $true
}

function Test-AuthAsk([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if (-not (($t -match $script:ReCredential) -and ($t -match $script:ReBuild) -and ($t -match $script:ReAuthSurface))) { return $false }
  return ($t -match $script:ReCredHandling)
}

function Test-SecretAsk([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if ($t -match $script:ReSecretSafe) { return $false }
  return (($t -match $script:ReSecretNoun) -and ($t -match $script:ReSecretPlace))
}

function Test-SqlAsk([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if ($t -match $script:ReSqlSafe) { return $false }
  return (($t -match $script:ReSql) -and ($t -match $script:ReSqlUnsafe))
}

function Test-CommandAsk([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if ($t -match $script:ReCmdSafe) { return $false }
  return (($t -match $script:ReCmd) -and ($t -match $script:ReCmdUnsafe))
}

function Test-HtmlAsk([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if ($t -match $script:ReHtmlSafe) { return $false }
  return (($t -match $script:ReHtml) -and ($t -match $script:ReHtmlUnsafe))
}

function Test-InputAsk([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return $false }
  if ($t -match $script:ReValidate) { return $false }
  return (($t -match $script:ReInput) -and ($t -match $script:ReInputVerb))
}

# Ordered by severity. The card shows at most the first two.
function Get-SecurityFindings([string]$Text) {
  $t = [string]$Text
  $found = @()
  if (-not $t) { return $found }

  if ((Test-AuthAsk $t) -and -not ($t -match $script:ReHashed) -and ($t -match $script:ReCompare)) {
    $found += $script:FindingPassword
  }
  if ((Test-AuthAsk $t) -and -not ($t -match $script:ReRateLimit)) {
    $found += $script:FindingRate
  }
  if (Test-SecretAsk $t) { $found += $script:FindingSecret }
  if (Test-SqlAsk $t) { $found += $script:FindingSql }
  if (Test-CommandAsk $t) { $found += $script:FindingCommand }
  if (Test-HtmlAsk $t) { $found += $script:FindingHtml }
  if (Test-InputAsk $t) { $found += $script:FindingInput }
  return $found
}

# Returns a decision the daemon can render without deciding anything itself.
#   @{ kind = 'none' }
#   @{ kind = 'destructive'; title; body; buttons; guardrail }
#   @{ kind = 'security'; title; body; findings; explain; fixed; buttons }
function Get-CoachDecision([string]$Text) {
  $t = [string]$Text
  if (-not $t) { return @{ kind = 'none' } }

  if (Test-Destructive $t) {
    return @{
      kind      = 'destructive'
      title     = 'Destructive ask without a recovery point'
      body      = 'This deletes or rewrites state, and nothing in the ask makes it reversible. Copy the guardrail and paste it into the conversation.'
      guardrail = $script:Guardrail
      buttons   = @(
        @{ id = 'CoachCopyGuardrail'; label = 'Copy the guardrail'; action = 'copy' },
        @{ id = 'CoachDismiss'; label = 'Dismiss'; action = 'dismiss' }
      )
    }
  }

  $all = @(Get-SecurityFindings $t)
  if ($all.Count -eq 0) { return @{ kind = 'none' } }
  $findings = @($all | Select-Object -First 2)

  $lines = @()
  for ($i = 0; $i -lt $findings.Count; $i++) {
    $lines += (([string]($i + 1)) + '. ' + $findings[$i].label + '. ' + $findings[$i].body)
  }
  $why = @()
  for ($i = 0; $i -lt $findings.Count; $i++) {
    $why += (([string]($i + 1)) + '. ' + $findings[$i].why)
  }
  $fixes = @()
  foreach ($f in $findings) {
    if ($f.fix -and -not ($fixes -contains $f.fix)) { $fixes += [string]$f.fix }
  }

  $what = if ($findings.Count -eq 1) { '1 thing before you accept this' } else { ('{0} things before you accept this' -f $findings.Count) }

  return @{
    kind     = 'security'
    title    = $what
    body     = ($lines -join "`n`n")
    findings = $findings
    explain  = @{
      title = 'Why this matters'
      body  = ($why -join "`n`n")
    }
    fixed    = ([string]$t).Trim().TrimEnd('.') + '. ' + ($fixes -join ' ')
    buttons  = @(
      @{ id = 'CoachExplain'; label = 'Explain why'; action = 'explain' },
      @{ id = 'CoachFixPrompt'; label = 'Fix my prompt'; action = 'fix' },
      @{ id = 'CoachIgnore'; label = 'Ignore'; action = 'ignore' }
    )
  }
}
