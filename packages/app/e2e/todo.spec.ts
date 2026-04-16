import { test } from "@playwright/test"

test(
  "test something cool",
  {
    annotation: { type: "todo" },
  },
  async () => {
    test.fixme()
  },
)
