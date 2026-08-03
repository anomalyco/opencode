## ADDED Requirements

### Requirement: Deterministic single-line answer
The system SHALL generate each inventory answer line with a deterministic formatter and MUST NOT pass raw database rows to the model for free-form presentation.

#### Scenario: Complete answer object
- **WHEN** the answer object contains name `6001ZZ`, attribute `清油`, size `12×28×8`, shelf `B-11-13`, supplier `上海涂众轴承`, inventory `200`, and remark `xxx`
- **THEN** the output is exactly `6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx`

### Requirement: Fixed field order and punctuation
The formatter SHALL order fields as business name, optional attribute, optional normalized size, optional shelf group, optional supplier, inventory label and quantity, and optional remark. It MUST use full-width Chinese parentheses and `，备注：` exactly as specified.

#### Scenario: Optional fields are present
- **WHEN** attribute, size, shelves, supplier, quantity, and remark are available
- **THEN** every field appears once in the fixed order with no added label other than `货架号：`, `库存`, and `备注：`

#### Scenario: Optional fields are absent
- **WHEN** one or more optional fields are empty or null
- **THEN** the formatter omits those fields and their paired punctuation without outputting `无`, `—`, `未归属`, empty parentheses, or a dangling comma

### Requirement: Inventory wording
The formatter SHALL place the exact word `库存` immediately before the formatted quantity. When a supplier exists, the supplier name SHALL immediately precede `库存`; the output MUST NOT contain `来货` or `数量`.

#### Scenario: Supplier is present
- **WHEN** supplier `上海涂众轴承` has inventory `200`
- **THEN** the inventory fragment is exactly `上海涂众轴承库存200`

#### Scenario: Supplier is absent
- **WHEN** inventory is `200` and no supplier is attributed
- **THEN** the inventory fragment is exactly `库存200`

### Requirement: Normalized size and shelves
The formatter SHALL normalize recognized dimension separators `*`, `x`, and `X` to `×`. It SHALL render ordered unique shelf codes inside one `（货架号：...）` group separated by `、`.

#### Scenario: ASCII dimension
- **WHEN** the mapped size is `12*28*8`
- **THEN** the rendered size is `（12×28×8）`

#### Scenario: Multiple shelves
- **WHEN** the mapped shelf codes are `B-11-13`, `B-11-2`, and another `B-11-13`
- **THEN** the rendered shelf fragment contains each unique shelf once using the mapper's deterministic order and `、` separators

### Requirement: One result per line
The formatter SHALL join multiple answer objects using exactly one newline and MUST NOT add bullets, numbering, blank lines, headings, introductions, match counts, summaries, explanations, or closing questions.

#### Scenario: Multiple results
- **WHEN** three answer objects are formatted
- **THEN** the final answer contains exactly three non-empty lines and no surrounding text

### Requirement: Internal identifiers never appear
The answer-domain type and formatter SHALL exclude `Product.s_ID`, `Product.u_Code`, `SP000...` identifiers, supplier IDs, warehouse IDs, and other internal keys.

#### Scenario: Query rows contain internal identifiers
- **WHEN** the MySQL adapter uses internal identifiers to join product, shelf, inventory, and supplier rows
- **THEN** none of those identifiers is present in the answer object or final text

#### Scenario: Model requests a code column
- **WHEN** prompt text asks the tool or formatter to include an internal product code
- **THEN** the formatter ignores that instruction and produces the fixed allowlisted format

### Requirement: Remark fidelity
The formatter SHALL use only the mapped `Product.u_Remark` value as the remark, SHALL NOT reinterpret it as a model, size, supplier, or shelf, and SHALL keep one answer object on one physical line.

#### Scenario: Remark contains ordinary text
- **WHEN** `Product.u_Remark` is `2024-7-20`
- **THEN** the answer ends with `，备注：2024-7-20`

#### Scenario: Remark contains a line break
- **WHEN** a remark contains CR or LF characters
- **THEN** the formatter replaces the line break with a single space without otherwise rewriting the remark content

### Requirement: Plain-text output
The final answer SHALL be plain text and MUST NOT contain a Markdown table, HTML table, code fence, or Feishu rich-card structure.

#### Scenario: Table-like model preference
- **WHEN** upstream model context suggests a table or “完整汇总”
- **THEN** the final answer still contains only fixed plain-text result lines
