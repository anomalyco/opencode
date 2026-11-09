; CREDITS @maxbrunsfeld (maxbrunsfeld@gmail.com)
; Variables
(identifier) @variable

(underscore_pattern) @character.special

; Methods
(method_declaration
  name: (identifier) @function.method)

(method_invocation
  name: (identifier) @function.method.call)

(super) @function.builtin

; Parameters
(formal_parameter
  name: (identifier) @variable.parameter)

(spread_parameter
  (variable_declarator
    name: (identifier) @variable.parameter)) ; int... foo

; Lambda parameter
(inferred_parameters
  (identifier) @variable.parameter) ; (x,y) -> ...

(lambda_expression
  parameters: (identifier) @variable.parameter) ; x -> ...

; Operators
[
  "+"
  ":"
  "++"
  "-"
  "--"
  "&"
  "&&"
  "|"
  "||"
  "!"
  "!="
  "=="
  "*"
  "/"
  "%"
  "<"
  "<="
  ">"
  ">="
  "="
  "-="
  "+="
  "*="
  "/="
  "%="
  "->"
  "^"
  "^="
  "&="
  "|="
  "~"
  ">>"
  ">>>"
  "<<"
  "::"
] @operator

; Types
(interface_declaration
  name: (identifier) @type)

(annotation_type_declaration
  name: (identifier) @type)

(class_declaration
  name: (identifier) @type)

(record_declaration
  name: (identifier) @type)

(enum_declaration
  name: (identifier) @type)

(constructor_declaration
  name: (identifier) @type)

(compact_constructor_declaration
  name: (identifier) @type)

(type_identifier) @type

((type_identifier) @type.builtin
  (#eq? @type.builtin "var"))

((method_invocation
  object: (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

((method_reference
  .
  (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

((field_access
  object: (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

(scoped_identifier
  (identifier) @type
  (#lua-match? @type "^[A-Z]"))

; Fields
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @variable.member))

(field_access
  field: (identifier) @variable.member)

[
  (boolean_type)
  (integral_type)
  (floating_point_type)
  (void_type)
] @type.builtin

; Variables
((identifier) @constant
  (#lua-match? @constant "^[A-Z_][A-Z%d_]+$"))

(this) @variable.builtin

; Annotations
(annotation
  "@" @attribute
  name: (identifier) @attribute)

(marker_annotation
  "@" @attribute
  name: (identifier) @attribute)

; Literals
(string_literal) @string

(escape_sequence) @string.escape

(character_literal) @character

[
  (hex_integer_literal)
  (decimal_integer_literal)
  (octal_integer_literal)
  (binary_integer_literal)
] @number

[
  (decimal_floating_point_literal)
  (hex_floating_point_literal)
] @number.float

[
  (true)
  (false)
] @boolean

(null_literal) @constant.builtin

; Keywords
[
  "assert"
  "default"
  "extends"
  "implements"
  "instanceof"
  "@interface"
  "permits"
  "to"
  "with"
] @keyword

[
  "record"
  "class"
  "enum"
  "interface"
] @keyword.type

(synchronized_statement
  "synchronized" @keyword)

[
  "abstract"
  "final"
  "native"
  "non-sealed"
  "open"
  "private"
  "protected"
  "public"
  "sealed"
  "static"
  "strictfp"
  "transitive"
] @keyword.modifier

(modifiers
  "synchronized" @keyword.modifier)

[
  "transient"
  "volatile"
] @keyword.modifier

[
  "return"
  "yield"
] @keyword.return

"new" @keyword.operator

; Conditionals
[
  "if"
  "else"
  "switch"
  "case"
  "when"
] @keyword.conditional

(ternary_expression
  [
    "?"
    ":"
  ] @keyword.conditional.ternary)

; Loops
[
  "for"
  "while"
  "do"
  "continue"
  "break"
] @keyword.repeat

; Includes
[
  "exports"
  "import"
  "module"
  "opens"
  "package"
  "provides"
  "requires"
  "uses"
] @keyword.import

(import_declaration
  (asterisk
    "*" @character.special))

; Punctuation
[
  ";"
  "."
  "..."
  ","
] @punctuation.delimiter

[
  "{"
  "}"
] @punctuation.bracket

[
  "["
  "]"
] @punctuation.bracket

[
  "("
  ")"
] @punctuation.bracket

(type_arguments
  [
    "<"
    ">"
  ] @punctuation.bracket)

(type_parameters
  [
    "<"
    ">"
  ] @punctuation.bracket)

(string_interpolation
  [
    "\\{"
    "}"
  ] @punctuation.special)

; Exceptions
[
  "throw"
  "throws"
  "finally"
  "try"
  "catch"
] @keyword.exception

; Labels
(labeled_statement
  (identifier) @label)

; Comments
[
  (line_comment)
  (block_comment)
] @comment @spell

((block_comment) @comment.documentation
  (#lua-match? @comment.documentation "^/[*][*][^*].*[*]/$"))

((line_comment) @comment.documentation
  (#lua-match? @comment.documentation "^///[^/]"))

((line_comment) @comment.documentation
  (#lua-match? @comment.documentation "^///$"))
