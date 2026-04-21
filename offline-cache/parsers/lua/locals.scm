; Scopes
[
  (chunk)
  (do_statement)
  (while_statement)
  (repeat_statement)
  (if_statement)
  (for_statement)
  (function_declaration)
  (function_definition)
] @local.scope

; Definitions
(assignment_statement
  (variable_list
    (identifier) @local.definition))

(function_declaration
  name: (identifier) @local.definition)

(for_generic_clause
  (variable_list
    (identifier) @local.definition))

(for_numeric_clause
  name: (identifier) @local.definition)

(parameters
  (identifier) @local.definition)

; References
(identifier) @local.reference
