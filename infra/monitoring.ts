import { SECRET } from "./secret"
import { domain } from "./stage"

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

const modelHttpErrorsQuery = (product: "go" | "zen") => {
  const filters = [
    { column: "model", op: "exists" },
    { column: "event_type", op: "=", value: "completions" },
    { column: "user_agent", op: "contains", value: "opencode" },
    { column: "isGoTier", op: "=", value: product === "go" ? "true" : "false" },
  ]

  return honeycomb.getQuerySpecificationOutput({
    breakdowns: ["model"],
    calculatedFields: [
      {
        name: "is_failed_http_status",
        expression: `IF(AND(GTE($status, "400"), NOT(EQUALS($status, "401"))), 1, 0)`,
      },
    ],
    calculations: [
      { op: "COUNT", name: "TOTAL", filterCombination: "AND", filters },
      { op: "SUM", name: "FAILED", column: "is_failed_http_status", filterCombination: "AND", filters },
    ],
    formulas: [{ name: "ERROR", expression: "IF(GTE($TOTAL, 2500), DIV($FAILED, $TOTAL), 0)" }],
    timeRange: 900,
  }).json
}

const description = "Managed by SST (Don't edit in Honeycomb UI)"

new honeycomb.Trigger("IncreasedModelHttpErrorsGo", {
  name: "Increased Model HTTP Errors [Go]",
  description,
  queryJson: modelHttpErrorsQuery("go"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.8, exceededLimit: 1 }],
  recipients: [
    // {
    //   id: webhookRecipient.id,
    //   notificationDetails: [
    //     {
    //       variables: [{ name: "type", value: "model_http_errors" }],
    //     },
    //   ],
    // },
  ],
})

new honeycomb.Trigger("IncreasedModelHttpErrorsZen", {
  name: "Increased Model HTTP Errors [Zen]",
  description,
  queryJson: modelHttpErrorsQuery("zen"),
  alertType: "on_change",
  frequency: 300,
  thresholds: [{ op: ">=", value: 0.8, exceededLimit: 1 }],
  recipients: [
    // {
    //   id: webhookRecipient.id,
    //   notificationDetails: [
    //     {
    //       variables: [{ name: "type", value: "model_http_errors" }],
    //     },
    //   ],
    // },
  ],
})
