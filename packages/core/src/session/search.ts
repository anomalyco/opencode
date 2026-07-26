export * as SessionSearch from "./search"

import { or, sql, type SQL, type SQLWrapper } from "drizzle-orm"
import { PartTable, SessionMessageTable, SessionTable } from "./sql"

export function where(input: string) {
  const pattern = searchPattern(input)
  const fields = match(input)
  // Search readable values explicitly so JSON field names and type tags do not become false matches.
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
  const part = matchedValue(
    [
      sql`json_extract(${PartTable.data}, '$.text')`,
      sql`json_extract(${PartTable.data}, '$.prompt')`,
      sql`json_extract(${PartTable.data}, '$.description')`,
      sql`json_extract(${PartTable.data}, '$.state.output')`,
      sql`json_extract(${PartTable.data}, '$.state.error')`,
    ],
    pattern,
  )
  const content = sql<string | null>`(
    select json_extract(content.value, '$.text')
    from json_each(${SessionMessageTable.data}, '$.content') as content
    where ${matches(sql`json_extract(content.value, '$.text')`, pattern)}
    limit 1
  )`
  const message = sql<string | null>`coalesce(
    ${matchedValue(
      [
        sql`json_extract(${SessionMessageTable.data}, '$.text')`,
        sql`json_extract(${SessionMessageTable.data}, '$.command')`,
        sql`json_extract(${SessionMessageTable.data}, '$.output')`,
        sql`json_extract(${SessionMessageTable.data}, '$.summary')`,
        sql`json_extract(${SessionMessageTable.data}, '$.recent')`,
      ],
      pattern,
    )},
    ${content}
  )`
  return {
    part: { where: sql`${part} is not null`, snippet: excerpt(part, input) },
    message: { where: sql`${message} is not null`, snippet: excerpt(message, input) },
  }
}

function matchedValue(values: SQL[], pattern: string) {
  return sql<string | null>`case ${sql.join(
    values.map((value) => sql`when ${matches(value, pattern)} then ${value}`),
    sql` `,
  )} end`
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
