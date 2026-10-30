import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type FormInfo, type OpenCodeEvent } from "../src/promise"

const form = (sessionID: string): FormInfo => ({
  id: "frm_1",
  sessionID,
  title: "Questions",
  fields: [{ key: "q0", type: "string", title: "Pick one", options: [{ value: "a", label: "a" }] }],
})

function fixture() {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({ baseUrl: "http://opencode.local", fetch: async () => Response.json({ data: [] }) })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    emit: (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event })),
    dispose,
  }))
}

test("a session form created without a location is stored", () => {
  const setup = fixture()
  try {
    setup.emit({ id: "evt_1", type: "form.created", created: 1, data: { form: form("ses_1") } })
    expect(setup.data.session.form.list("ses_1")?.map((item) => item.id)).toEqual(["frm_1"])
  } finally {
    setup.dispose()
  }
})

test("a located session form is stored once", () => {
  const setup = fixture()
  try {
    setup.emit({
      id: "evt_1",
      type: "form.created",
      created: 1,
      location: { directory: "/project" },
      data: { form: form("ses_1") },
    })
    expect(setup.data.session.form.list("ses_1")?.map((item) => item.id)).toEqual(["frm_1"])
  } finally {
    setup.dispose()
  }
})

test("a global form without a location is not attributed to a location", () => {
  const setup = fixture()
  try {
    setup.emit({ id: "evt_1", type: "form.created", created: 1, data: { form: form("global") } })
    expect(setup.data.session.form.list("global", { directory: "/project" })).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("a located global form is stored for its location", () => {
  const setup = fixture()
  try {
    setup.emit({
      id: "evt_1",
      type: "form.created",
      created: 1,
      location: { directory: "/project" },
      data: { form: form("global") },
    })
    expect(setup.data.session.form.list("global", { directory: "/project" })?.map((item) => item.id)).toEqual(["frm_1"])
  } finally {
    setup.dispose()
  }
})
