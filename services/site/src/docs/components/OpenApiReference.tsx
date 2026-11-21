import { For, Show, type JSX } from "solid-js"
import { HeadingLink } from "~/component/site/on-this-page"
import openapi from "../../../../../packages/protocol/openapi.json"
import { latestDocs } from "../config"
import { DocsLayout, type DocsAssets } from "../layouts/DocsLayout"
import { formatOpenApiValue, openApiSchemaLabel, type OpenApiOperation, type OpenApiSchema } from "../lib/openapi"

const methods = ["get", "post", "put", "patch", "delete", "options", "head"] as const
type Method = (typeof methods)[number]

const paths = openapi.paths as unknown as Record<string, Partial<Record<Method, OpenApiOperation>>>
const operations = Object.entries(paths).flatMap(([path, item]) =>
  methods.flatMap((method) => {
    const operation = item[method]
    if (!operation) return []
    return [
      { ...operation, path, method, id: operation.operationId ?? `${method}-${path}`.replace(/[^a-z0-9]+/gi, "-") },
    ]
  }),
)
// The spec's tags are lowercase ids; their titles in the reference. Anchors keep the ids.
const tagTitles: Record<string, string> = {
  mcp: "MCP",
  rpc: "RPC",
  pty: "PTY",
  vcs: "VCS",
  persistentPty: "Persistent PTY",
  websearch: "Web search",
}
const groups = [...new Set(operations.map((operation) => operation.tags?.[0] ?? "other"))].map((tag) => ({
  tag,
  title: tagTitles[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1),
  id: `tag-${tag.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
  description: openapi.tags.find((item) => item.name === tag)?.description,
  operations: operations.filter((operation) => (operation.tags?.[0] ?? "other") === tag),
}))
const schemas = Object.entries(openapi.components.schemas) as [string, OpenApiSchema][]

/**
 * The HTTP API reference, from packages/protocol/openapi.json, in the docs layout: a section per
 * resource with its endpoint cards (docs-variants.css api-7), then the schemas. Each card opens on
 * its own, and on its address (`#operation-id`, client.ts), so the page stays scannable.
 */
export function OpenApiReference(props: { assets: DocsAssets }) {
  return (
    <DocsLayout
      set={latestDocs}
      title="API"
      description="OpenCode HTTP API reference and OpenAPI specification."
      currentSlug="api"
      headings={[
        ...groups.map((group) => ({ depth: 2, slug: group.id, text: group.title })),
        { depth: 2, slug: "schemas", text: "Schemas" },
      ]}
      assets={props.assets}
    >
      <p>
        {openapi.info.description} The reference covers {operations.length} operations and {schemas.length} schemas from
        the <a href={`${latestDocs.base}openapi.json`}>OpenAPI {openapi.openapi} document</a>.
      </p>
      <For each={groups}>
        {(group) => (
          <section>
            <h2 id={group.id}>
              <HeadingLink id={group.id} title={group.title} />
            </h2>
            <Show when={group.description}>
              <p>{group.description}</p>
            </Show>
            <For each={group.operations}>{(operation) => <Operation operation={operation} />}</For>
          </section>
        )}
      </For>
      <section>
        <h2 id="schemas">
          <HeadingLink id="schemas" title="Schemas" />
        </h2>
        <p>The data types the operations above refer to.</p>
        <For each={schemas}>
          {([name, schema]) => (
            <Card id={`schema-${name}`} head={<code>{name}</code>} summary={openApiSchemaLabel(schema)}>
              <Show when={schema.description}>
                <p>{schema.description}</p>
              </Show>
              <SchemaBody schema={schema} />
            </Card>
          )}
        </For>
      </section>
    </DocsLayout>
  )
}

function Operation(props: { operation: (typeof operations)[number] }) {
  const operation = props.operation
  return (
    <Card
      id={operation.id}
      head={
        <>
          <span data-component="badge" data-method={operation.method}>
            {operation.method}
          </span>
          <code>{operation.path}</code>
        </>
      }
      summary={operation.summary}
    >
      <Show when={operation.description}>
        <p>{operation.description}</p>
      </Show>
      <Show when={operation.parameters?.length}>
        <Table head={["Parameter", "In", "Type", "Required", "Description"]}>
          <For each={operation.parameters}>
            {(parameter) => (
              <tr>
                <td>
                  <code>{parameter.name}</code>
                </td>
                <td>{parameter.in}</td>
                <td>
                  <Type schema={parameter.schema} />
                </td>
                <td>
                  <Required required={parameter.required} />
                </td>
                <td>{parameter.description}</td>
              </tr>
            )}
          </For>
        </Table>
      </Show>
      <Show when={operation.requestBody}>
        {(body) => (
          <Table head={["Request body", "Type", "Required", "Description"]}>
            <For each={Object.entries(body().content ?? {})}>
              {([mediaType, content]) => (
                <tr>
                  <td>
                    <code>{mediaType}</code>
                  </td>
                  <td>
                    <Type schema={content.schema} />
                  </td>
                  <td>
                    <Required required={body().required} />
                  </td>
                  <td>{body().description}</td>
                </tr>
              )}
            </For>
          </Table>
        )}
      </Show>
      <Table head={["Status", "Type", "Description"]}>
        <For each={Object.entries(operation.responses ?? {})}>
          {([status, response]) => (
            <tr>
              <td>
                <code>{status}</code>
              </td>
              <td>
                <For each={Object.values(response.content ?? {})} fallback={<span data-slot="ref-type">empty</span>}>
                  {(content) => <Type schema={content.schema} />}
                </For>
              </td>
              <td>{response.description}</td>
            </tr>
          )}
        </For>
      </Table>
      <p data-slot="operation-id">
        Operation ID <code>{operation.operationId}</code>
      </p>
    </Card>
  )
}

/** An endpoint or schema card: closed to its header row, open for the details. */
function Card(props: { id: string; head: JSX.Element; summary?: string; children: JSX.Element }) {
  return (
    <details data-component="api-operation" id={props.id}>
      <summary data-slot="api-head">
        {props.head}
        <Show when={props.summary}>
          <span data-slot="api-summary">{props.summary}</span>
        </Show>
      </summary>
      <div data-slot="api-body">{props.children}</div>
    </details>
  )
}

function Table(props: { head: string[]; children: JSX.Element }) {
  return (
    <div data-slot="api-table">
      <table>
        <thead>
          <tr>
            <For each={props.head}>{(cell) => <th>{cell}</th>}</For>
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  )
}

function Required(props: { required?: boolean }) {
  return (
    <span data-slot="ref-required" data-required={props.required ? "" : undefined}>
      {props.required ? "Required" : "Optional"}
    </span>
  )
}

/** A schema's type, with each named schema it uses linked to its card. */
function Type(props: { schema?: OpenApiSchema }): JSX.Element {
  const schema = props.schema
  const reference = schema?.$ref?.split("/").at(-1)
  const variants = schema?.anyOf ?? schema?.oneOf ?? schema?.allOf
  if (reference)
    return (
      <a data-slot="ref-type" href={`#schema-${reference}`}>
        {reference}
      </a>
    )
  if (variants)
    return (
      <span data-slot="ref-type">
        <For each={variants}>
          {(variant, index) => (
            <>
              {index() > 0 ? (schema?.allOf ? " & " : " | ") : ""}
              <Type schema={variant} />
            </>
          )}
        </For>
      </span>
    )
  if (schema?.type === "array" && schema.items)
    return (
      <span data-slot="ref-type">
        <Type schema={schema.items} />
        []
      </span>
    )
  return <span data-slot="ref-type">{openApiSchemaLabel(schema)}</span>
}

/** A schema's fields as a table, or its allowed values, variants or items. */
function SchemaBody(props: { schema: OpenApiSchema }) {
  const schema = props.schema
  const properties = Object.entries(schema.properties ?? {})
  return (
    <Show
      when={properties.length > 0}
      fallback={
        <p>
          <Show when={schema.enum} fallback={<Type schema={schema} />}>
            {(values) => <code>{values().map(formatOpenApiValue).join(" | ")}</code>}
          </Show>
        </p>
      }
    >
      <Table head={["Field", "Type", "Required", "Description"]}>
        <For each={properties}>
          {([name, property]) => (
            <tr>
              <td>
                <code>{name}</code>
              </td>
              <td>
                <Type schema={property} />
              </td>
              <td>
                <Required required={schema.required?.includes(name)} />
              </td>
              <td>{property.description}</td>
            </tr>
          )}
        </For>
      </Table>
    </Show>
  )
}
