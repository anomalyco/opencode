export const PACKAGE_JSON =
  JSON.stringify(
    {
      name: "eval-task",
      private: true,
      type: "module",
      scripts: { test: "bun test" },
    },
    null,
    2,
  ) + "\n"
