import { For, Show } from "solid-js"
import { formatOpenApiValue, openApiSchemaLabel, type OpenApiSchema } from "../lib/openapi"

export function OpenApiSchemaView(props: { schema?: OpenApiSchema; required?: boolean }) {
  const schema = props.schema
  const reference = schema?.$ref?.split("/").at(-1)
  const variants = schema?.anyOf ?? schema?.oneOf ?? schema?.allOf
  const variantOperator = schema?.allOf ? "and" : "or"
  const constraints = schema
    ? [
        schema.pattern && `pattern ${schema.pattern}`,
        schema.minimum !== undefined && `min ${schema.minimum}`,
        schema.maximum !== undefined && `max ${schema.maximum}`,
        schema.exclusiveMinimum !== undefined && `> ${schema.exclusiveMinimum}`,
        schema.exclusiveMaximum !== undefined && `< ${schema.exclusiveMaximum}`,
        schema.minLength !== undefined && `min length ${schema.minLength}`,
        schema.maxLength !== undefined && `max length ${schema.maxLength}`,
        schema.minItems !== undefined && `min items ${schema.minItems}`,
        schema.maxItems !== undefined && `max items ${schema.maxItems}`,
      ].filter((value): value is string => typeof value === "string")
    : []

  if (reference)
    return (
      <a class="api-schema-link" href={`#schema-${reference}`}>
        {reference}
      </a>
    )
  return (
    <div class="api-schema-node">
      <div class="api-schema-heading">
        <code>{openApiSchemaLabel(schema)}</code>
        <Show when={props.required}>
          <span class="api-required">required</span>
        </Show>
        <Show when={schema?.deprecated}>
          <span class="api-deprecated">deprecated</span>
        </Show>
      </div>
      <Show when={schema?.description}>
        <p>{schema?.description}</p>
      </Show>
      <Show when={schema?.enum}>
        {(values) => (
          <div class="api-schema-values">
            <span>Values</span>
            <code>{values().map(formatOpenApiValue).join(" | ")}</code>
          </div>
        )}
      </Show>
      <Show when={schema?.const !== undefined}>
        <div class="api-schema-values">
          <span>Constant</span>
          <code>{formatOpenApiValue(schema?.const)}</code>
        </div>
      </Show>
      <Show when={schema?.default !== undefined}>
        <div class="api-schema-values">
          <span>Default</span>
          <code>{formatOpenApiValue(schema?.default)}</code>
        </div>
      </Show>
      <Show when={constraints.length > 0}>
        <div class="api-schema-constraints">{constraints.join(", ")}</div>
      </Show>
      <Show when={variants}>
        {(items) => (
          <div class="api-schema-variants">
            <For each={items()}>
              {(variant, index) => (
                <div>
                  <Show when={index() > 0}>
                    <span class="api-schema-operator">{variantOperator}</span>
                  </Show>
                  <OpenApiSchemaView schema={variant} />
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={schema?.type === "array" && schema.items}>
        {(items) => (
          <div class="api-schema-items">
            <span>Items</span>
            <OpenApiSchemaView schema={items()} />
          </div>
        )}
      </Show>
      <Show when={schema?.properties}>
        {(properties) => (
          <div class="api-schema-properties">
            <For each={Object.entries(properties())}>
              {([name, property]) => (
                <div class="api-schema-property">
                  <code>{name}</code>
                  <OpenApiSchemaView schema={property} required={schema?.required?.includes(name)} />
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={typeof schema?.additionalProperties === "object" && schema.additionalProperties}>
        {(additional) => (
          <div class="api-schema-items">
            <span>Additional properties</span>
            <OpenApiSchemaView schema={additional() as OpenApiSchema} />
          </div>
        )}
      </Show>
    </div>
  )
}
