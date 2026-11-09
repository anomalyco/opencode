; Functions definitions
(function_declarator
  declarator: (identifier) @local.definition.function)

(preproc_function_def
  name: (identifier) @local.definition.macro) @local.scope

(preproc_def
  name: (identifier) @local.definition.macro)

(pointer_declarator
  declarator: (identifier) @local.definition.var)

(parameter_declaration
  declarator: (identifier) @local.definition.parameter)

(init_declarator
  declarator: (identifier) @local.definition.var)

(array_declarator
  declarator: (identifier) @local.definition.var)

(declaration
  declarator: (identifier) @local.definition.var)

(enum_specifier
  name: (_) @local.definition.type
  (enumerator_list
    (enumerator
      name: (identifier) @local.definition.var)))

; Type / Struct / Enum
(field_declaration
  declarator: (field_identifier) @local.definition.field)

(type_definition
  declarator: (type_identifier) @local.definition.type)

(struct_specifier
  name: (type_identifier) @local.definition.type)

; goto
(labeled_statement
  (statement_identifier) @local.definition)

; References
(identifier) @local.reference

((field_identifier) @local.reference
  (#set! reference.kind "field"))

((type_identifier) @local.reference
  (#set! reference.kind "type"))

(goto_statement
  (statement_identifier) @local.reference)

; Scope
[
  (for_statement)
  (if_statement)
  (while_statement)
  (translation_unit)
  (function_definition)
  (compound_statement) ; a block in curly braces
  (struct_specifier)
] @local.scope
