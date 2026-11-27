import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login` with every form answer given as `--answer`: JSON values, a hidden default, a `when` field.
export default defineCli({
  args: [
    "auth",
    "login",
    "acme",
    "--answer",
    "region=eu",
    "--answer",
    "team=core",
    "--answer",
    "seats=3",
    "--answer",
    "beta=true",
    "--answer",
    'scopes=["read","write"]',
    "--answer",
    "eu-only=yes",
  ],
  env: sink,
  server: {
    routes: [...integrationRoutes(), { method: "POST", path: "/api/integration/acme/connect/external", status: 204 }],
  },
})
