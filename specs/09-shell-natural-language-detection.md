## Shell natural language detection

Route natural language input away from the shell and toward the agent

---

### Summary

Users sometimes type natural language in shell mode where the first word happens to be a valid command or shell keyword. Two complementary layers catch this: a pre-execution filter for shell reserved words that are never valid standalone commands, and a post-execution heuristic that detects natural language after a real command fails.

This spec is a shared reference for both lash (opencode) and lacyshell. The algorithm is intentionally simple — pure string matching with no dependencies.

---

### Layer 1: Filter reserved words before execution

Shell reserved words like `do`, `done`, `then`, `else` are recognized by `command -v` (exit 0) but are never valid as standalone invocations. They only make sense inside compound constructs (`if/then/fi`, `for/do/done`, etc.).

When the first token of user input is a reserved word, skip the `command -v` check and route directly to the agent.

Complete reserved word list:

```
do  done  then  else  elif  fi  esac  in  select  function  coproc  {  }  !  [[
```

`if`, `for`, `while`, `until`, `case`, and `time` are excluded because they are commonly used as real command prefixes or have standalone uses. Those are handled by Layer 2.

Examples caught by this layer:

- `do We already have an easy way to uninstall lacy?`
- `in the codebase where is the auth module?`
- `then what should I do next?`

---

### Layer 2: Detect natural language after a failed command

For real commands that pass `command -v` (like `find`, `make`, `git`, `while`, `test`), the user may still be typing natural language that starts with a valid command name. After shell execution, if the command exits non-zero, analyze the output against two criteria.

Both criteria must be satisfied.

---

### Match error patterns (criterion A)

The shell output must contain at least one of these error strings:

```
parse error
syntax error
unexpected token
unexpected end of file
command not found
no such file or directory
invalid option
unrecognized option
illegal option
unknown option
no rule to make target
unknown primary or operator
missing argument to
invalid regular expression
is not a git command
unknown command
no such command
```

---

### Check for natural language signal (criterion B)

One of:

1. The **second word** of the input (lowercased) is in the natural language word list, OR
2. The input has **5+ words** AND the error matches `parse error`, `syntax error`, or `unexpected token`

---

### Natural language word list

~100 common English words that are unusual as shell arguments:

| Category             | Words                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Articles/determiners | a, an, the, this, that, these, those, my, our, your                                                                                                                                              |
| Pronouns             | i, we, you, it, they, me, us, him, her, them                                                                                                                                                     |
| Prepositions         | to, of, about, with, from, for, into, through, between, after, before                                                                                                                            |
| Conjunctions         | and, but, or, so, because, since, although                                                                                                                                                       |
| Verbs                | is, are, was, were, be, been, have, has, had, can, could, would, should, will, shall, may, might, must, need, want                                                                               |
| Adverbs              | not, already, also, just, still, even, really, actually, probably, maybe                                                                                                                         |
| Question words       | how, what, when, where, why, who, which                                                                                                                                                          |
| Other                | if, there, here, all, any, some, every, no, each, does, do, did, sure, out, up, down, ahead, back, over, away, around, along, please, anyone, someone, everyone, anything, something, everything |

---

### Minimum word count

Inputs with fewer than 3 words are always treated as real commands, even if they fail. Two-word inputs like `ls foo` or `git stash` are common real commands and should not trigger detection.

---

### Detection logic

```
function detectNaturalLanguage(input, output, exitCode):
  if exitCode == 0 or exitCode == null: return null
  if wordCount(input) < 3: return null
  if not matchesAnyErrorPattern(output): return null

  secondWord = lowercase(words(input)[1])
  if secondWord in NATURAL_LANGUAGE_WORDS:
    return hint

  if wordCount(input) >= 5 and output matches /parse error|syntax error|unexpected token/:
    return hint

  return null
```

---

### Hint message

When natural language is detected, surface a hint below the shell error output:

```
This looks like a question for the agent. Try again without shell mode, or press Ctrl+Space to switch to Agent mode.
```

The hint should be visually distinct (warning color).

---

### Reference examples

| Input                                    | First token | Layer | What happens                                                 |
| ---------------------------------------- | ----------- | ----- | ------------------------------------------------------------ |
| `do We already have a way to uninstall?` | `do`        | 1     | Reserved word — route to agent                               |
| `in the codebase where is auth?`         | `in`        | 1     | Reserved word — route to agent                               |
| `find out how the auth system works`     | `find`      | 2     | Runs — "unknown primary or operator" + "out" is NL — hint    |
| `make sure the tests pass`               | `make`      | 2     | Runs — "No rule to make target 'sure'" + "sure" is NL — hint |
| `git me the latest changes`              | `git`       | 2     | Runs — "'me' is not a git command" + "me" is NL — hint       |
| `while you are at it fix the tests`      | `while`     | 2     | Runs — "syntax error" + "you" is NL — hint                   |
| `test the login flow works`              | `test`      | 2     | Runs — exits non-zero + "the" is NL — hint                   |
| `go ahead and fix the tests`             | `go`        | 2     | Runs — "unknown command" + "ahead" is NL — hint              |
| `go for it and deploy`                   | `go`        | 2     | Runs — "unknown command" + "for" is NL — hint                |
| `cargo ahead with the release`           | `cargo`     | 2     | Runs — "no such command" + "ahead" is NL — hint              |
| `ls -la`                                 | `ls`        | —     | Succeeds — no detection                                      |
| `grep -r foo`                            | `grep`      | —     | May fail but error doesn't match NL heuristic                |

---

### Implementation in lash (opencode)

| File                                       | Role                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `plugin/shell-mode/command-check.ts`       | `SHELL_RESERVED_WORDS` set, checked before `command -v`                         |
| `plugin/shell-mode/natural-language.ts`    | `detectNaturalLanguage()` function                                              |
| `src/session/prompt.ts`                    | Captures exit code, calls `detectNaturalLanguage`, adds `hint` to tool metadata |
| `src/tool/bash.ts`                         | `hint` optional field on metadata type                                          |
| `src/cli/cmd/tui/routes/session/index.tsx` | Bash component shows hint in warning color                                      |
| `test/plugin/shell-mode.test.ts`           | Tests for both layers                                                           |

---

### Implementation in lacyshell

| File                    | Role                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `lib/core/constants.sh` | `LACY_SHELL_RESERVED_WORDS`, `LACY_NL_MARKERS`, `LACY_SHELL_ERROR_PATTERNS` arrays              |
| `lib/core/detection.sh` | `lacy_shell_classify_input()` (Layer 1 check), `lacy_shell_detect_natural_language()` (Layer 2) |
| `lib/zsh/execute.zsh`   | Reroute candidate logic in `lacy_shell_precmd()`, hint display                                  |
| `lib/bash/execute.bash` | Reroute candidate logic in `lacy_shell_precmd_bash()`, hint display                             |
| `tests/test_core.sh`    | Tests for both layers (Bash and ZSH)                                                            |

Both lists (reserved words and natural language words) must be kept in sync across implementations. The algorithm has no dependencies — it is pure string matching.

**Lacyshell-specific extensions** (not in lash):

- `LACY_HARD_AGENT_INDICATORS` (`what`, `yes`, `no`) — first words that always route to agent regardless of `command -v`
- `lacy_shell_has_nl_markers()` — pre-execution reroute candidate flagging (counts bare words after first word, checks for NL markers, requires 3+ bare words)
