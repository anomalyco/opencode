; Literals
(integer) @number

(float) @number.float

(complex) @number

(string) @string

(string
  (string_content
    (escape_sequence) @string.escape))

; Comments
(comment) @comment @spell

((program
  .
  (comment) @keyword.directive @nospell)
  (#match? @keyword.directive "^#!/"))

; Operators
[
  "?"
  ":="
  "="
  "<-"
  "<<-"
  "->"
  "->>"
  "~"
  "|>"
  "||"
  "|"
  "&&"
  "&"
  "<"
  "<="
  ">"
  ">="
  "=="
  "!="
  "+"
  "-"
  "*"
  "/"
  "::"
  ":::"
  "**"
  "^"
  "$"
  "@"
  ":"
  "!"
  "special"
] @operator

; Punctuation
[
  "("
  ")"
  "{"
  "}"
  "["
  "]"
  "[["
  "]]"
] @punctuation.bracket

(comma) @punctuation.delimiter

; Variables
(identifier) @variable

; Functions
(binary_operator
  lhs: (identifier) @function
  operator: "<-"
  rhs: (function_definition))

(binary_operator
  lhs: (identifier) @function
  operator: "="
  rhs: (function_definition))

; Calls
(call
  function: (identifier) @function.call)

(extract_operator
  rhs: (identifier) @variable.member)

function: (extract_operator
  rhs: (identifier) @function.method.call)

; Parameters
(parameters
  (parameter
    name: (identifier) @variable.parameter))

(arguments
  (argument
    name: (identifier) @variable.parameter))

; Namespace
(namespace_operator
  lhs: (identifier) @module)

(call
  function: (namespace_operator
    rhs: (identifier) @function))

; Keywords
(function_definition
  name: "function" @keyword.function)

(function_definition
  name: "\\" @operator)

(return) @keyword.return

[
  "if"
  "else"
] @keyword.conditional

[
  "while"
  "repeat"
  "for"
  "in"
  (break)
  (next)
] @keyword.repeat

[
  (true)
  (false)
] @boolean

[
  (null)
  (inf)
  (nan)
  (na)
  (dots)
  (dot_dot_i)
] @constant.builtin
