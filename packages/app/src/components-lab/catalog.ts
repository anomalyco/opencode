/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- CSF args are props each story owns; the lab forwards them */
import { Schema } from "effect"
import { choice, knob, text, toggle, type Field } from "knobs"
import type { Component, JSX } from "solid-js"

// Storybook's CSF as the stories in this repository write it: a default meta and named stories with args.
type StoryArg = string | number | boolean | null | undefined | object

export type StoryArgs = { [key: string]: StoryArg }

type StoryRender = (args: StoryArgs) => JSX.Element

type ArgType = {
  control?: string | { type?: string; min?: number; max?: number; step?: number }
  options?: readonly string[]
}

// The default export (a meta) and each named story share this shape; a story may also be a bare render function.
type StoryObject = {
  title?: string
  name?: string
  component?: Component<StoryArgs>
  args?: StoryArgs
  argTypes?: { [key: string]: ArgType }
  render?: StoryRender
  // `motion` names the Knobs (by id, group or card) the story uses, so the inspector shows them beside its args.
  parameters?: { layout?: string; motion?: readonly string[] }
}

export type StoryModule = { [name: string]: StoryObject | StoryRender | string[] | undefined }

/** One named story: a state of its component that the lab can switch to. */
export type LabState = { name: string; args: StoryArgs; render?: StoryRender }

export type LabEntry = {
  file: string
  title: string
  component?: Component<StoryArgs>
  args: StoryArgs
  argTypes: { [key: string]: ArgType }
  render?: StoryRender
  fullscreen: boolean
  motion: readonly string[]
  states: LabState[]
}

// A story file as the lab shows it. A module lists its exports alphabetically, so `source`, the file's text, gives the
// order the author wrote the states in.
export function labEntry(file: string, module: StoryModule, source: string): LabEntry {
  const meta = isStoryObject(module.default) ? module.default : {}
  const order = [...source.matchAll(/^export const (\w+)/gm)].map((match) => match[1])

  const position = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length)

  const states = Object.entries(module)
    .toSorted(([a], [b]) => position(a) - position(b))
    .flatMap(([key, value]): LabState[] => {
      if (key === "default" || key === "__namedExportsOrder" || !value || Array.isArray(value)) return []

      if (isRender(value)) return [{ name: storyName(key), args: {}, render: value }]

      return [{ name: value.name ?? storyName(key), args: value.args ?? {}, render: value.render }]
    })

  return {
    file,
    title: meta.title ?? fileName(file),
    component: meta.component,
    args: meta.args ?? {},
    argTypes: {
      ...meta.argTypes,
      ...Object.assign(
        {},
        ...Object.values(module).flatMap((value) => (isStoryObject(value) && value.argTypes ? [value.argTypes] : [])),
      ),
    },
    render: meta.render,
    fullscreen: meta.parameters?.layout === "fullscreen",
    motion: meta.parameters?.motion ?? [],
    states,
  }
}

/** A story file's name: `composer-docks` for `…/composer-docks.stories.tsx`. */
export function fileName(file: string) {
  return file.replace(/^.*\//, "").replace(/\.stories\.tsx$/, "")
}

/** The args a state renders with: the meta's, then the state's own. */
export function stateArgs(entry: LabEntry, index: number) {
  return { ...entry.args, ...entry.states[index]?.args }
}

/**
 * A knob for every arg the meta or a state sets, typed by its argType or else by its value. Each starts at the first
 * state's value, which the panel's default preset shows. Text and object args keep the story's values: knobs has no
 * text field.
 */
export function labFields(entry: LabEntry) {
  const keys = new Set([
    ...Object.keys(entry.argTypes),
    ...Object.keys(entry.args),
    ...entry.states.flatMap((state) => Object.keys(state.args)),
  ])

  return Object.fromEntries(
    [...keys].flatMap((key): [string, Field][] => {
      const type = entry.argTypes[key]
      const value = stateArgs(entry, 0)[key] ?? entry.states.find((state) => key in state.args)?.args[key]
      const control = isText(type?.control) ? { type: type.control } : (type?.control ?? {})
      const [first, ...rest] = type?.options ?? []

      if (first !== undefined) return [[key, choice(isText(value) ? value : first, [first, ...rest])]]

      if (control.type === "boolean" || isBoolean(value)) return [[key, toggle(value === true, { random: true })]]

      if (control.type === "text" || isText(value)) return [[key, text(isText(value) ? value : "")]]

      if (control.type !== "number" && control.type !== "range" && !isNumber(value)) return []

      const start = isNumber(value) ? value : 0

      return [
        [
          key,
          knob(start, {
            min: "min" in control && control.min !== undefined ? control.min : Math.min(0, start),
            max: "max" in control && control.max !== undefined ? control.max : Math.max(10, start * 4),
            step: "step" in control && control.step !== undefined ? control.step : Number.isInteger(start) ? 1 : 0.01,
          }),
        ],
      ]
    }),
  )
}

/** The values a state gives those knobs. */
export function knobArgs(fields: { [key: string]: Field }, args: StoryArgs) {
  return Object.fromEntries(
    Object.keys(fields).flatMap((key) => {
      const value = args[key]

      return isText(value) || isNumber(value) || isBoolean(value) ? [[key, value]] : []
    }),
  )
}

// Storybook's name for an export: `QuestionAndPermission` reads "Question And Permission".
function storyName(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
}

function isRender(value: StoryObject | StoryRender): value is StoryRender {
  return value instanceof Function
}

function isStoryObject(value: StoryObject | StoryRender | string[] | undefined): value is StoryObject {
  return value !== undefined && !Array.isArray(value) && !isRender(value)
}

const isBoolean = Schema.is(Schema.Boolean)

const isNumber = Schema.is(Schema.Number)

const isText = Schema.is(Schema.String)
