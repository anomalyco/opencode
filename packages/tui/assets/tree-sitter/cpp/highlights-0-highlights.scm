; inherits: c

((identifier) @variable.member
  (#lua-match? @variable.member "^m_.*$"))

(parameter_declaration
  declarator: (reference_declarator) @variable.parameter)

; function(Foo ...foo)
(variadic_parameter_declaration
  declarator: (variadic_declarator
    (_) @variable.parameter))

; int foo = 0
(optional_parameter_declaration
  declarator: (_) @variable.parameter)

;(field_expression) @variable.parameter ;; How to highlight this?
((field_expression
  (field_identifier) @function.method) @_parent
  (#has-parent? @_parent template_method function_declarator))

(field_declaration
  (field_identifier) @variable.member)

(field_initializer
  (field_identifier) @property)

(function_declarator
  declarator: (field_identifier) @function.method)

(concept_definition
  name: (identifier) @type.definition)

(alias_declaration
  name: (type_identifier) @type.definition)

(auto) @type.builtin

(namespace_identifier) @module

((namespace_identifier) @type
  (#lua-match? @type "^[%u]"))

(case_statement
  value: (qualified_identifier
    (identifier) @constant))

(using_declaration
  .
  "using"
  .
  "namespace"
  .
  [
    (qualified_identifier)
    (identifier)
  ] @module)

(destructor_name
  (identifier) @function.method)

; functions
(function_declarator
  (qualified_identifier
    (identifier) @function))

(function_declarator
  (qualified_identifier
    (qualified_identifier
      (identifier) @function)))

(function_declarator
  (qualified_identifier
    (qualified_identifier
      (qualified_identifier
        (identifier) @function))))

((qualified_identifier
  (qualified_identifier
    (qualified_identifier
      (qualified_identifier
        (identifier) @function)))) @_parent
  (#has-ancestor? @_parent function_declarator))

(function_declarator
  (template_function
    (identifier) @function))

(operator_name) @function

"operator" @function

"static_assert" @function.builtin

(call_expression
  (qualified_identifier
    (identifier) @function.call))

(call_expression
  (qualified_identifier
    (qualified_identifier
      (identifier) @function.call)))

(call_expression
  (qualified_identifier
    (qualified_identifier
      (qualified_identifier
        (identifier) @function.call))))

((qualified_identifier
  (qualified_identifier
    (qualified_identifier
      (qualified_identifier
        (identifier) @function.call)))) @_parent
  (#has-ancestor? @_parent call_expression))

(call_expression
  (template_function
    (identifier) @function.call))

(call_expression
  (qualified_identifier
    (template_function
      (identifier) @function.call)))

(call_expression
  (qualified_identifier
    (qualified_identifier
      (template_function
        (identifier) @function.call))))

(call_expression
  (qualified_identifier
    (qualified_identifier
      (qualified_identifier
        (template_function
          (identifier) @function.call)))))

((qualified_identifier
  (qualified_identifier
    (qualified_identifier
      (qualified_identifier
        (template_function
          (identifier) @function.call))))) @_parent
  (#has-ancestor? @_parent call_expression))

; methods
(function_declarator
  (template_method
    (field_identifier) @function.method))

(call_expression
  (field_expression
    (field_identifier) @function.method.call))

; constructors
((function_declarator
  (qualified_identifier
    (identifier) @constructor))
  (#lua-match? @constructor "^%u"))

((call_expression
  function: (identifier) @constructor)
  (#lua-match? @constructor "^%u"))

((call_expression
  function: (qualified_identifier
    name: (identifier) @constructor))
  (#lua-match? @constructor "^%u"))

((call_expression
  function: (field_expression
    field: (field_identifier) @constructor))
  (#lua-match? @constructor "^%u"))

; constructing a type in an initializer list: Constructor ():  **SuperType (1)**
((field_initializer
  (field_identifier) @constructor
  (argument_list))
  (#lua-match? @constructor "^%u"))

; Constants
(this) @variable.builtin

(null
  "nullptr" @constant.builtin)

(true) @boolean

(false) @boolean

; Literals
(raw_string_literal) @string

; Keywords
[
  "try"
  "catch"
  "noexcept"
  "throw"
] @keyword.exception

[
  "decltype"
  "explicit"
  "friend"
  "override"
  "using"
  "requires"
  "constexpr"
] @keyword

[
  "class"
  "namespace"
  "template"
  "typename"
  "concept"
] @keyword.type

[
  "co_await"
  "co_yield"
  "co_return"
] @keyword.coroutine

[
  "public"
  "private"
  "protected"
  "final"
  "virtual"
] @keyword.modifier

[
  "new"
  "delete"
  "xor"
  "bitand"
  "bitor"
  "compl"
  "not"
  "xor_eq"
  "and_eq"
  "or_eq"
  "not_eq"
  "and"
  "or"
] @keyword.operator

"<=>" @operator

"::" @punctuation.delimiter

(template_argument_list
  [
    "<"
    ">"
  ] @punctuation.bracket)

(template_parameter_list
  [
    "<"
    ">"
  ] @punctuation.bracket)

(literal_suffix) @operator
