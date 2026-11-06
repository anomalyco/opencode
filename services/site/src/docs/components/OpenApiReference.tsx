import { For, Show } from "solid-js"
import openapi from "../../../../../packages/protocol/openapi.json"
import { base } from "../config"
import { openApiSchemaLabel, type OpenApiOperation, type OpenApiSchema } from "../lib/openapi"
import { OpenApiSchemaView } from "./OpenApiSchema"

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
const groups = [...new Set(operations.map((operation) => operation.tags?.[0] ?? "other"))].map((tag) => ({
  tag,
  id: `tag-${tag.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
  description: openapi.tags.find((item) => item.name === tag)?.description,
  operations: operations.filter((operation) => (operation.tags?.[0] ?? "other") === tag),
}))
const schemas = Object.entries(openapi.components.schemas) as [string, OpenApiSchema][]

export function OpenApiReference() {
  return (
    <div class="api-reference">
      <nav class="api-navigation" aria-label="API endpoints">
        <strong>API reference</strong>
        <a class="api-navigation-overview" href="#overview">
          Overview
        </a>
        <For each={groups}>
          {(group) => (
            <details class="api-navigation-group">
              <summary>
                <span>{group.tag}</span>
                <small>{group.operations.length}</small>
              </summary>
              <For each={group.operations}>
                {(operation) => (
                  <a href={`#${operation.id}`}>
                    <span class={`api-navigation-method api-navigation-method-${operation.method}`}>
                      {operation.method}
                    </span>
                    <span>{operation.summary}</span>
                  </a>
                )}
              </For>
            </details>
          )}
        </For>
        <a class="api-navigation-overview" href="#schemas">
          <span>Schemas</span>
          <small>{schemas.length}</small>
        </a>
      </nav>

      <article class="api-content" id="overview" data-pagefind-body data-pagefind-meta="title:API">
        <header class="api-intro">
          <p class="api-eyebrow">OpenAPI {openapi.openapi}</p>
          <h1>HTTP API</h1>
          <p>{openapi.info.description}</p>
          <div class="api-meta">
            <span>{operations.length} operations</span>
            <span>{schemas.length} schemas</span>
            <a href={`${base}openapi.json`}>OpenAPI JSON</a>
          </div>
        </header>

        <For each={groups}>
          {(group) => (
            <section class="api-group" id={group.id}>
              <header>
                <p class="api-eyebrow">Resource</p>
                <h2>{group.tag}</h2>
                <Show when={group.description}>
                  <p>{group.description}</p>
                </Show>
              </header>
              <div class="api-operations">
                <For each={group.operations}>{(operation) => <Operation operation={operation} />}</For>
              </div>
            </section>
          )}
        </For>

        <section class="api-group api-schemas" id="schemas">
          <header>
            <p class="api-eyebrow">Components</p>
            <h2>Schemas</h2>
            <p>Reusable data types referenced by API operations.</p>
          </header>
          <div class="api-operations">
            <For each={schemas}>
              {([name, schema]) => (
                <details class="api-schema" id={`schema-${name}`}>
                  <summary>
                    <code>{name}</code>
                    <span>{openApiSchemaLabel(schema)}</span>
                  </summary>
                  <div class="api-schema-body">
                    <OpenApiSchemaView schema={schema} />
                  </div>
                </details>
              )}
            </For>
          </div>
        </section>
      </article>
    </div>
  )
}

function Operation(props: { operation: (typeof operations)[number] }) {
  const operation = props.operation
  return (
    <details class="api-operation" id={operation.id}>
      <summary>
        <span class={`api-method api-method-${operation.method}`}>{operation.method}</span>
        <code>{operation.path}</code>
        <span>{operation.summary}</span>
      </summary>
      <div class="api-operation-body">
        <Show when={operation.description}>
          <p>{operation.description}</p>
        </Show>
        <p class="api-operation-id">
          <span>Operation ID</span>
          <code>{operation.operationId}</code>
        </p>
        <Show when={operation.parameters?.length}>
          <section class="api-block">
            <h3>Parameters</h3>
            <div class="api-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={operation.parameters}>
                    {(parameter) => (
                      <tr>
                        <td>
                          <code>{parameter.name}</code>
                          <Show when={parameter.required}>
                            <span class="api-required">required</span>
                          </Show>
                        </td>
                        <td>{parameter.in}</td>
                        <td>
                          <OpenApiSchemaView schema={parameter.schema} />
                        </td>
                        <td>{parameter.description ?? <span class="api-muted">No description</span>}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </section>
        </Show>
        <Show when={operation.requestBody}>
          {(body) => (
            <section class="api-block">
              <h3>
                Request body{" "}
                <Show when={body().required}>
                  <span class="api-required">required</span>
                </Show>
              </h3>
              <Show when={body().description}>
                <p>{body().description}</p>
              </Show>
              <div class="api-content-schemas">
                <For each={Object.entries(body().content ?? {})}>
                  {([mediaType, content]) => (
                    <div>
                      <code class="api-media-type">{mediaType}</code>
                      <OpenApiSchemaView schema={content.schema} />
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </Show>
        <section class="api-block">
          <h3>Responses</h3>
          <div class="api-responses">
            <For each={Object.entries(operation.responses ?? {})}>
              {([status, response]) => (
                <div class="api-response">
                  <div class="api-response-heading">
                    <code class={status.startsWith("2") ? "api-status api-status-success" : "api-status"}>
                      {status}
                    </code>
                    <span>{response.description ?? "Response"}</span>
                  </div>
                  <For each={Object.entries(response.content ?? {})}>
                    {([mediaType, content]) => (
                      <div class="api-response-schema">
                        <code class="api-media-type">{mediaType}</code>
                        <OpenApiSchemaView schema={content.schema} />
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </section>
      </div>
    </details>
  )
}
