[
  (line_comment)
  (block_comment)
] @comment @spell

((line_comment) @comment.documentation @spell
  (#match? @comment.documentation "^///"))

(const
  [
    (_) @constant
    (unit) @constant.builtin
  ])

(primary_constr_args
  (_) @variable.parameter)

(class_as_reference
  (_) @variable.parameter.builtin)

(type_name
  type_name: (_) @type.definition)

[
  (_type)
  (atomic_type)
] @type

(member_signature
  .
  (identifier) @function.method)

(member_signature
  (curried_spec
    (arguments_spec
      (argument_spec
        (argument_name_spec
          "?"? @character.special
          name: (_) @variable.parameter)))))

(union_type_case
  (identifier) @constant)

(rules
  (rule
    pattern: (_) @constant
    block: (_)))

(wildcard_pattern) @character.special

(identifier_pattern
  .
  (_) @constant
  .
  (_) @variable)

(optional_pattern
  "?" @character.special)

(fsi_directive_decl
  .
  (string) @module)

(import_decl
  .
  (_) @module)

(named_module
  name: (_) @module)

(namespace
  name: (_) @module)

(module_defn
  (identifier) @module)

(ce_expression
  .
  (_) @constant.macro)

(field_initializer
  field: (_) @property)

(record_fields
  (record_field
    .
    (identifier) @property))

(value_declaration_left
  .
  (_) @variable)

(function_declaration_left
  .
  (_) @function)

(argument_patterns
  [
    (const)
    (long_identifier)
    (_pattern)
  ] @variable.parameter)

(argument_patterns
  (typed_pattern
    (_pattern) @variable.parameter
    (_type) @type))

(argument_patterns
  (record_pattern
    (field_pattern
      .
      (long_identifier) @variable.parameter)))

(argument_patterns
  (array_pattern
    (_pattern)? @variable.parameter))

(argument_patterns
  (list_pattern
    (_pattern)? @variable.parameter))

((argument_patterns
  (long_identifier
    (identifier) @character.special))
  (#lua-match? @character.special "^\_.*"))

(member_defn
  (method_or_prop_defn
    [
      (property_or_ident) @function
      (property_or_ident
        instance: (identifier) @variable.parameter.builtin
        method: (identifier) @function.method)
    ]
    args: (_)* @variable.parameter))

(dot_expression
  .
  (_) @variable.member
  .
  (_))

(application_expression
  .
  (_) @function.call
  .
  (_) @variable)

((infix_expression
  .
  (_)
  .
  (infix_op) @operator
  .
  (_) @function.call)
  (#eq? @operator "|>"))

((infix_expression
  .
  (_) @function.call
  .
  (infix_op) @operator
  .
  (_))
  (#eq? @operator "<|"))

[
  (xint)
  (int)
  (int16)
  (uint16)
  (int32)
  (uint32)
  (int64)
  (uint64)
  (nativeint)
  (unativeint)
] @number

[
  (ieee32)
  (ieee64)
  (float)
  (decimal)
] @number.float

(bool) @boolean

[
  (string)
  (triple_quoted_string)
  (verbatim_string)
  (char)
] @spell @string

(compiler_directive_decl) @keyword.directive

(preproc_line
  "#line" @keyword.directive)

(attribute
  target: (identifier)? @keyword
  (_type) @attribute)

[
  "("
  ")"
  "{"
  "}"
  ".["
  "["
  "]"
  "[|"
  "|]"
  "{|"
  "|}"
] @punctuation.bracket

[
  "[<"
  ">]"
] @punctuation.special

(format_string_eval
  [
    "{"
    "}"
  ] @punctuation.special)

[
  ","
  ";"
  ":"
  "."
] @punctuation.delimiter

[
  "|"
  "="
  ">"
  "<"
  "-"
  "~"
  "->"
  "<-"
  "&"
  "&&"
  "|"
  "||"
  ":>"
  ":?>"
  ".."
  "*"
  (infix_op)
  (prefix_op)
  (op_identifier)
] @operator

(generic_type
  [
    "<"
    ">"
  ] @punctuation.bracket)

[
  "if"
  "then"
  "else"
  "elif"
  "when"
  "match"
  "match!"
] @keyword.conditional

[
  "and"
  "or"
  "not"
  "upcast"
  "downcast"
] @keyword.operator

[
  "return"
  "return!"
  "yield"
  "yield!"
] @keyword.return

[
  "for"
  "while"
  "downto"
  "to"
] @keyword.repeat

[
  "open"
  "#r"
  "#load"
] @keyword.import

[
  "abstract"
  "delegate"
  "static"
  "inline"
  "mutable"
  "override"
  "rec"
  "global"
  (access_modifier)
] @keyword.modifier

[
  "let"
  "let!"
  "use"
  "use!"
  "member"
] @keyword.function

[
  "enum"
  "type"
  "inherit"
  "interface"
  "and"
  "class"
  "struct"
] @keyword.type

((identifier) @keyword.exception
  (#any-of? @keyword.exception "failwith" "failwithf" "raise" "reraise"))

[
  "as"
  "assert"
  "begin"
  "end"
  "done"
  "default"
  "in"
  "do"
  "do!"
  "fun"
  "function"
  "get"
  "set"
  "lazy"
  "new"
  "of"
  "struct"
  "val"
  "module"
  "namespace"
  "with"
] @keyword

[
  "null"
  (unit)
] @constant.builtin

(match_expression
  "with" @keyword.conditional)

(try_expression
  [
    "try"
    "with"
    "finally"
  ] @keyword.exception)

(application_expression
  (unit) @function.call)

((_type
  (long_identifier
    (identifier) @type.builtin))
  (#any-of? @type.builtin
    "bool" "byte" "sbyte" "int16" "uint16" "int" "uint" "int64" "uint64" "nativeint" "unativeint"
    "decimal" "float" "double" "float32" "single" "char" "string" "unit"))

(preproc_if
  [
    "#if" @keyword.directive
    "#endif" @keyword.directive
  ]
  condition: (_)? @keyword.directive)

(preproc_else
  "#else" @keyword.directive)

((identifier) @module.builtin
  (#any-of? @module.builtin
    "Array" "Async" "Directory" "File" "List" "Option" "Path" "Map" "Set" "Lazy" "Seq" "Task"
    "String" "Result"))

((value_declaration
  (attributes
    (attribute
      (_type
        (long_identifier
          (identifier) @attribute))))
  (function_or_value_defn
    (value_declaration_left
      .
      (_) @constant)))
  (#eq? @attribute "Literal"))
