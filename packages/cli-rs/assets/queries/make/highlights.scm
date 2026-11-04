(comment) @comment @spell

(conditional
  (_
    [
      "ifeq"
      "else"
      "ifneq"
      "ifdef"
      "ifndef"
    ] @keyword.conditional)
  "endif" @keyword.conditional)

(rule
  (targets
    (word) @function))

(rule
  (targets) @_target
  (prerequisites
    (word) @function
    (#eq? @_target ".PHONY")))

(rule
  (targets
    (word) @function.builtin
    (#any-of? @function.builtin
      ".DEFAULT" ".SUFFIXES" ".DELETE_ON_ERROR" ".EXPORT_ALL_VARIABLES" ".IGNORE" ".INTERMEDIATE"
      ".LOW_RESOLUTION_TIME" ".NOTPARALLEL" ".ONESHELL" ".PHONY" ".POSIX" ".PRECIOUS" ".SECONDARY"
      ".SECONDEXPANSION" ".SILENT" ".SUFFIXES")))

(rule
  [
    "&:"
    ":"
    "::"
    "|"
  ] @operator)

[
  "export"
  "unexport"
] @keyword.import

(override_directive
  "override" @keyword)

(include_directive
  [
    "include"
    "-include"
  ] @keyword.import
  filenames: (list
    (word) @string.special.path))

(variable_assignment
  name: (word) @string.special.symbol
  [
    "?="
    ":="
    "::="
    ; ":::="
    "+="
    "="
  ] @operator)

(shell_assignment
  name: (word) @string.special.symbol
  "!=" @operator)

(define_directive
  "define" @keyword
  name: (word) @string.special.symbol
  [
    "="
    ":="
    "::="
    ; ":::="
    "?="
    "!="
  ]? @operator
  "endef" @keyword)

(variable_assignment
  (word) @variable.builtin
  (#any-of? @variable.builtin
    ".DEFAULT_GOAL" ".EXTRA_PREREQS" ".FEATURES" ".INCLUDE_DIRS" ".RECIPEPREFIX" ".SHELLFLAGS"
    ".VARIABLES" "MAKEARGS" "MAKEFILE_LIST" "MAKEFLAGS" "MAKE_RESTARTS" "MAKE_TERMERR"
    "MAKE_TERMOUT" "SHELL"))

; Use string to match bash
(variable_reference
  (word) @string) @operator

(shell_function
  [
    "$"
    "("
    ")"
  ] @operator
  "shell" @function.builtin)

(function_call
  [
    "$"
    "("
    ")"
  ] @operator)

(substitution_reference
  [
    "$"
    "("
    ")"
  ] @operator)

(automatic_variable
  "$"
  _ @character.special
  (#set! priority 105))

(automatic_variable
  [
    "$"
    "("
    ")"
  ] @operator
  (#set! priority 105))

(recipe_line
  "@" @character.special)

(function_call
  [
    "subst"
    "patsubst"
    "strip"
    "findstring"
    "filter"
    "filter-out"
    "sort"
    "word"
    "words"
    "wordlist"
    "firstword"
    "lastword"
    "dir"
    "notdir"
    "suffix"
    "basename"
    "addsuffix"
    "addprefix"
    "join"
    "wildcard"
    "realpath"
    "abspath"
    "error"
    "warning"
    "info"
    "origin"
    "flavor"
    "foreach"
    "if"
    "or"
    "and"
    "call"
    "eval"
    "file"
    "value"
  ] @function.builtin)
