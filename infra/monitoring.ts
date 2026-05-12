import { SECRET } from "./secret"
import { domain } from "./stage"

const description = "Managed by SST (Don't edit in Honeycomb UI)"

const webhookRecipient = new honeycomb.WebhookRecipient("DiscordAlerts", {
  name: $app.stage === "production" ? "Discord Alerts" : `Discord Alerts (${$app.stage})`,
  url: `https://${domain}/honeycomb/webhook`,
  secret: SECRET.HoneycombWebhookSecret.result,
  templates: [
    {
      type: "trigger",
      body: `{
        "url": {{ .Result.URL | quote }},
        "type": {{ .Vars.type | quote }},
        "name": {{ .Name | quote }},
        "status": {{ .Alert.Status | quote }},
        "isTest": {{ .Alert.IsTest }},
        "groups": {{ .Result.GroupsTriggered | toJson }}
      }`,
    },
  ],
  variables: [
    {
      name: "type",
    },
  ],
})

// Honeycomb can keep stale query-local calculated fields when the name is unchanged,
// so tie the field name to the expression while avoiding deploy-to-deploy churn.
// https://github.com/honeycombio/terraform-provider-honeycombio/issues/852
const calculatedField = (field: { name: string; expression: string }) => ({
  ...field,
  name: `${field.name}_${(
    Array.from(field.expression).reduce((result, char) => Math.imul(31, result) + char.charCodeAt(0), 0) >>> 0
  ).toString(36)}`,
})

const modelHttpErrorsQuery = (product: "go" | "zen") => {
  const filters = [
    { column: "model", op: "exists" },
    { column: "event_type", op: "=", value: "completions" },
    { column: "user_agent", op: "contains", value: "opencode" },
    { column: "isGoTier", op: "=", value: product === "go" ? "true" : "false" },
  ]
  const failedHttpStatus = calculatedField({
    name: "is_failed_http_status",
    expression:
      product === "go"
        ? `IF(AND(GTE($status, "400"), NOT(EQUALS($status, "401")), NOT(EQUALS($status, "429"))), 1, 0)`
        : `IF(AND(EQUALS($status, "429"), $isFreeTier), 0, AND(GTE($status, "400"), NOT(EQUALS($status, "401"))), 1, 0)`,
  })

  return honeycomb.getQuerySpecificationOutput({
    breakdowns: ["model"],
    calculatedFields: [failedHttpStatus],
    calculations: [
      { op: "COUNT", name: "TOTAL", filterCombination: "AND", filters },
      {
        op: "SUM",
        name: "FAILED",
        column: failedHttpStatus.name,
        filterCombination: "AND",
        filters,
      },
    ],
    formulas: [{ name: "ERROR", expression: "IF(GTE($TOTAL, 100), DIV($FAILED, $TOTAL), 0)" }],
    timeRange: 900,
  }).json
}

const providerHttpErrorsQuery = (product: "go" | "zen") => {
  const filters = [
    { column: "provider", op: "exists" },
    { column: "user_agent", op: "contains", value: "opencode" },
    { column: "isGoTier", op: "=", value: product === "go" ? "true" : "false" },
  ]
  const successHttpStatus = calculatedField({
    name: "is_success_http_status",
    expression: `IF(AND(GTE($status, "200"), LT($status, "400")), 1, 0)`,
  })
  const failedProviderHttpStatus = calculatedField({
    name: "is_failed_provider_http_status",
    expression: `IF(GT($llm.error.code, "400"), 1, 0)`,
  })

  return honeycomb.getQuerySpecificationOutput({
    breakdowns: ["provider"],
    calculatedFields: [successHttpStatus, failedProviderHttpStatus],
    calculations: [
      {
        op: "SUM",
        name: "SUCCESS",
        column: successHttpStatus.name,
        filterCombination: "AND",
        filters: [...filters, { column: "event_type", op: "=", value: "completions" }],
      },
      {
        op: "SUM",
        name: "FAILED",
        column: failedProviderHttpStatus.name,
        filterCombination: "AND",
        filters: [...filters, { column: "event_type", op: "=", value: "llm.error" }],
      },
    ],
    formulas: [
      { name: "ERROR", expression: "IF(GTE(SUM($SUCCESS, $FAILED), 50), DIV($FAILED, SUM($SUCCESS, $FAILED)), 0)" },
    ],
    timeRange: 900,
  }).json
}

new honeycomb.Trigger("IncreasedModelHttpErrorsGo", {
  name: "Increased Model HTTP Errors [Go]",
  description,
  queryJson: modelHttpErrorsQuery("go"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.7, exceededLimit: 1 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [{ name: "type", value: "model_http_errors" }],
        },
      ],
    },
  ],
})

new honeycomb.Trigger("IncreasedModelHttpErrorsZen", {
  name: "Increased Model HTTP Errors [Zen]",
  description,
  queryJson: modelHttpErrorsQuery("zen"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.7, exceededLimit: 1 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [{ name: "type", value: "model_http_errors" }],
        },
      ],
    },
  ],
})

new honeycomb.Trigger("IncreasedProviderHttpErrorsGo", {
  name: "Increased Provider HTTP Errors [Go]",
  description,
  queryJson: providerHttpErrorsQuery("go"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.7, exceededLimit: 1 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [{ name: "type", value: "provider_http_errors" }],
        },
      ],
    },
  ],
})

new honeycomb.Trigger("IncreasedProviderHttpErrorsZen", {
  name: "Increased Provider HTTP Errors [Zen]",
  description,
  queryJson: providerHttpErrorsQuery("zen"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.7, exceededLimit: 1 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [{ name: "type", value: "provider_http_errors" }],
        },
      ],
    },
  ],
})

new honeycomb.Trigger("IncreasedFreeTierRequests", {
  name: "Increased Free Tier Requests",
  description,
  queryJson: honeycomb.getQuerySpecificationOutput({
    calculations: [{ op: "COUNT" }],
    filters: [
      { column: "event_type", op: "=", value: "completions" },
      { column: "user_agent", op: "contains", value: "opencode" },
      { column: "isFreeTier", op: "=", value: "true" },
    ],
    timeRange: 3600,
  }).json,
  alertType: "on_change",
  frequency: 900,
  thresholds: [{ op: ">=", value: 50, exceededLimit: 1 }],
  baselineDetails: [{ type: "percentage", offsetMinutes: 1440 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [{ name: "type", value: "custom" }],
        },
      ],
    },
  ],
})
