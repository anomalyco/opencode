(identifier) @variable

((identifier) @constant
  (#match? @constant "^[A-Z][A-Z_0-9]*$"))

; Keywords
[
  "if"
  "else"
  "elseif"
  "endif"
] @keyword.conditional

[
  "try"
  "catch"
  "finally"
  "endtry"
  "throw"
] @keyword.exception

[
  "for"
  "endfor"
  "in"
  "while"
  "endwhile"
  "break"
  "continue"
] @keyword.repeat

[
  "function"
  "endfunction"
] @keyword.function

; Function related
(function_declaration
  name: (_) @function)

(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (scoped_identifier
    (identifier) @function.call))

(parameters
  (identifier) @variable.parameter)

(default_parameter
  (identifier) @variable.parameter)

[
  (bang)
  (spread)
] @punctuation.special

[
  (no_option)
  (inv_option)
  (default_option)
  (option_name)
] @variable.builtin

[
  (scope)
  "a:"
  "$"
] @module

; Commands and user defined commands
[
  "let"
  "unlet"
  "const"
  "call"
  "execute"
  "normal"
  "set"
  "setfiletype"
  "setlocal"
  "silent"
  "echo"
  "echon"
  "echohl"
  "echomsg"
  "echoerr"
  "autocmd"
  "augroup"
  "return"
  "syntax"
  "filetype"
  "source"
  "lua"
  "ruby"
  "perl"
  "python"
  "highlight"
  "command"
  "delcommand"
  "comclear"
  "colorscheme"
  "scriptencoding"
  "startinsert"
  "stopinsert"
  "global"
  "runtime"
  "wincmd"
  "cnext"
  "cprevious"
  "cNext"
  "vertical"
  "leftabove"
  "aboveleft"
  "rightbelow"
  "belowright"
  "topleft"
  "botright"
  (unknown_command_name)
  "edit"
  "enew"
  "find"
  "ex"
  "visual"
  "view"
  "eval"
  "sign"
  "abort"
] @keyword

(map_statement
  cmd: _ @keyword)

(keycode) @character.special

(command_name) @function.macro

; Filetype command
(filetype_statement
  [
    "detect"
    "plugin"
    "indent"
    "on"
    "off"
  ] @keyword)

; Syntax command
(syntax_statement
  (keyword) @string)

(syntax_statement
  [
    "enable"
    "on"
    "off"
    "reset"
    "case"
    "spell"
    "foldlevel"
    "iskeyword"
    "keyword"
    "match"
    "cluster"
    "region"
    "clear"
    "include"
  ] @keyword)

(syntax_argument
  name: _ @keyword)

[
  "<buffer>"
  "<nowait>"
  "<silent>"
  "<script>"
  "<expr>"
  "<unique>"
] @constant.builtin

(augroup_name) @module

(au_event) @constant

(normal_statement
  (commands) @constant)

; Highlight command
(hl_attribute
  key: _ @property
  val: _ @constant)

(hl_group) @type

(highlight_statement
  [
    "default"
    "link"
    "clear"
  ] @keyword)

; Command command
(command) @string

(command_attribute
  name: _ @property
  val: (behavior
    name: _ @constant
    val: (identifier)? @function)?)

; Edit command
(plus_plus_opt
  val: _? @constant) @property

(plus_cmd
  "+" @property) @property

; Runtime command
(runtime_statement
  (where) @keyword.operator)

; Colorscheme command
(colorscheme_statement
  (name) @string)

; Scriptencoding command
(scriptencoding_statement
  (encoding) @string.special)

; Literals
(string_literal) @string

(integer_literal) @number

(float_literal) @number.float

(comment) @comment @spell

(line_continuation_comment) @comment @spell

(pattern) @string.special

(pattern_multi) @string.regexp

(filename) @string.special.path

(heredoc
  (body) @string)

(heredoc
  (parameter) @keyword)

[
  (marker_definition)
  (endmarker)
] @label

(literal_dictionary
  (literal_key) @property)

((scoped_identifier
  (scope) @_scope
  .
  (identifier) @boolean)
  (#eq? @_scope "v:")
  (#any-of? @boolean "true" "false"))

; Operators
[
  "||"
  "&&"
  "&"
  "+"
  "-"
  "*"
  "/"
  "%"
  ".."
  "=="
  "!="
  ">"
  ">="
  "<"
  "<="
  "=~"
  "!~"
  "="
  "^="
  "+="
  "-="
  "*="
  "/="
  "%="
  ".="
  "..="
  "<<"
  "=<<"
  "->"
  (match_case)
] @operator

[
  "is"
  "isnot"
] @keyword.operator

; Some characters have different meanings based on the context
(unary_operation
  "!" @operator)

(binary_operation
  "." @operator)

; Punctuation
[
  "("
  ")"
  "{"
  "}"
  "["
  "]"
  "#{"
] @punctuation.bracket

(field_expression
  "." @punctuation.delimiter)

[
  ","
  ":"
] @punctuation.delimiter

(ternary_expression
  [
    "?"
    ":"
  ] @keyword.conditional.ternary)

; Options
((set_value) @number
  (#lua-match? @number "^[%d]+(%.[%d]+)?$"))

(inv_option
  "!" @operator)

(set_item
  "?" @operator)

((set_item
  option: (option_name) @_option
  value: (set_value) @function)
  (#any-of? @_option "tagfunc" "tfu" "completefunc" "cfu" "omnifunc" "ofu" "operatorfunc" "opfunc"))
