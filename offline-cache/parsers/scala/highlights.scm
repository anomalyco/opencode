; CREDITS @stumash (stuart.mashaal@gmail.com)
(class_definition
  name: (identifier) @type)

(enum_definition
  name: (identifier) @type)

(object_definition
  name: (identifier) @type)

(trait_definition
  name: (identifier) @type)

(full_enum_case
  name: (identifier) @type)

(simple_enum_case
  name: (identifier) @type)

; variables
(class_parameter
  name: (identifier) @variable.parameter)

(self_type
  (identifier) @variable.parameter)

(interpolation
  (identifier) @none)

(interpolation
  (block) @none)

; types
(type_definition
  name: (type_identifier) @type.definition)

(type_identifier) @type

; val/var definitions/declarations
(val_definition
  pattern: (identifier) @variable)

(var_definition
  pattern: (identifier) @variable)

(val_declaration
  name: (identifier) @variable)

(var_declaration
  name: (identifier) @variable)

; method definition
(function_declaration
  name: (identifier) @function.method)

(function_definition
  name: (identifier) @function.method)

; imports/exports
(import_declaration
  path: (identifier) @module)

(stable_identifier
  (identifier) @module)

((import_declaration
  path: (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

((stable_identifier
  (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

(export_declaration
  path: (identifier) @module)

(stable_identifier
  (identifier) @module)

((export_declaration
  path: (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

((stable_identifier
  (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

((namespace_selectors
  (identifier) @type)
  (#lua-match? @type "^[A-Z]"))

; method invocation
(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (operator_identifier) @function.call)

(call_expression
  function: (field_expression
    field: (identifier) @function.method.call))

((call_expression
  function: (identifier) @constructor)
  (#lua-match? @constructor "^[A-Z]"))

(generic_function
  function: (identifier) @function.call)

(interpolated_string_expression
  interpolator: (identifier) @function.call)

; function definitions
(function_definition
  name: (identifier) @function)

(parameter
  name: (identifier) @variable.parameter)

(binding
  name: (identifier) @variable.parameter)

(lambda_expression
  parameters: (identifier) @variable.parameter)

; expressions
(field_expression
  field: (identifier) @variable.member)

(field_expression
  value: (identifier) @type
  (#lua-match? @type "^[A-Z]"))

(infix_expression
  operator: (identifier) @operator)

(infix_expression
  operator: (operator_identifier) @operator)

(infix_type
  operator: (operator_identifier) @operator)

(infix_type
  operator: (operator_identifier) @operator)

; literals
(boolean_literal) @boolean

(integer_literal) @number

(floating_point_literal) @number.float

[
  (string)
  (interpolated_string_expression)
] @string

(character_literal) @character

(interpolation
  "$" @punctuation.special)

; keywords
(opaque_modifier) @keyword.modifier

(infix_modifier) @keyword

(transparent_modifier) @keyword.modifier

(open_modifier) @keyword.modifier

[
  "case"
  "extends"
  "derives"
  "finally"
  ; `forSome` existential types not implemented yet
  ; `macro` not implemented yet
  "object"
  "override"
  "val"
  "var"
  "with"
  "given"
  "using"
  "end"
  "implicit"
  "extension"
  "with"
] @keyword

[
  "enum"
  "class"
  "trait"
  "type"
] @keyword.type

[
  "abstract"
  "final"
  "lazy"
  "sealed"
  "private"
  "protected"
] @keyword.modifier

(inline_modifier) @keyword.modifier

(null_literal) @constant.builtin

(wildcard
  "_") @character.special

(namespace_wildcard
  [
    "*"
    "_"
  ] @character.special)

(annotation) @attribute

; special keywords
"new" @keyword.operator

[
  "else"
  "if"
  "match"
  "then"
] @keyword.conditional

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  "."
  ","
  ":"
] @punctuation.delimiter

[
  "do"
  "for"
  "while"
  "yield"
] @keyword.repeat

"def" @keyword.function

[
  "=>"
  "?=>"
  "="
  "!"
  "<-"
  "@"
] @operator

[
  "import"
  "export"
  "package"
] @keyword.import

[
  "try"
  "catch"
  "throw"
] @keyword.exception

"return" @keyword.return

[
  (comment)
  (block_comment)
] @comment @spell

((block_comment) @comment.documentation
  (#lua-match? @comment.documentation "^/[*][*][^*].*[*]/$"))

; `case` is a conditional keyword in case_block
(case_block
  (case_clause
    "case" @keyword.conditional))

(case_block
  (case_clause
    "=>" @punctuation.delimiter))

(operator_identifier) @operator

((identifier) @type
  (#lua-match? @type "^[A-Z]"))

((identifier) @variable.builtin
  (#lua-match? @variable.builtin "^this$"))

((identifier) @function.builtin
  (#lua-match? @function.builtin "^super$"))

; Scala CLI using directives
(using_directive_key) @variable.parameter

(using_directive_value) @string
