# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

## Scenario: Question Reply Image Answers

### 1. Scope / Trigger

- Trigger: Question replies cross the app UI, generated SDK, HTTP payload schema, `Question.Service`, and `question` tool result boundary.
- Use this contract whenever `Question.Answer`, SDK question reply types, or question tool result formatting changes.

### 2. Signatures

- Frontend reply payload: `sdk.client.question.reply({ requestID, answers })`.
- HTTP payload: `{ answers: Question.Answer[] }`.
- Backend schema: `Question.Answer = Array<Question.Part>`, where `Question.Part = string | Question.Image`.
- Image part schema: `{ type: "image"; mime: string; url: string; filename?: string }`.

### 3. Contracts

- Text answers stay plain strings and must not be interpreted as data URLs.
- Image answers must pass HTTP schema validation as objects, not be stringified.
- The `question` tool output text should format image parts as `[image: filename]` or `[image]`.
- The `question` tool part should persist image answers as `MessageV2.FilePart` attachments.
- `MessageV2.toModelMessages` must extract question image attachments into a follow-up user file message, not leave them as tool-result media.
- Image answer URLs must be normalized to one data URL prefix before becoming model-visible attachments.

### 4. Validation & Error Matrix

| Case                                                                                              | Expected Behavior                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `["Blue"]`                                                                                        | Accepted as a normal text answer.                                        |
| `[{ type: "image", mime: "image/png", url: "data:image/png;base64,AAAA" }]`                       | Accepted and emitted as one synthetic user file message attachment.      |
| `[{ type: "image", mime: "image/png", url: "data:image/png;base64,data:image/png;base64,AAAA" }]` | Accepted and normalized to `data:image/png;base64,AAAA` for model input. |
| `["data:image/png;base64,data:image/png;base64,AAAA"]`                                            | Preserved as a string answer; do not normalize it as an image.           |
| `[{ type: "image", mime: 1, url: "..." }]`                                                        | Rejected by schema validation.                                           |

### 5. Good/Base/Bad Cases

- Good: Keep generated SDK `QuestionAnswerPart = string | QuestionImageAnswer` aligned with backend `Question.Part`.
- Base: Text-only CLI and TUI question replies still send arrays of strings.
- Bad: Backend `Question.Answer = Array(String)` while the app sends image objects; this causes `Expected string, got {...}`.

### 6. Tests Required

- Schema test: `Question.Answer` accepts mixed string and image parts.
- Tool result test: image answers produce formatted text and persisted `attachments`.
- Model message test: question image attachments are extracted into a user `file` message.
- Regression test: nested image data URLs are normalized only for image objects, not plain string answers.

### 7. Wrong vs Correct

#### Wrong

```typescript
export const Answer = Schema.Array(Schema.String)
answers[i]?.join(", ")
```

#### Correct

```typescript
export const Part = Schema.Union([Schema.String, Image])
export const Answer = Schema.Array(Part)
answers[i]?.map(format).join(", ")
```

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
