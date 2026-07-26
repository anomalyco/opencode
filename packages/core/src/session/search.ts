export * as SessionSearch from "./search"

import { or, sql, type SQL, type SQLWrapper } from "drizzle-orm"
import { PartTable, SessionMessageTable, SessionTable } from "./sql"

export function where(input: string) {
  const pattern = searchPattern(input)
  const fields = match(input)
  // Search conversational values explicitly so JSON metadata and generated tool output do not become false matches.
  return or(
    matches(SessionTable.title, pattern),
    sql`exists (
      select 1
      from ${PartTable}
      where ${PartTable.session_id} = ${SessionTable.id}
        and ${fields.part.where}
    )`,
    sql`exists (
      select 1
      from ${SessionMessageTable}
      where ${SessionMessageTable.session_id} = ${SessionTable.id}
        and ${fields.message.where}
    )`,
  )!
}

export function match(input: string) {
  const pattern = searchPattern(input)
  const partText = sql`json_extract(${PartTable.data}, '$.text')`
  const part = sql<string | null>`case
    when json_extract(${PartTable.data}, '$.type') = 'text'
      and coalesce(json_extract(${PartTable.data}, '$.synthetic'), 0) = 0
      and coalesce(json_extract(${PartTable.data}, '$.ignored'), 0) = 0
      and ${matches(partText, pattern)}
    then ${partText}
  end`
  const content = sql<string | null>`(
    select json_extract(content.value, '$.text')
    from json_each(${SessionMessageTable.data}, '$.content') as content
    where json_extract(content.value, '$.type') = 'text'
      and ${matches(sql`json_extract(content.value, '$.text')`, pattern)}
    limit 1
  )`
  const text = sql`json_extract(${SessionMessageTable.data}, '$.text')`
  const command = sql`json_extract(${SessionMessageTable.data}, '$.command')`
  const message = sql<string | null>`case
    when ${SessionMessageTable.type} = 'user' and ${matches(text, pattern)} then ${text}
    when ${SessionMessageTable.type} = 'shell' and ${matches(command, pattern)} then ${command}
    when ${SessionMessageTable.type} = 'assistant' and ${content} is not null then ${content}
  end`
  return {
    part: { where: sql`${part} is not null`, snippet: excerpt(part, input) },
    message: { where: sql`${message} is not null`, snippet: excerpt(message, input) },
  }
}

function searchPattern(input: string) {
  return `%${input.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
}

function matches(value: SQLWrapper, pattern: string) {
  return sql`${value} like ${pattern} escape '\\'`
}

function excerpt(value: SQL, input: string) {
  const position = sql<number>`instr(lower(${value}), lower(${input}))`
  const start = sql<number>`max(1, ${position} - 72)`
  return sql<string>`(
    case when ${start} > 1 then '…' else '' end
    || trim(replace(replace(substr(${value}, ${start}, 180), char(10), ' '), char(13), ' '))
    || case when length(${value}) > ${start} + 179 then '…' else '' end
  )`
}
