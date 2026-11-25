# Push Notification Format

Status: **Current contract.** Core builds these messages in `packages/core/src/push/watcher.ts` and `sender.ts`. This document is for anyone writing a phone client.

## The Message

A phone registers with `PUT /api/experimental/push/device/:deviceID`. The server then sends each notification through the relay as an encrypted box. Inside the box is one JSON object, the message. The relay never sees it.

Every message has this envelope:

| Key         | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `v`         | Format version, `1`.                                                                                 |
| `id`        | What a later `clear` names: the permission request, the form, or the session for a finished turn.    |
| `type`      | `permission`, `question`, `session.idle` or `clear`.                                                 |
| `sessionID` | The top-level session: the one to open on tap, and the one bells apply to.                           |
| `time`      | When the event happened, in ms since the epoch. For `clear`, when the event that caused it happened. |
| `title`     | The session's title, or "OpenCode". Not sent on `clear`.                                             |
| `body`      | Plain English text the server writes. Not sent on `clear`.                                           |
| `data`      | Facts for the app to build its own text from, different for each type. Not sent on `clear`.          |

`title` and `body` are always a usable notification on their own. An app shows them when it doesn't understand a type or a value.

## Permission

```json
{
  "v": 1,
  "id": "per_1",
  "type": "permission",
  "sessionID": "ses_parent",
  "time": 1795644290720,
  "title": "Fix the login bug",
  "body": "Needs permission: shell",
  "data": {
    "requestID": "per_1",
    "replySessionID": "ses_child",
    "action": "shell",
    "resources": ["git add .", "git push origin main"],
    "save": ["git add *", "git push *"]
  }
}
```

