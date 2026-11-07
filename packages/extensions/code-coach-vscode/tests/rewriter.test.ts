import { describe, expect, test } from "bun:test";
import { rewritePrompt } from "../src/rewriter";
import type { Finding } from "../src/triage";

const made: (id: string, fix: string) => Finding = (id, fix) => ({
  id,
  category: "security",
  severity: "warn",
  title: "",
  why: "",
  fix,
  tags: [],
});

describe("rewriter", () => {
  test("no findings -> original unchanged", () => {
    const out = rewritePrompt("add the login route", []);
    expect(out).toBe("add the login route");
  });

  test("rewrite keeps the original intent inside quotes", () => {
    const out = rewritePrompt(
      "add a login endpoint that checks the user's password",
      [made("plaintext-password", "store bcrypt with a per-user salt")]
    );
    expect(out).toContain("add a login endpoint that checks the user's password");
  });

  test("each finding gets its own line", () => {
    const out = rewritePrompt(
      "add a login endpoint that checks the password",
      [
        made("plaintext-password", "store bcrypt with a per-user salt"),
        made("rate-limit", "rate limit to 5 per minute"),
      ]
    );
    expect(out.split("\n- ").length).toBeGreaterThan(2);
  });
});
