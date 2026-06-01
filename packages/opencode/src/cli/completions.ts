/**
 * Fish shell completion script for opencode.
 *
 * Dynamic completions: calls `opencode --get-yargs-completions` at completion time,
 * so new subcommands/options are picked up automatically when opencode is updated.
 * Descriptions are parsed from `opencode --help` output and cached per-session.
 *
 * Installation: opencode completion fish > ~/.config/fish/completions/opencode.fish
 */
export const fishCompletion = `# Fish shell completions for opencode
# Installation: opencode completion fish > ~/.config/fish/completions/opencode.fish
#
# Dynamic completions: calls \`opencode --get-yargs-completions\` at completion time,
# so new subcommands/options are picked up automatically when opencode is updated.
# Descriptions are parsed from \`opencode --help\` output and cached per-session.

# Disable file completions by default
complete -c opencode -f

# ---- Sanitize a string for use as a Fish variable name key ----
function __opencode_sanitize_key --argument-names raw
    string replace -a '[' '_' -- $raw | string replace -a ']' '_' | string replace -a '<' '_' | string replace -a '>' '_' | string replace -a '-' '_' | string replace -a ' ' '_'
end

# ---- Strip yargs type annotations from a description string ----
function __opencode_strip_annotations --argument-names desc
    set -l max_iter 10
    set -l changed 1
    while test $max_iter -gt 0 -a $changed -eq 1
        set changed 0
        # Simple type annotations: [boolean], [string], [number], [array], [required]
        set -l new (string replace -r '[[:space:]]+\\[(boolean|string|number|array|required)\\][[:space:]]*$' '' -- $desc)
        if test "$new" != "$desc"; set desc $new; set changed 1; continue; end
        # [default: ...] - greedy to handle nested brackets like [default: []]
        set new (string replace -r '[[:space:]]+\\[default:.*\\][[:space:]]*$' '' -- $desc)
        if test "$new" != "$desc"; set desc $new; set changed 1; continue; end
        # [choices: ...] - greedy
        set new (string replace -r '[[:space:]]+\\[choices:.*\\][[:space:]]*$' '' -- $desc)
        if test "$new" != "$desc"; set desc $new; set changed 1; continue; end
        # [aliases: ...] - greedy
        set new (string replace -r '[[:space:]]+\\[aliases:.*\\][[:space:]]*$' '' -- $desc)
        if test "$new" != "$desc"; set desc $new; set changed 1; continue; end
        set max_iter (math $max_iter - 1)
    end
    string trim -- $desc
end

# ---- Parse \`opencode <prefix> --help\` and cache descriptions ----
function __opencode_parse_help --argument-names prefix
    set -l help_output
    if test -z "$prefix"
        set help_output (opencode --help 2>&1)
    else
        # Split prefix on spaces so opencode receives each word as a separate arg
        set help_output (opencode (string split ' ' -- $prefix) --help 2>&1)
    end

    set -l section ""

    for line in $help_output
        set -l trimmed (string trim -- $line)

        if test -z "$trimmed"
            set section ""
            continue
        end

        # Detect section headers
        if string match -q "Commands:" -- $trimmed
            set section commands
            continue
        else if string match -q "Options:" -- $trimmed
            set section options
            continue
        else if string match -q "Positionals:" -- $trimmed
            set section positionals
            continue
        end

        switch $section
            case commands
                set -l stripped
                if test -z "$prefix"
                    set stripped (string replace 'opencode ' '' -- $trimmed)
                else
                    set stripped (string replace "opencode $prefix " '' -- $trimmed)
                end

                if not string match -rq '^[a-zA-Z]' -- $stripped
                    continue
                end

                set -l parts (string match -r '^(.+?)[[:space:]]{2,}(\\S.*?)[[:space:]]*$' -- $stripped)
                if not set -q parts[2]
                    set parts[2] $stripped
                    set parts[3] ""
                end

                set -l cmd_name (string replace -r '^(\\S+).*$' '$1' -- $parts[2])
                set -l cmd_desc (__opencode_strip_annotations $parts[3])

                set -l var_key
                if test -z "$prefix"
                    set var_key (__opencode_sanitize_key $cmd_name)
                else
                    set var_key (__opencode_sanitize_key "$prefix")'_'(__opencode_sanitize_key $cmd_name)
                end
                set -g "__opencode_cmd_$var_key" $cmd_desc

            case options
                set -l opt_parts (string match -r '^((?:-[a-zA-Z],[[:space:]]+)?--[a-zA-Z-]+)[[:space:]]{2,}(\\S.*?)[[:space:]]*$' -- $trimmed)
                if not set -q opt_parts[2]
                    continue
                end

                set -l flags $opt_parts[2]
                set -l opt_desc (__opencode_strip_annotations $opt_parts[3])

                set -l long_flag
                set -l short_flag
                if string match -rq -- '^-.*,' -- $flags
                    set -l flag_split (string split ", " -- $flags)
                    set short_flag $flag_split[1]
                    set long_flag (string trim -- $flag_split[2])
                else
                    set long_flag $flags
                end

                set -l long_key (__opencode_sanitize_key $long_flag)
                set -g "__opencode_opt_$long_key" $opt_desc

                if set -q short_flag[1]
                    set -l short_key (__opencode_sanitize_key $short_flag)
                    set -g "__opencode_opt_$short_key" $opt_desc
                end

            case positionals
                set -l pos_parts (string match -r '^(\\S+)[[:space:]]{2,}(\\S.*?)[[:space:]]*$' -- $trimmed)
                if set -q pos_parts[2]
                    set -l pos_name $pos_parts[2]
                    set -l pos_desc (__opencode_strip_annotations $pos_parts[3])

                    set -l var_key
                    if test -z "$prefix"
                        set var_key (__opencode_sanitize_key $pos_name)
                    else
                        set var_key (__opencode_sanitize_key "$prefix")'_'(__opencode_sanitize_key $pos_name)
                    end
                    set -g "__opencode_pos_$var_key" $pos_desc
                end
        end
    end
end

# ---- Ensure help is cached for a given command prefix ----
function __opencode_ensure_cached --argument-names prefix
    set -l cache_key
    if test -z "$prefix"
        set cache_key "__root"
    else
        set cache_key (__opencode_sanitize_key "$prefix")
    end

    set -l cache_var "__opencode_cached_$cache_key"
    if set -q $cache_var
        return
    end
    set -g $cache_var 1
    __opencode_parse_help "$prefix"
end

# ---- Look up description for a completion item ----
function __opencode_get_desc
    set -l prefix $argv[1]
    set -l item $argv[2]

    if test -z "$item"
        return
    end

    set -l var_key
    if test -n "$prefix"
        set var_key (__opencode_sanitize_key "$prefix")'_'(__opencode_sanitize_key $item)
    else
        set var_key (__opencode_sanitize_key $item)
    end

    if string match -rq '^--' -- $item
        # Long option
        set -l var_name "__opencode_opt_$var_key"
        if set -q $var_name
            echo $$var_name
            return
        end
        set -l global_key (__opencode_sanitize_key $item)
        set -l global_var "__opencode_opt_$global_key"
        if set -q $global_var
            echo $$global_var
        end
    else if string match -rq '^-' -- $item
        # Short option
        set -l var_name "__opencode_opt_$var_key"
        if set -q $var_name
            echo $$var_name
            return
        end
        set -l global_key (__opencode_sanitize_key $item)
        set -l global_var "__opencode_opt_$global_key"
        if set -q $global_var
            echo $$global_var
        end
    else
        # Subcommand or positional
        set -l var_name "__opencode_cmd_$var_key"
        if set -q $var_name
            echo $$var_name
            return
        end
        set -l pos_var "__opencode_pos_$var_key"
        if set -q $pos_var
            echo $$pos_var
        end
    end
end

# ---- Main dynamic completion function ----
function __opencode_dynamic_complete
    set -l tokens (commandline -opc)
    set -l current_token (commandline -ct)

    __opencode_ensure_cached ""

    # Determine the subcommand context for description lookup
    set -l context ""
    if set -q tokens[2]
        set -l subcmd $tokens[2]
        __opencode_ensure_cached $subcmd
        set context $subcmd

        if set -q tokens[3]
            set -l subsub "$subcmd $tokens[3]"
            __opencode_ensure_cached $subsub
            set context $subsub
        end
    end

    # Get dynamic completions from yargs, appending current token for position awareness
    set -l completions (opencode --get-yargs-completions $tokens $current_token 2>/dev/null)

    for item in $completions
        if test "$item" = '\$0'
            continue
        end

        set -l desc (__opencode_get_desc "$context" $item)

        if test -n "$desc"
            printf "%s\\t%s\\n" $item $desc
        else
            printf "%s\\n" $item
        end
    end
end

# Register the single dynamic completer
complete -c opencode -f -a '(__opencode_dynamic_complete)'
`