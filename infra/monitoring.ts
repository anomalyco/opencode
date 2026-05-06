import { SECRET } from "./secret"
import { domain } from "./stage"

const webhookRecipient = new honeycomb.WebhookRecipient("DiscordAlerts", {
  name: $app.stage === "production" ? "Discord Alerts" : `Discord Alerts (${$app.stage})`,
  url: `https://${domain}/honeycomb/webhook`,
  secret: SECRET.HoneycombWebhookSecret.value,
  templates: [
    {
      type: "trigger",
      body: `{
        "url": {{ .Result.URL | quote }},
        "type": {{ .Vars.type | quote }},
        "name": {{ .Name | quote }},
        "status": {{ .Alert.Status | quote }},
        "isTest": {{ .Alert.IsTest }},
        "groups": {{ .Result.GroupsTriggered | toJson }},
        "product": {{ .Vars.product | quote }}
      }`,
    },
  ],
  variables: [
    {
      name: "type",
    },
    {
      name: "product",
    },
  ],
})

const modelHttpErrorsQuery = (product: "go" | "zen") =>
  honeycomb.getQuerySpecificationOutput({
    breakdowns: ["model"],
    calculatedFields: [
      {
        name: "is_failed_http_status",
        expression: `IF(AND(GTE($status, "400"), NOT(EQUALS($status, "401"))), 1, 0)`,
      },
    ],
    calculations: [
      { op: "COUNT", name: "TOTAL", column: "model" },
      { op: "SUM", name: "FAILED", column: "is_failed_http_status" },
    ],
    formulas: [{ name: "ERROR", expression: "$FAILED / $TOTAL" }],
    filters: [
      { column: "model", op: "exists" },
      { column: "event_type", op: "=", value: "completions" },
      { column: "user_agent", op: "contains", value: "opencode" },
      { column: "isGoTier", op: "=", value: product === "go" ? "true" : "false" },
    ],
    filterCombination: "AND",
    havings: [{ calculateOp: "COUNT", column: "model", op: ">=", value: 10000 }],
    limit: 1000,
    timeRange: 900,
  }).json

new honeycomb.Trigger("IncreasedHttpErrorsGo", {
  name: "Increased HTTP Errors [Go]",
  description: "Managed by SST. Don't edit in Honeycomb UI",
  queryJson: modelHttpErrorsQuery("go"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.8, exceededLimit: 1 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [
            { name: "type", value: "model_http_errors" },
            { name: "product", value: "go" },
          ],
        },
      ],
    },
  ],
})

new honeycomb.Trigger("IncreasedHttpErrorsZen", {
  name: "Increased HTTP Errors [Zen]",
  description: "Managed by SST. Don't edit in Honeycomb UI",
  queryJson: modelHttpErrorsQuery("zen"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.8, exceededLimit: 1 }],
  recipients: [
    {
      id: webhookRecipient.id,
      notificationDetails: [
        {
          variables: [
            { name: "type", value: "model_http_errors" },
            { name: "product", value: "zen" },
          ],
        },
      ],
    },
  ],
})
