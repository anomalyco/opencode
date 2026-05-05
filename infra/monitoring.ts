const displayName = (s: string) =>
  s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

const resourceName = (s: string) => displayName(s).replace(/[^a-zA-Z0-9]/g, "")

const varSpec = (label: string, name: string) =>
  $jsonStringify({
    content: [
      {
        content: [
          {
            attrs: {
              name,
              label,
              missing: false,
            },
            type: "varSpec",
          },
        ],
        type: "paragraph",
      },
    ],
    type: "doc",
  })

const fields = {
  model: incident.getAlertAttributeOutput({ name: "Model" }),
  product: incident.getAlertAttributeOutput({ name: "Product" }),
}

const alertSource = new incident.AlertSource("HoneycombAlertSource", {
  name: $app.stage === "production" ? "Honeycomb" : `Honeycomb (${$app.stage})`,
  sourceType: "honeycomb",
  template: {
    title: {
      literal: varSpec("Payload -> Title", "title"),
    },
    description: {
      literal: varSpec("Payload -> Description", "description"),
    },
    attributes: [
      {
        alertAttributeId: fields.model.id,
        binding: {
          value: {
            reference: 'expressions["model"]',
          },
          mergeStrategy: "first_wins",
        },
      },
      {
        alertAttributeId: fields.product.id,
        binding: {
          value: {
            reference: 'expressions["product"]',
          },
          mergeStrategy: "first_wins",
        },
      },
    ],
    expressions: [
      {
        label: "Model",
        operations: [
          {
            operationType: "parse",
            parse: {
              returns: {
                array: false,
                type: fields.model.type,
              },
              source: "$['model']",
            },
          },
        ],
        reference: "model",
        rootReference: "payload",
      },
      {
        label: "Product",
        operations: [
          {
            operationType: "parse",
            parse: {
              returns: {
                array: false,
                type: fields.product.type,
              },
              source: "$['product']",
            },
          },
        ],
        reference: "product",
        rootReference: "payload",
      },
    ],
  },
})

const webhookRecipient = new honeycomb.WebhookRecipient(`IncidentWebhook`, {
  name: "Incident.io",
  url: alertSource.alertEventsUrl,
  secret: alertSource.secretToken,
  templates: [
    {
      type: "trigger",
      body: $jsonStringify({
        title: "{{ .Name }}",
        description: "{{ .Description }}",
        status: "{{ .Alert.Status }}",
        deduplication_key: "{{ .Alert.InstanceID }}",
        source_url: "{{ .Result.URL }}",
        model: "{{ .Vars.model }}",
        product: "{{ .Vars.product }}",
      }),
    },
  ],
  variables: [
    {
      name: "model",
    },
    {
      name: "product",
    },
  ],
})

new incident.AlertRoute("HoneycombAlertRoute", {
  name: $app.stage === "production" ? "Honeycomb" : `Honeycomb (${$app.stage})`,
  enabled: true,
  isPrivate: false,
  alertSources: [
    {
      alertSourceId: alertSource.id,
      conditionGroups: [
        {
          conditions: [
            {
              subject: "alert.title",
              operation: "is_set",
              paramBindings: [],
            },
          ],
        },
      ],
    },
  ],
  conditionGroups: [
    {
      conditions: [
        {
          subject: "alert.title",
          operation: "is_set",
          paramBindings: [],
        },
      ],
    },
  ],
  expressions: [],
  escalationConfig: {
    autoCancelEscalations: true,
    escalationTargets: [],
  },
  incidentConfig: {
    autoDeclineEnabled: true,
    enabled: true,
    conditionGroups: [],
    deferTimeSeconds: 0,
    groupingKeys: [
      {
        reference: $interpolate`alert.attributes.${fields.model.id}`,
      },
      {
        reference: $interpolate`alert.attributes.${fields.product.id}`,
      },
    ],
    groupingWindowSeconds: 900,
  },
  incidentTemplate: {
    name: {
      value: {
        literal: varSpec("Alert -> Title", "alert.title"),
      },
    },
    summary: {
      value: {
        literal: varSpec("Alert -> Description", "alert.description"),
      },
    },
    startInTriage: {
      value: {
        literal: "true",
      },
    },
    severity: {
      mergeStrategy: "first-wins",
    },
    incidentMode: {
      value: {
        literal: "standard",
        // literal: $app.stage === "production" ? "standard" : "test",
      },
    },
  },
})

type Product = "go" | "zen"

type Trigger = (opts: { model: string; product: Product }) => {
  id: string
  title: string
  description: string
  json: honeycomb.GetQuerySpecificationOutputArgs
  thresholds: honeycomb.TriggerArgs["thresholds"]
}

type Model = { id: string; products: Product[]; triggers: Trigger[] }

const httpErrors: Trigger = ({ model, product }: { model: string; product: Product }) => ({
  id: `IncreasedHttpErrors`,
  title: `Increased HTTP Errors for ${displayName(model)} on ${displayName(product)}`,
  description: `Detected increased rate of HTTP errors for ${displayName(model)} on OpenCode ${displayName(product)}`,
  json: {
    calculations: [
      {
        op: "COUNT",
        name: "TOTAL",
        filterCombination: "AND",
        filters: [
          { column: "model", op: "=", value: model },
          { column: "isGoTier", op: "=", value: product === "go" ? "true" : "false" },
        ],
      },
      {
        op: "COUNT",
        name: "FAILED",
        filterCombination: "AND",
        filters: [
          { column: "model", op: "=", value: model },
          { column: "isGoTier", op: "=", value: product === "go" ? "true" : "false" },
          { column: "status", op: ">=", value: "400" },
          { column: "status", op: "!=", value: "401" },
        ],
      },
    ],
    formulas: [{ name: "ERROR", expression: "$FAILED / $TOTAL" }],
    timeRange: 900,
  },
  thresholds: [{ op: ">=", value: 50, exceededLimit: 1 }],
})

const models: Model[] = [
  { id: "kimi-k2.6", products: ["go", "zen"], triggers: [httpErrors] },
  { id: "claude-opus-4.7", products: ["zen"], triggers: [httpErrors] },
]

for (const model of models) {
  for (const product of model.products) {
    for (const trigger of model.triggers) {
      const spec = trigger({ model: model.id, product })

      new honeycomb.Trigger(`${spec.id}${resourceName(product)}${resourceName(model.id)}`, {
        name: spec.title,
        description: spec.description,
        queryJson: honeycomb.getQuerySpecificationOutput(spec.json).json,
        frequency: 900,
        alertType: "on_change",
        baselineDetails: [{ type: "percentage", offsetMinutes: 60 }],
        thresholds: spec.thresholds,
        recipients: [
          {
            id: webhookRecipient.id,
            notificationDetails: [
              {
                variables: [
                  { name: "model", value: model.id },
                  { name: "product", value: product },
                ],
              },
            ],
          },
        ],
      })
    }
  }
}