| Key              | Sent                             | Meaning                                                                                                        |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `requestID`      | always                           | The request to reply to.                                                                                       |
| `replySessionID` | always                           | The session that asked, which may be a subagent's.                                                             |
| `action`         | always                           | `shell`, `edit`, `read`, `webfetch`, `websearch`, `external_directory`, `skill`, an MCP tool, or another name. |
| `resources`      | always                           | What is asked for: commands, paths, a URL, a query or folders. `["*"]` means anything.                         |
| `save`           | when the request has any         | The patterns "Allow always" would store.                                                                       |
| `truncated`      | when something in `data` was cut | `true`. See [Size](#size).                                                                                     |

## Question

```json
{
  "v": 1,
  "id": "frm_1",
  "type": "question",
  "sessionID": "ses_parent",
  "time": 1795644290720,
  "title": "Fix the login bug",
  "body": "Which database should the cache use?",
  "data": {
    "formID": "frm_1",
    "replySessionID": "ses_child",
    "count": 2,
    "question": {
      "key": "q0",
      "type": "string",
      "title": "Database",
      "text": "Which database should the cache use?",
      "custom": true,
      "options": [{ "label": "Postgres" }, { "label": "SQLite", "value": "sqlite" }]
    }
  }
}
```

Only forms whose `metadata.kind` is `"question"`, as the question tool's are, send a push. `question` describes the form's first question; the others are only counted.

| Key                | Sent                                                  | Meaning                                                                |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `formID`           | always                                                | The form to reply to.                                                  |
| `replySessionID`   | always                                                | The session that owns the form, which may be a subagent's.             |
| `count`            | always                                                | How many questions the form has.                                       |
| `question.key`     | always                                                | The first question's key, used in the reply.                           |
| `question.type`    | always                                                | `string`, `multiselect`, `number`, `integer`, `boolean` or `external`. |
| `question.title`   | when it has one                                       | Its short header.                                                      |
| `question.text`    | when it has one                                       | The question itself.                                                   |
| `question.custom`  | when a typed answer is accepted                       | `true`. Without it, only the listed options are accepted.              |
| `question.options` | for `string` and `multiselect` questions with options | In order. `label` always; `value` only when it differs from the label. |
| `truncated`        | when something in `data` was cut                      | `true`. See [Size](#size).                                             |

## Finished and Failed

```json
{
  "v": 1,
  "id": "ses_parent",
  "type": "session.idle",
  "sessionID": "ses_parent",
  "time": 1795644290720,
  "title": "Fix the login bug",
  "body": "Failed",
  "data": {
    "outcome": "failed",
    "text": "Running the tests now.",
    "error": { "type": "rate_limit", "message": "Rate limit exceeded" }
  }
}
```

Sent for top-level sessions only: when a turn that ran a model step succeeds (`body` "Finished"), and when a turn fails (`body` "Failed").

| Key             | Sent                             | Meaning                                                                                                   |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `outcome`       | always                           | `succeeded` or `failed`.                                                                                  |
| `text`          | when the turn wrote any          | The last 500 characters of the turn's final assistant message: text only, never reasoning or tool output. |
| `error.type`    | on failure                       | The error's kind, such as `rate_limit` or `aborted`.                                                      |
| `error.message` | on failure, when not empty       | The error's English message.                                                                              |
| `truncated`     | when something in `data` was cut | `true`. See [Size](#size).                                                                                |

## Clear

```json
{ "v": 1, "id": "per_1", "type": "clear", "sessionID": "ses_parent", "time": 1795644290725 }
```

Sent silently, only to the phones that got the notification. It removes the notification sent under `id`. A permission clears when it is answered on any client or its turn ends, a question when it is answered or cancelled, and a finished turn on a new prompt or a later view of the session. Archiving or deleting a session clears all of its notifications.

## Replying From a Notification

Replies name `replySessionID`, not the top-level `sessionID`.

- Permission: `POST /api/session/:replySessionID/permission/:requestID/reply` with `{ "decision": "once" | "always" | "reject", "message"?: string }`. A `message` with `reject` goes back to the agent as feedback. `always` stores the `save` patterns for the project and also allows other waiting requests they now cover. Without `save` it stores nothing and acts like `once`, so offer Always only when `save` is present.
- Question: `POST /api/session/:replySessionID/form/:formID/reply` with `{ "answer": { "<question.key>": value } }`. For `string` the value is a string; for `multiselect`, a list of strings. For an option, send its `value`, or its `label` when there is no `value`. Send typed text only when `custom` is `true`. A reply settles the whole form, so reply inline only when `count` is 1; otherwise open the app.

Don't approve or answer from a notification whose `truncated` is `true` without fetching the full version first.

## Size

A message is at most 2,600 bytes, so its box fits the relay's limit. When it is bigger, the server cuts it in this order until it fits:

1. `text` is left out.
2. `error.message` is cut from its end.
3. `resources` are kept in order while they fit; the next one is shortened, or left out if even that won't fit, and the rest are left out. If that isn't enough, `save` is left out and `resources` are cut again from the full list.
4. `body` is cut from its end, or sent as `""`.
5. `question.text` is cut from its end.
6. `question.options` are kept in order while they fit; the rest are left out. An option is never shortened, because a reply sends it exactly.
7. `question.title` is left out.

Anything shortened ends in "…". A value is never sent as a bare "…": it is left out instead. When anything in `data` is cut or left out, `data.truncated` is `true`; otherwise it isn't sent. An empty list never sets it, and neither do the 500-character limit on `text` or a cut `body`. Ids, `time`, `action`, `count`, `outcome`, `question.key`, `question.type`, `question.custom` and `error.type` are never cut.

The full version can be fetched by id:

- `GET /api/session/:replySessionID/permission/:requestID` (while the request is waiting)
- `GET /api/session/:replySessionID/form/:formID`
- `GET /api/session/:sessionID/message` for a turn's answer

## Changing the Format

- Only add keys. Never rename, remove or change the meaning or type of one.
- Clients treat every key except the envelope's `v`, `id`, `type` and `sessionID` as optional, and show `title` and `body` for an unknown `type` or value.
- `title` and `body` always stay a usable notification on their own.
- Bump `v` only as a last resort.
