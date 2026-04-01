import { test, expect } from "bun:test"
import { CommandSemantics } from "../../src/permission/semantics"

test("classify read-only commands", () => {
  expect(CommandSemantics.classifyCommand("cat file.txt")).toBe("read")
  expect(CommandSemantics.classifyCommand("head -n 10 file.txt")).toBe("read")
  expect(CommandSemantics.classifyCommand("tail -f log.txt")).toBe("read")
  expect(CommandSemantics.classifyCommand("grep pattern file.txt")).toBe("read")
  expect(CommandSemantics.classifyCommand("rg search")).toBe("read")
  expect(CommandSemantics.classifyCommand("find . -name '*.ts'")).toBe("read")
  expect(CommandSemantics.classifyCommand("ls -la")).toBe("read")
  expect(CommandSemantics.classifyCommand("pwd")).toBe("read")
  expect(CommandSemantics.classifyCommand("which node")).toBe("read")
  expect(CommandSemantics.classifyCommand("git status")).toBe("read")
  expect(CommandSemantics.classifyCommand("git log")).toBe("read")
  expect(CommandSemantics.classifyCommand("git diff")).toBe("read")
  expect(CommandSemantics.classifyCommand("docker ps")).toBe("read")
  expect(CommandSemantics.classifyCommand("kubectl get pods")).toBe("read")
})

test("classify write commands", () => {
  expect(CommandSemantics.classifyCommand("touch file.txt")).toBe("write")
  expect(CommandSemantics.classifyCommand("mkdir new-dir")).toBe("write")
  expect(CommandSemantics.classifyCommand("cp source.txt dest.txt")).toBe("write")
  expect(CommandSemantics.classifyCommand("mv old.txt new.txt")).toBe("write")
  expect(CommandSemantics.classifyCommand("git add file.txt")).toBe("write")
  expect(CommandSemantics.classifyCommand("git commit -m 'fix'")).toBe("write")
  expect(CommandSemantics.classifyCommand("git checkout main")).toBe("write")
  expect(CommandSemantics.classifyCommand("npm install")).toBe("write")
  expect(CommandSemantics.classifyCommand("docker build .")).toBe("write")
  expect(CommandSemantics.classifyCommand("kubectl apply -f deploy.yaml")).toBe("write")
})

test("classify destructive commands", () => {
  expect(CommandSemantics.classifyCommand("rm file.txt")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("rmdir empty-dir")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("git reset --hard")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("git clean -fd")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("git push --force")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("git push -f")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("docker rm container")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("kubectl delete pod foo")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("kill -9 1234")).toBe("destructive")
})

test("classify network commands", () => {
  expect(CommandSemantics.classifyCommand("curl https://example.com")).toBe("network")
  expect(CommandSemantics.classifyCommand("wget file.zip")).toBe("network")
  expect(CommandSemantics.classifyCommand("ssh user@host")).toBe("network")
  expect(CommandSemantics.classifyCommand("docker pull nginx")).toBe("network")
  expect(CommandSemantics.classifyCommand("git fetch")).toBe("network")
  expect(CommandSemantics.classifyCommand("git pull")).toBe("network")
  expect(CommandSemantics.classifyCommand("git clone repo")).toBe("network")
  expect(CommandSemantics.classifyCommand("gh pr list")).toBe("network")
})

test("classify system commands", () => {
  expect(CommandSemantics.classifyCommand("sudo apt update")).toBe("system")
  expect(CommandSemantics.classifyCommand("chmod 755 script.sh")).toBe("system")
  expect(CommandSemantics.classifyCommand("chown user:group file.txt")).toBe("system")
  expect(CommandSemantics.classifyCommand("systemctl restart nginx")).toBe("system")
  expect(CommandSemantics.classifyCommand("useradd newuser")).toBe("system")
})

test("default to write for unknown commands", () => {
  expect(CommandSemantics.classifyCommand("unknowncommand")).toBe("write")
  expect(CommandSemantics.classifyCommand("foobar --baz")).toBe("write")
})

test("flags affect classification — --force escalates", () => {
  expect(CommandSemantics.classifyCommand("git push")).toBe("write")
  expect(CommandSemantics.classifyCommand("git push --force")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("git push -f")).toBe("destructive")
  expect(CommandSemantics.classifyCommand("npm publish")).toBe("network")
})

test("getPermissionAction maps semantics to actions", () => {
  const policy = CommandSemantics.defaultPolicy()
  expect(CommandSemantics.getPermissionAction("read", policy)).toBe("allow")
  expect(CommandSemantics.getPermissionAction("write", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("destructive", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("network", policy)).toBe("ask")
  expect(CommandSemantics.getPermissionAction("system", policy)).toBe("ask")
})

test("plan agent policy denies destructive", () => {
  const policy = CommandSemantics.planAgentPolicy()
  expect(policy.read).toBe("allow")
  expect(policy.write).toBe("deny")
  expect(policy.destructive).toBe("deny")
  expect(policy.network).toBe("ask")
  expect(policy.system).toBe("deny")
})

test("explore agent policy allows read and network", () => {
  const policy = CommandSemantics.exploreAgentPolicy()
  expect(policy.read).toBe("allow")
  expect(policy.write).toBe("ask")
  expect(policy.destructive).toBe("deny")
  expect(policy.network).toBe("allow")
  expect(policy.system).toBe("deny")
})

test("custom rules override defaults", () => {
  const customPolicy: CommandSemantics.Policy = {
    ...CommandSemantics.defaultPolicy(),
    "git push": "deny",
  }
  expect(CommandSemantics.getPermissionAction("write", customPolicy, ["git", "push"])).toBe("deny")
  expect(CommandSemantics.getPermissionAction("write", customPolicy, ["git", "add"])).toBe("ask")
})
