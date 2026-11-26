# Push Notification Format

Status: **Current contract.** Core builds these messages in `packages/core/src/push/watcher.ts` and `sender.ts`. This document is for anyone writing a phone client.

## The Message

A phone registers with `PUT /api/experimental/push/device/:deviceID`. The server then sends each notification through the relay as an encrypted box. Inside the box is one JSON object, the message. The relay never sees it.

Every message has `v` and `type`. A message that shows a notification has this envelope:

| Key         | Sent                                  | Meaning                                                                                                                         |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `v`         | always                                | Format version, `1`.                                                                                                            |
| `type`      | always                                | `permission`, `form` or `turn`. A `clear` has [its own shape](#clear).                                                          |
| `id`        | always                                | The notification's name. A later message with the same `id` replaces it, and a `clear` removes it.                              |
| `time`      | always                                | When the event happened, in ms since the epoch.                                                                                 |
| `sessionID` | when it is about a session            | The top-level session: the one to open on tap, and the one bells apply to.                                                      |
| `directory` | when it is about a session            | The folder that session works in.                                                                                               |
| `attention` | when it asks the person for something | `true`: the notification waits for an answer, as a permission or a form does. Phones whose level is `attention` get only these. |
| `title`     | always                                | A plain title to fall back on. Today the session's title, or "OpenCode".                                                        |
| `body`      | always                                | Plain text to fall back on, at most 200 Unicode code points and never empty.                                                    |
| `data`      | always                                | Facts for the app to build its own text from, different for each type.                                                          |

`id` is opaque and unique only within one server, so a phone paired with several servers keeps each server's notifications and clears apart. Today it is a permission, form or session id, but an app only compares it with other `id`s; the ids to reply with and open are in `sessionID` and `data`.

`title` and `body` are always a usable notification on their own. An app shows them when it doesn't understand a message's `type` or `v`. The server's own phrases are English; text it copies, such as a form's question or a provider's error, is in whatever language it was written. A message without `body`, as a `clear` is, is never shown.

## Permission

```json
{
  "v": 1,
  "type": "permission",
  "id": "per_1",
  "time": 1795644290720,
  "sessionID": "ses_parent",
  "directory": "/home/me/shop",
  "attention": true,
  "title": "Fix the login bug",
  "body": "Needs permission: shell",
  "data": {
    "requestID": "per_1",
    "replySessionID": "ses_child",
    "action": "shell",
    "resources": ["git add .", "git push origin main"],
    "save": ["git add *", "git push *"],
    "decisions": ["once", "always", "reject"],
    "source": { "type": "tool", "messageID": "msg_1", "id": "call_1" }
  }
}
```

| Key              | Sent                             | Meaning                                                                                                        |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `requestID`      | always                           | The request to reply to.                                                                                       |
| `replySessionID` | always                           | The session that asked, which may be a subagent's.                                                             |
| `action`         | always                           | `shell`, `edit`, `read`, `webfetch`, `websearch`, `external_directory`, `skill`, an MCP tool, or another name. |
| `resources`      | always                           | What is asked for: commands, paths, a URL, a query or folders. `["*"]` means anything.                         |
| `resourceCount`  | when `resources` were left out   | How many resources the request has.                                                                            |
| `save`           | when the request has any         | The patterns "Allow always" would store.                                                                       |
| `decisions`      | always                           | The replies to offer: `once` and `reject`, and `always` when the request has patterns to save.                 |
| `message`        | when the request has one         | A note sent with the request.                                                                                  |
| `source`         | when a tool call asked           | The call: `type` `"tool"`, the `messageID` of its assistant message, and the call's `id`.                      |
| `truncated`      | when something in `data` was cut | `true`. See [Size](#size).                                                                                     |

A request's `metadata`, such as the diff of an edit, is never in the message. An app fetches the request to show it.

## Form

```json
{
  "v": 1,
  "type": "form",
  "id": "frm_1",
  "time": 1795644290720,
  "sessionID": "ses_parent",
  "directory": "/home/me/shop",
  "attention": true,
  "title": "Fix the login bug",
  "body": "Which database should the cache use?",
  "data": {
    "formID": "frm_1",
    "replySessionID": "ses_child",
    "kind": "question",
    "count": 1,
    "inlineReply": true,
    "source": { "type": "tool", "messageID": "msg_1", "id": "call_1" },
    "fields": [
      {
        "key": "q0",
        "type": "string",
        "title": "Database",
        "description": "Which database should the cache use?",
        "custom": true,
        "options": [
          { "label": "Postgres", "description": "Best for production" },
          { "label": "SQLite", "value": "sqlite" }
        ]
      }
    ]
  }
}
```

A form is something the session asks the person to fill in. Today only forms whose `metadata.kind` is `"question"`, as the question tool's are, send a push. `fields` holds the form's first field; the others are only counted. An app reads `fields` as a list, since later servers may send more of them.

A field uses the same names as the form the server returns from `GET`, and carries only these keys:

| Key                    | Sent                                               | Meaning                                                                                                            |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `formID`               | always                                             | The form to reply to.                                                                                              |
| `replySessionID`       | always                                             | The session that owns the form, which may be a subagent's.                                                         |
| `kind`                 | when the form has one                              | What the form is for. `"question"` is the question tool's.                                                         |
| `count`                | always                                             | How many fields the form has.                                                                                      |
| `inlineReply`          | when a reply can be built from this message alone  | `true`. See [Replying](#replying-from-a-notification).                                                             |
| `source`               | when a tool call asked                             | The call: `type` `"tool"`, the `messageID` of its assistant message, its `id`.                                     |
| `fields[].key`         | always                                             | The field's key, used in the reply.                                                                                |
| `fields[].type`        | always                                             | `string`, `multiselect`, `number`, `integer`, `boolean` or `external`.                                             |
| `fields[].title`       | when it has one                                    | Its short header.                                                                                                  |
| `fields[].description` | when it has one                                    | The question itself.                                                                                               |
| `fields[].custom`      | when a typed answer is accepted                    | `true`. Without it, only the listed options are accepted.                                                          |
| `fields[].options`     | for `string` and `multiselect` fields with options | All of them, in order. `label` always; `value` only when it differs from the label; `description` when it has one. |
| `truncated`            | when something in `data` was cut                   | `true`. See [Size](#size).                                                                                         |

## Finished and Failed

```json
{
  "v": 1,
  "type": "turn",
  "id": "ses_parent",
  "time": 1795644290720,
  "sessionID": "ses_parent",
  "directory": "/home/me/shop",
  "title": "Fix the login bug",
  "body": "Failed",
  "data": {
    "outcome": "failed",
    "messageID": "msg_9",
    "idleMessageID": "msg_10",
    "text": "Running the tests now.",
    "error": { "type": "provider.rate-limit", "message": "Rate limit exceeded", "status": 429, "retryAfterMs": 30000 }
  }
}
```

Sent for top-level sessions only: when a turn that ran a model step succeeds (`body` "Finished"), and when a turn fails (`body` "Failed").

| Key                  | Sent                             | Meaning                                                                                                                                                                   |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`            | always                           | `succeeded` or `failed`.                                                                                                                                                  |
| `messageID`          | when the turn ran a model step   | The turn's final assistant message, where its answer is.                                                                                                                  |
| `idleMessageID`      | always                           | The message that records how the turn ended. A failed turn's full error is on it.                                                                                         |
| `text`               | when the turn wrote any          | An excerpt of that message's text that the server picks, in Markdown. For display only: it can start mid-word or inside a Markdown block. Never reasoning or tool output. |
| `error.type`         | on failure                       | The error's kind, such as `provider.rate-limit`, `provider.auth`, `tool.execution` or `aborted`.                                                                          |
| `error.message`      | on failure, when not empty       | The error's message.                                                                                                                                                      |
| `error.status`       | on failure, when there is one    | The HTTP status the provider answered with.                                                                                                                               |
| `error.retryAfterMs` | on failure, when there is one    | How long the provider asked to wait before trying again, in ms, counted from when it answered, shortly before `time`.                                                     |
| `truncated`          | when something in `data` was cut | `true`. See [Size](#size).                                                                                                                                                |

## Clear

```json
{ "v": 1, "type": "clear", "ids": ["per_1", "per_2"], "time": 1795644290725 }
```

Sent silently, only to the phones that got the notifications. It removes the notifications sent under `ids`. `time` is when the event that caused it happened. `ids` is a list so that one clear can name several; today the server sends one clear for each.

A permission clears when it is answered on any client or its turn ends, a form when it is answered or cancelled, and a finished turn on a new prompt or a later view of the session. Archiving or deleting a session clears all of its notifications.

## Order

Pushes can arrive late, out of order or not at all.

- A message replaces the notification shown under the same `id`, unless that one has a later `time`.
- A clear removes a notification only when the notification's `time` is not later than the clear's.
- A phone remembers a clear for at least an hour. A notification that arrives after it with the same `id` and a `time` that is not later is never shown.
- A reply to something already settled answers 404 or 409. The app then removes the notification.
- When the app opens, it asks the server what is still waiting instead of trusting the notifications on screen.

## Replying From a Notification

Replies name `replySessionID`, not the top-level `sessionID`. An app offers an action only when this message gives it everything the action needs; otherwise it opens the session.

- Permission: offer the `decisions` the message lists, and no others. `POST /api/session/:replySessionID/permission/:requestID/reply` with `{ "decision": "once" | "always" | "reject", "message"?: string }`. A `message` with `reject` goes back to the agent as feedback. `always` stores the `save` patterns for the project and also allows other waiting requests they now cover. `reject` also rejects the session's other waiting requests from the same assistant message. Don't approve a request whose `truncated` is `true` without fetching the full version first.
- Form: reply only when `inlineReply` is `true`, `fields` holds all `count` fields, and the app knows the `type` of each. `POST /api/session/:replySessionID/form/:formID/reply` with `{ "answer": { "<key>": value } }`. For `string` the value is a string; for `multiselect`, a list of strings. For an option, send its `value`, or its `label` when there is no `value`. Send typed text only when `custom` is `true`. The server checks the answer and answers 400 when it doesn't accept it; the app then opens the session. To dismiss a form without answering, `DELETE /api/session/:replySessionID/form/:formID`, which needs only the ids.

The server sends `inlineReply` when the form has one field, a `string` or `multiselect`, and nothing in `data` was cut. A reply settles the whole form.

## Size

A message is at most 2,600 bytes, so its box fits the relay's limit. When it is bigger, the server cuts it in this order until it fits:

1. `inlineReply` is left out.
2. `text` is left out.
3. `error.message` is cut from its end.
4. `resources` are kept in order while they fit; the next one is shortened, or left out if even that won't fit, and the rest are left out.
5. Option `description`s are left out.
6. A field's `description` is cut from its end.
7. `data` keeps only its ids (`requestID`, `formID`, `replySessionID`, `messageID`, `idleMessageID`), `kind`, `count`, `decisions`, `outcome` and `truncated`, and `directory` is left out. This is the one step that leaves out keys the tables above call always sent.

Anything shortened ends in "…". A value is never sent as a bare "…": it is left out instead. When anything in `data` is cut or left out, `data.truncated` is `true`; otherwise it isn't sent. The server's choice of excerpt for `text` doesn't set it. Ids, `time`, `title` and `body` are never cut.

The full version can be fetched by id:

- `GET /api/session/:replySessionID/permission/:requestID` (while the request is waiting)
- `GET /api/session/:replySessionID/form/:formID`
- `GET /api/session/:sessionID/message/:messageID` for a turn's answer
- `GET /api/session/:sessionID/message/:idleMessageID` for how a turn ended, with a failed turn's full error

## Changing the Format

- Only add keys. Never rename, remove or change the meaning or type of one.
- Clients treat every key except `v` and `type` as optional, and ignore keys they don't know.
- For an unknown `type` or `v`, a client shows `title` and `body` and opens the session on tap, or the app when there is no `sessionID`. It offers no actions. Without `body`, it does nothing.
- For an unknown value, such as a new `kind`, field `type`, decision, `outcome` or `error.type`, a client shows what it understands and leaves out what it doesn't.
- `title` and `body` always stay a usable notification on their own.
- Bump `v` only as a last resort. Registration ignores keys it doesn't know, so a later app can tell the server which versions it reads; an app that doesn't say reads only `1`.
