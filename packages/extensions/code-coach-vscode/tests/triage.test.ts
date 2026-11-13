import { describe, expect, test } from "bun:test";
import { decide, score } from "../src/triage";

describe("defeat - the engine", () => {
  test("silence on a polite question", () => {
    const d = decide("summarize the current state of the parser", "build a list of names");
    expect(d.kind).toBe("none");
  });

  test("password without hashing -> two findings", () => {
    const d = decide("add a login endpoint that checks the user's password against the database", "create user table");
    expect(d.kind).toBe("nudge");
    expect(d.findings).toHaveLength(2);
    expect(d.findings.map((f) => f.id)).toEqual(["plaintext-password", "rate-limit"]);
  });

  test("hash and rate in the diff -> silent", () => {
    const d = decide(
      "add a login endpoint that checks the user's password against the database",
      "bcrypt.hashSync(password); rate limit 5 per minute"
    );
    expect(d.kind).toBe("none");
  });

  test("one-liner rate-limit suppresses the rate finding", () => {
    const d = decide(
      "add a login endpoint that checks the password against the database and rate limit",
      "create user table"
    );
    expect(d.findings).toHaveLength(1);
    expect(d.findings[0].id).toBe("plaintext-password");
  });

  test("hardcoded key -> secret (critical)", () => {
    const d = decide("add an endpoint that requires a secret", "const key = \"sk-1234\"");
    expect(d.findings[0].id).toBe("secret-in-code");
    expect(d.findings[0].severity).toBe("critical");
  });

  test("sql from input -> critical", () => {
    const d = decide("add a search that filters by the user", "query(\"select * from t where c = '\" + req.query.q + \"'\")");
    expect(d.findings[0].id).toBe("sql-concat");
  });

  test("command from input -> critical", () => {
    const d = decide("run whatever the user typed", "exec(\"bash -c '\" + userInput + \"'\"");
    expect(d.findings[0].id).toBe("shell-exec");
  });

  test("user content rendered as HTML", () => {
    const d = decide("render the comment", "el.innerHTML = comment");
    expect(d.findings[0].id).toBe("xss");
  });

  test("eval runs untrusted code", () => {
    const d = decide("execute the snippet", "eval(snippet)");
    expect(d.findings[0].id).toBe("eval");
  });

  test("leftover TODO in the diff", () => {
    const d = decide("add the route", "route.get('/', () => { // TODO fix this })");
    expect(d.findings[0].id).toBe("todo-leftover");
  });

  test("cap at two", () => {
    const d = decide("add a login endpoint that checks the password", "const k = \"sk-1\" + \"\"; eval(req.body.q); console.log('hi');");
    expect(d.findings).toHaveLength(2);
    expect(d.findings.map((f) => f.id)).toEqual(["secret-in-code", "plaintext-password"]);
  });

  test("mastered tags are not re-taught", () => {
    const d = decide("add a login endpoint that checks the password against the database", "create user table", ["password-hashing", "rate-limiting"]);
    expect(d.kind).toBe("none");
  });

  test("empty input -> none", () => {
    const d = decide("", "");
    expect(d.kind).toBe("none");
  });
});
