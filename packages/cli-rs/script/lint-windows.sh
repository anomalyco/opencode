#!/bin/sh
# Finds code that is right on Unix and wrong on Windows, before the preview's Windows runner does. Each rule is a
# pattern that failed there: on Windows the paths the client finds use `\`, and `/x` has no drive.
#
#   join-text  `.join("a/b")` turned into text in the same expression: `to_string_lossy()`, `to_str()`, or
#              `display()` on a line that builds a string with `format!` (a message to a person is no comparison).
#   join-let   `let x = ….join("a/b")…;` and, later in the same function, `x` (or `x.join(…)`) turned into text so.
#   unix-abs   an `OPENCODE_*` variable set to a literal Unix absolute path (`.env`, `set_var`, `"OPENCODE_X" =>`).
#
# A deliberate exception carries `// windows-lint: allow <reason>` on the line or the line above it. A file that is
# `#![cfg(unix)]` as a whole is not read, and neither is a function gated to Unix (`#[cfg(unix)]`,
# `#[cfg(target_os = "linux")]` and the like). Usage: sh script/lint-windows.sh [path...] (default: crates).
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$here"
[ $# -gt 0 ] || set -- crates

# A string argument with a `/`: a literal, or a format! whose template has one.
slash='(?:"[^"]*/[^"]*"|format!\("[^"]*/[^"]*"(?:[^()]|\([^()]*\))*\))'
join_text="\\.join\\($slash\\)(?:\\.join\\((?:[^()]|\\([^()]*\\))*\\))*\\.(?:to_string_lossy|to_str|display)\\(\\)"
join_let="^\\s*let (?:mut )?([a-z_][a-z0-9_]*) = [^;]*\\.join\\($slash\\)"
unix_abs='(?:\.env|set_var)\("OPENCODE_[A-Z0-9_]+",\s*"/|"OPENCODE_[A-Z0-9_]+"\s*=>\s*Some\("/'

report=$(
    rg -lP --type rust "$join_text|$join_let|$unix_abs" "$@" | sort | while read -r file; do
        head -n 5 "$file" | grep -q '^#!\[cfg(unix)\]' && continue
        # rg finds the lines of each rule; awk applies the binding's scope and the allows.
        {
            rg -nP --no-heading "$join_text" "$file" | sed 's/^\([0-9]*\):.*/join-text \1 -/' || true
            rg -nP --no-heading "$unix_abs" "$file" | sed 's/^\([0-9]*\):.*/unix-abs \1 -/' || true
            rg -nP --no-heading -o -r '$1' "$join_let" "$file" | sed 's/^\([0-9]*\):\(.*\)/join-let \1 \2/' || true
        } | awk -v file="$file" '
            BEGIN { while ((getline line < file) > 0) source[++lines] = line }
            function allowed(at) {
                return source[at] ~ /windows-lint: allow/ || (at > 1 && source[at - 1] ~ /windows-lint: allow/)
            }
            function is_fn(line) { return line ~ /^[ \t]*(pub(\([a-z]+\))? )?(async )?(unsafe )?fn / }
            # Whether the function around line `at` is gated to Unix by an attribute above it.
            function unix_only(at,    i) {
                for (i = at; i > 0 && !is_fn(source[i]); i--) {}
                for (i--; i > 0 && source[i] ~ /^[ \t]*(#\[|\/\/)/; i--) {
                    if (source[i] ~ /#\[cfg\((unix|not\(windows\)|target_os = "(linux|macos)"|any\(target_os = "(linux|macos)")/) return 1
                }
                return 0
            }
            # Whether line `at` turns `value` into text that is compared, not shown: `display()` counts only in a format!.
            function compared(at, value) {
                if (source[at] ~ (value "\\.(to_string_lossy|to_str)\\(\\)")) return 1
                return source[at] ~ (value "\\.display\\(\\)") && source[at] ~ /format!\(/
            }
            # The line where binding `name`, made at line `at`, is turned into text before the next `fn` item; 0 if none.
            function as_text(name, at,    i, value) {
                value = "(^|[^A-Za-z0-9_.])" name "(\\.join\\([^;]*\\))?"
                for (i = at + 1; i <= lines; i++) {
                    if (is_fn(source[i])) return 0
                    if (compared(i, value)) return i
                }
                return 0
            }
            {
                rule = $1; at = $2 + 0; name = $3
                if (allowed(at) || unix_only(at)) next
                if (rule == "join-text" && !compared(at, "")) next
                if (rule == "join-text") {
                    printf "%s:%d: join-text: a path joined with a `/` in one argument is turned into text\n", file, at
                } else if (rule == "unix-abs") {
                    printf "%s:%d: unix-abs: an OPENCODE_* variable is set to a Unix absolute path\n", file, at
                } else if ((used = as_text(name, at)) && !allowed(used)) {
                    printf "%s:%d: join-let: `%s` is joined with a `/` in one argument and turned into text at line %d\n", file, at, name, used
                }
            }
        '
    done
)
if [ -n "$report" ]; then
    printf '%s\n' "$report" >&2
    cat >&2 <<'EOF'

On Windows the paths the client finds use `\`, so a path joined as "a/b" and compared as text never matches them,
and "/x" is not absolute (it has no drive). The Windows-safe forms:
  join-text, join-let  join one component at a time, .join("a").join("b"), or compare Paths, not text;
                       for text on screen, std::path::MAIN_SEPARATOR.
  unix-abs             an absolute path of the platform: if cfg!(windows) { r"C:\x" } else { "/x" }.
A deliberate exception: `// windows-lint: allow <reason>` on the line or the line above.
EOF
    exit 1
fi
printf 'PASS: Windows lint\n'
