import { describe, expect, test } from "bun:test"
import { promptAction } from "./action"

const t = (key: string) => key

describe("promptAction", () => {
  test("always prioritizes stop over pending annotation export states", () => {
    expect(
      promptAction({
        blank: false,
        count: 1,
        working: true,
        t,
      }),
    ).toEqual({
      kind: "stop",
      label: "prompt.action.stop",
      icon: "stop",
      hint: {
        kind: "text",
        label: "common.key.esc",
      },
      inactive: false,
    })

    expect(
      promptAction({
        blank: false,
        count: 3,
        working: true,
        t,
      }),
    ).toEqual({
      kind: "stop",
      label: "prompt.action.stop",
      icon: "stop",
      hint: {
        kind: "text",
        label: "common.key.esc",
      },
      inactive: false,
    })
  })

  test("resolves single annotation export copy", () => {
    expect(
      promptAction({
        blank: false,
        count: 1,
        working: false,
        t,
      }),
    ).toEqual({
      kind: "addCommentToPrompt",
      label: "prompt.action.addCommentToPrompt",
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: false,
    })
  })

  test("resolves multi annotation export copy", () => {
    expect(
      promptAction({
        blank: false,
        count: 3,
        working: false,
        t,
      }),
    ).toEqual({
      kind: "addCommentsToPrompt",
      label: "prompt.action.addCommentsToPrompt",
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: false,
    })
  })

  test("falls back to send only after annotation export states", () => {
    expect(
      promptAction({
        blank: true,
        count: 0,
        working: false,
        t,
      }),
    ).toEqual({
      kind: "send",
      label: "prompt.action.send",
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: true,
    })
  })

  test("keeps blank send inactive and non-blank send active", () => {
    expect(
      promptAction({
        blank: true,
        count: 0,
        working: false,
        t,
      }).inactive,
    ).toBe(true)

    expect(
      promptAction({
        blank: false,
        count: 0,
        working: false,
        t,
      }).inactive,
    ).toBe(false)
  })

  test("keeps idle send active for image-only drafts", () => {
    expect(
      promptAction({
        blank: false,
        count: 0,
        working: false,
        t,
      }),
    ).toEqual({
      kind: "send",
      label: "prompt.action.send",
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: false,
    })
  })

  test("keeps idle send active for file-comment-only drafts", () => {
    expect(
      promptAction({
        blank: false,
        count: 0,
        working: false,
        t,
      }),
    ).toEqual({
      kind: "send",
      label: "prompt.action.send",
      icon: "arrow-up",
      hint: {
        kind: "icon",
        name: "enter",
      },
      inactive: false,
    })
  })
})
