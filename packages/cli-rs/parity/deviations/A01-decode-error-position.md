# A01: decode errors name a position, not a field path

TypeScript: the Promise client returns `JSON.parse` of the body without checking it against a schema
(`packages/client/src/promise/generated/client.ts:2825-2830`). Only a body that is not JSON fails, as
`ClientError("MalformedResponse")` with the parser's error as the cause.

Rust: responses decode into the generated types, so a body whose shape differs from the schema also fails
with `MalformedResponse`. The message is serde_json's, with the line and column of the failure:
``MalformedResponse: invalid type: integer `7`, expected a string at line 1 column 26``. It used to start
with the JSON path of the failing field (`data.ses_1.type: …`).

Reason: the path came from `serde_path_to_error`, which ran on every decode: about 80 more allocations per
message and 24 % more decode time, plus 2.6 MB of code and one crate. TypeScript has no equivalent message,
so the text differs from TypeScript either way. serde_json still names a missing field
(``missing field `id` ``), and the position locates the others.
