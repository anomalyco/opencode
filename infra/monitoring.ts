const targets = ["kimi-k2.6"]

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

const modelField = incident.getAlertAttributeOutput({ name: "Model" })

const alertSource = new incident.AlertSource("HoneycombAlertSource", {
  name: "Honeycomb",
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
        alertAttributeId: modelField.id,
        binding: {
          value: {
            reference: 'expressions["model"]',
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
                type: modelField.type,
              },
              source: "$['model']",
            },
          },
        ],
        reference: "model",
        rootReference: "payload",
      },
    ],
  },
})

const webhookRecipient = new honeycomb.WebhookRecipient(`IncidentWebhook`, {
  name: "Incident.io Webhook Recipient",
  url: alertSource.alertEventsUrl,
  secret: alertSource.secretToken,
  templates: [
    {
      type: "trigger",
      body: $jsonStringify({
        title: "{{ .Alert.Summary }}",
        description: "{{ .Description }}",
        status: '{{ if eq .Alert.Status "TRIGGERED"}}firing{{ else }}resolved{{ end }}',
        deduplication_key: "{{ .Alert.InstanceID }}",
        source_url: "{{ .URL }}",
        model: "{{ .Vars.model }}",
      }),
    },
  ],
  variables: [
    {
      name: "model",
    },
  ],
})

new incident.AlertRoute("HoneycombAlertRoute", {
  name: "Honeycomb Alerts",
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
        reference: $interpolate`alert.attributes.${modelField.id}`,
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
  },
})

for (const model of targets) {
  const name = model.replace(/[^a-zA-Z0-9 ]/g, "")

  const query = honeycomb.getQuerySpecificationOutput({
    calculations: [
      {
        op: "COUNT",
        name: "TOTAL",
        filterCombination: "AND",
        filters: [
          {
            column: "model",
            op: "=",
            value: model,
          },
        ],
      },
      {
        op: "COUNT",
        name: "FAILED",
        filterCombination: "AND",
        filters: [
          {
            column: "model",
            op: "=",
            value: model,
          },
          {
            column: "status",
            op: ">=",
            value: "400",
          },
          {
            column: "status",
            op: "!=",
            value: "401",
          },
        ],
      },
    ],
    formulas: [
      {
        name: "ERROR",
        expression: "$FAILED / $TOTAL",
      },
    ],
    timeRange: 900,
  })

  new honeycomb.Trigger(`IncreasedHTTPErrors${name}`, {
    name: `Increased HTTP Errors (${model})`,
    description: `Detected increased rate of HTTP errors for model ${name}`,
    queryJson: query.json,
    frequency: 900,
    alertType: "on_change",
    baselineDetails: [
      {
        type: "percentage",
        offsetMinutes: 60,
      },
    ],
    thresholds: [
      {
        op: ">=",
        value: 50,
        exceededLimit: 1,
      },
    ],
    recipients: [
      {
        id: webhookRecipient.id,
        notificationDetails: [
          {
            variables: [
              {
                name: "model",
                value: model,
              },
            ],
          },
        ],
      },
    ],
  })
}
