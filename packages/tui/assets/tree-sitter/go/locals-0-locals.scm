((function_declaration
  name: (identifier) @local.definition.function) ; @function
  )

((method_declaration
  name: (field_identifier) @local.definition.method) ; @function.method
  )

(short_var_declaration
  left: (expression_list
    (identifier) @local.definition.var))

(var_spec
  name: (identifier) @local.definition.var)

(parameter_declaration
  (identifier) @local.definition.var)

(variadic_parameter_declaration
  (identifier) @local.definition.var)

(for_statement
  (range_clause
    left: (expression_list
      (identifier) @local.definition.var)))

(const_declaration
  (const_spec
    name: (identifier) @local.definition.var))

(type_declaration
  (type_spec
    name: (type_identifier) @local.definition.type))

; reference
(identifier) @local.reference

(type_identifier) @local.reference

(field_identifier) @local.reference

((package_identifier) @local.reference
  (#set! reference.kind "namespace"))

(package_clause
  (package_identifier) @local.definition.namespace)

(import_spec_list
  (import_spec
    name: (package_identifier) @local.definition.namespace))

; Call references
((call_expression
  function: (identifier) @local.reference)
  (#set! reference.kind "call"))

((call_expression
  function: (selector_expression
    field: (field_identifier) @local.reference))
  (#set! reference.kind "call"))

((call_expression
  function: (parenthesized_expression
    (identifier) @local.reference))
  (#set! reference.kind "call"))

((call_expression
  function: (parenthesized_expression
    (selector_expression
      field: (field_identifier) @local.reference)))
  (#set! reference.kind "call"))

; Scopes
(func_literal) @local.scope

(source_file) @local.scope

(function_declaration) @local.scope

(if_statement) @local.scope

(block) @local.scope

(expression_switch_statement) @local.scope

(for_statement) @local.scope

(method_declaration) @local.scope
