import { defineFlows, defineScreens, defineTaxonomies } from "./dsl"
import { defineExecutableFlow, executeFlow } from "./flow"

const taxonomies = defineTaxonomies({
  screenLabels: {
    session: { label: "Session", items: { "session-list": "Session list" } },
  },
  uiElements: {
    selection: { label: "Selection", items: { picker: "Picker" } },
  },
})

const screens = defineScreens(taxonomies, {
  "session-picker": {
    title: "Session picker",
    category: "session",
    screenLabels: ["session-list"],
    uiElements: ["picker"],
    surfaces: "modal",
    patterns: "picker",
    features: "session",
    states: "default",
  },
})

// @ts-expect-error Unknown screen labels are rejected at the authoring site.
defineScreens(taxonomies, {
  invalid: {
    title: "Invalid",
    category: "session",
    screenLabels: ["session-lits"],
    uiElements: ["picker"],
    surfaces: "modal",
    patterns: "picker",
    features: "session",
    states: "default",
  },
})

defineScreens(taxonomies, {
  invalid: {
    title: "Invalid",
    category: "session",
    screenLabels: ["session-list"],
    uiElements: ["picker"],
    // @ts-expect-error Closed facet vocabularies reject typo-created filters.
    surfaces: "modla",
    patterns: "picker",
    features: "session",
    states: "default",
  },
})

// @ts-expect-error Flow steps can only reference authored screen keys.
defineFlows(screens, {
  session: {
    label: "Session",
    flows: {
      invalid: {
        title: "Invalid flow",
        description: "Type-level reference check.",
        steps: [
          {
            capture: "session-pikcer",
            title: "Open the picker",
          },
        ],
      },
    },
  },
})

const firstFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "first-flow",
    title: "First flow",
    group: { id: "tests", label: "Tests" },
    description: "First flow.",
  },
  ({ state, program }) => {
    const first = state("first", {
      screen: screens["session-picker"],
      step: { title: "First" },
    })
    return program([first], ({ checkpoint }) => checkpoint(first))
  },
)

const secondFlow = defineExecutableFlow(
  taxonomies,
  {
    id: "second-flow",
    title: "Second flow",
    group: { id: "tests", label: "Tests" },
    description: "Second flow.",
  },
  ({ state, program }) => {
    const second = state("second", {
      screen: screens["session-picker"],
      step: { title: "Second" },
    })
    return program([second], ({ checkpoint }) => {
      // @ts-expect-error Checkpoints only accept states declared by this flow.
      return checkpoint(firstFlow.states[0])
    })
  },
)

executeFlow(secondFlow, {
  driver: undefined as never,
  // @ts-expect-error Selected states must belong to the executed flow.
  through: firstFlow.states[0],
  capture: () => undefined as never,
})
