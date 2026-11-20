import { describe, expect, test } from "bun:test"
import { OpencodeMemoryAccess } from "@opencode/core/plugin/provider/opencode-memory-access"

describe("OpencodeMemoryAccess.secret", () => {
  test("names a prefix-anchored key format, never its value", () => {
    expect(OpencodeMemoryAccess.secret(`export GH=ghp_${"a".repeat(36)}`)).toBe("a GitHub token")
    expect(OpencodeMemoryAccess.secret("AKIAABCDEFGHIJKLMNOP is the key")).toBe("an AWS access key")
    expect(OpencodeMemoryAccess.secret(`sk-ant-api03-${"b".repeat(40)}`)).toBe("an Anthropic key")
    expect(OpencodeMemoryAccess.secret("-----BEGIN OPENSSH PRIVATE KEY-----\nabc")).toBe("a private key")
    expect(OpencodeMemoryAccess.secret("Use the token from the vault, never paste one.")).toBeUndefined()
  })

  test("rejects literal credentials in command arguments, and lets references and placeholders through", () => {
    const secret = OpencodeMemoryAccess.secret
    expect(secret("PGPASSWORD=hunter2 psql -h db")).toBe("a password, secret or token assigned to a variable")
    expect(secret("PGPASSWORD=$PGPASSWORD psql -h db")).toBeUndefined()
    expect(secret("OPENAI_API_KEY=abc123 bun run eval")).toBe("a password, secret or token assigned to a variable")
    expect(
      secret('GH_TOKEN=${{ secrets.GH_TOKEN }} gh pr list, or NPM_TOKEN=<token>, or DB_PASSWORD=""'),
    ).toBeUndefined()
    // Only assignments count: a variable named in prose, or one merely ending in TOKEN_URL, doesn't.
    expect(secret("Set API_TOKEN in CI; TOKEN_URL=https://x.io/t is public")).toBeUndefined()
    expect(secret("psql --password=hunter2")).toBe("a password after --password=")
    expect(secret(`curl -H "Authorization: Basic dXNlcjpwdw==" https://api`)).toBe(
      "a credential in an Authorization header",
    )
    expect(secret(`hf_${"c".repeat(34)}`)).toBe("a Hugging Face token")
    expect(secret(`oc_sk_abcd1234_${"d".repeat(20)}`)).toBe("an OpenCode Console key")
    expect(secret("mysql -uroot -ps3cret app")).toBe("a password after mysql -p")
    expect(secret("mysql -u root -p app")).toBeUndefined()
    expect(secret("sshpass -p 'pw' ssh deploy@host")).toBe("a password after sshpass -p")
    expect(secret(`curl -H "Authorization: Bearer abc123" https://api`)).toBe("a credential in an Authorization header")
    expect(secret(`curl -H "Authorization: Bearer $TOKEN" https://api`)).toBeUndefined()
    expect(secret("DATABASE_URL=postgres://app:s3cret@db:5432/app")).toBe("a password in a URL")
    expect(secret("DATABASE_URL=postgres://app:${DB_PASSWORD}@db:5432/app")).toBeUndefined()
    expect(secret("postgres://app:<password>@db/app or https://github.com/acme/api")).toBeUndefined()
  })
})

describe("OpencodeMemoryAccess.share", () => {
  test("localizes every text but oldText, and names the first field with a secret", () => {
    const roots = { checkout: "/home/ada/src/api", home: "/home/ada" }
    expect(
      OpencodeMemoryAccess.share(
        {
          kind: "gotcha",
          paths: ["/home/ada/src/api/db/"],
          edits: [{ oldText: "/home/ada/src/api/x", newText: "/home/ada/src/api/y" }],
        },
        roots,
      ),
    ).toEqual({
      fields: { kind: "gotcha", paths: ["db/"], edits: [{ oldText: "/home/ada/src/api/x", newText: "y" }] },
    })
    expect(OpencodeMemoryAccess.share({ title: "ok", errors: ["fine", "mysql -uroot -ps3cret"] }, roots)).toEqual({
      field: "errors[1]",
      kind: "a password after mysql -p",
      repair: "Replace it with a variable reference such as $TOKEN or a placeholder such as <password>",
    })
    // Another account's home directory is left after localizing, and refused; the user's own becomes ~/.
    expect(OpencodeMemoryAccess.share({ body: "Logs in /home/ada/.cache and /home/bob/.cache" }, roots)).toMatchObject({
      field: "body",
      kind: "a path in a home directory",
    })
    expect(OpencodeMemoryAccess.share({ body: "Logs in /home/ada/.cache, not /root2 or /srv/root" }, roots)).toEqual({
      fields: { body: "Logs in ~/.cache, not /root2 or /srv/root" },
    })
  })
})

describe("OpencodeMemoryAccess.share, internal hosts", () => {
  test("refuses private addresses and internal-only host names, and keeps public ones and versions", () => {
    const share = (body: string) => OpencodeMemoryAccess.share({ body }, {})
    for (const body of [
      "psql -h 10.2.0.15 app",
      "curl http://192.168.1.20:8080",
      "ssh deploy@172.20.4.1",
      "vault-db.internal:5432",
      "build.corp/api",
    ])
      expect(share(body)).toMatchObject({ field: "body", kind: "an internal host name or address" })
    for (const body of [
      "curl http://localhost:3000 and 127.0.0.1",
      "https://api.github.com",
      "Windows 10.0.19041.1",
      "172.32.0.1 is public",
      "Bump to 1.10.2.3",
    ])
      expect(share(body)).toEqual({ fields: { body } })
  })
})

describe("OpencodeMemoryAccess.share, scratch paths", () => {
  test("refuses a path into this machine's scratch space, unless it's inside the checkout", () => {
    expect(OpencodeMemoryAccess.share({ body: "Built a shim in /tmp/opencode/cat-wrapper" }, {})).toMatchObject({
      field: "body",
      kind: "a scratch path (/tmp/…)",
    })
    expect(OpencodeMemoryAccess.share({ body: "See /tmp/work/repo/src/a.ts" }, { checkout: "/tmp/work/repo" })).toEqual(
      {
        fields: { body: "See src/a.ts" },
      },
    )
  })
})

describe("OpencodeMemoryAccess.localize", () => {
  test("makes the checkout's paths relative and other home paths start at ~/", () => {
    const roots = { checkout: "/home/ada/src/api", home: "/home/ada" }
    expect(
      OpencodeMemoryAccess.localize(
        "Edit /home/ada/src/api/src/pricing.ts, run from /home/ada/src/api; logs in /home/ada/.cache/x.log",
        roots,
      ),
    ).toBe("Edit src/pricing.ts, run from .; logs in ~/.cache/x.log")
    expect(OpencodeMemoryAccess.localize("file:///home/ada/src/api/README.md", roots)).toBe("README.md")
    // A sibling whose name only starts like the checkout isn't inside it.
    expect(OpencodeMemoryAccess.localize("/home/ada/src/api-v2/x.ts", roots)).toBe("~/src/api-v2/x.ts")
  })
})
