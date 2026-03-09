import { describe, expect, test } from "bun:test"
import { BashWrapper } from "../../src/permission/wrapper"

describe("BashWrapper.extract", () => {
  describe("each wrapper type", () => {
    test("nohup", () => {
      expect(BashWrapper.extract(["nohup", "git", "push"])).toEqual([["git", "push"]])
    })

    test("time", () => {
      expect(BashWrapper.extract(["time", "make", "build"])).toEqual([["make", "build"]])
    })

    test("timeout", () => {
      expect(BashWrapper.extract(["timeout", "5", "curl", "http://example.com"])).toEqual([
        ["curl", "http://example.com"],
      ])
    })

    test("nice", () => {
      expect(BashWrapper.extract(["nice", "-n", "5", "make"])).toEqual([["make"]])
    })

    test("ionice", () => {
      expect(BashWrapper.extract(["ionice", "-c", "2", "-n", "7", "dd", "if=/dev/zero"])).toEqual([
        ["dd", "if=/dev/zero"],
      ])
    })

    test("stdbuf", () => {
      expect(BashWrapper.extract(["stdbuf", "-oL", "tail", "-f", "log.txt"])).toEqual([["tail", "-f", "log.txt"]])
    })

    test("watch", () => {
      expect(BashWrapper.extract(["watch", "-n", "1", "kubectl", "get", "pods"])).toEqual([
        ["kubectl", "get", "pods"],
      ])
    })

    test("sudo", () => {
      expect(BashWrapper.extract(["sudo", "rm", "-rf", "/"])).toEqual([["rm", "-rf", "/"]])
    })

    test("sudo with flags", () => {
      expect(BashWrapper.extract(["sudo", "-u", "root", "systemctl", "restart", "nginx"])).toEqual([
        ["systemctl", "restart", "nginx"],
      ])
    })

    test("env", () => {
      expect(BashWrapper.extract(["env", "node", "server.js"])).toEqual([["node", "server.js"]])
    })

    test("xargs", () => {
      expect(BashWrapper.extract(["xargs", "-I{}", "gh", "api", "-X", "DELETE"])).toEqual([
        ["gh", "api", "-X", "DELETE"],
      ])
    })

    test("xargs with split flag and arg", () => {
      expect(BashWrapper.extract(["xargs", "-I", "{}", "rm"])).toEqual([["rm"]])
    })
  })

  describe("flag handling", () => {
    test("combined flag+arg", () => {
      expect(BashWrapper.extract(["xargs", "-I{}", "echo"])).toEqual([["echo"]])
    })

    test("split flag and arg", () => {
      expect(BashWrapper.extract(["xargs", "-I", "{}", "echo"])).toEqual([["echo"]])
    })

    test("boolean flag", () => {
      expect(BashWrapper.extract(["sudo", "-n", "ls"])).toEqual([["ls"]])
    })

    test("long flag with =", () => {
      expect(BashWrapper.extract(["timeout", "--signal=KILL", "5", "sleep", "10"])).toEqual([["sleep", "10"]])
    })

    test("-- terminator", () => {
      expect(BashWrapper.extract(["sudo", "--", "rm", "-rf", "/tmp/x"])).toEqual([["rm", "-rf", "/tmp/x"]])
    })
  })

  describe("env specifics", () => {
    test("VAR=val skipping", () => {
      expect(BashWrapper.extract(["env", "FOO=bar", "BAZ=qux", "node", "app.js"])).toEqual([["node", "app.js"]])
    })

    test("mixed flags and assignments", () => {
      expect(BashWrapper.extract(["env", "-u", "HOME", "PATH=/usr/bin", "sh", "-c", "echo"])).toEqual([
        ["sh", "-c", "echo"],
      ])
    })
  })

  describe("timeout positional", () => {
    test("duration arg skipped before inner command", () => {
      expect(BashWrapper.extract(["timeout", "30s", "npm", "test"])).toEqual([["npm", "test"]])
    })

    test("with flags and duration", () => {
      expect(BashWrapper.extract(["timeout", "--signal=KILL", "10", "make"])).toEqual([["make"]])
    })
  })

  describe("find -exec", () => {
    test("single -exec", () => {
      expect(BashWrapper.extract(["find", ".", "-name", "*.log", "-exec", "rm", "{}", ";"])).toEqual([["rm"]])
    })

    test("-execdir", () => {
      expect(BashWrapper.extract(["find", "/tmp", "-execdir", "chmod", "644", "{}", ";"])).toEqual([["chmod", "644"]])
    })

    test("multiple -exec clauses", () => {
      expect(
        BashWrapper.extract([
          "find",
          ".",
          "-exec",
          "echo",
          "{}",
          ";",
          "-exec",
          "rm",
          "{}",
          "+",
        ]),
      ).toEqual([["echo"], ["rm"]])
    })

    test("escaped terminator", () => {
      expect(BashWrapper.extract(["find", ".", "-exec", "cat", "{}", "\\;"])).toEqual([["cat"]])
    })
  })

  describe("nested wrappers", () => {
    test("timeout + sudo", () => {
      expect(BashWrapper.extract(["timeout", "5", "sudo", "gh", "api"])).toEqual([["gh", "api"]])
    })

    test("nohup + nice + make", () => {
      expect(BashWrapper.extract(["nohup", "nice", "-n", "10", "make", "build"])).toEqual([["make", "build"]])
    })

    test("sudo + env + node", () => {
      expect(BashWrapper.extract(["sudo", "env", "NODE_ENV=prod", "node", "app.js"])).toEqual([["node", "app.js"]])
    })
  })

  describe("non-wrappers", () => {
    test("regular command returns empty", () => {
      expect(BashWrapper.extract(["git", "checkout", "main"])).toEqual([])
    })

    test("unknown command returns empty", () => {
      expect(BashWrapper.extract(["myapp", "--verbose"])).toEqual([])
    })
  })

  describe("edge cases", () => {
    test("empty tokens", () => {
      expect(BashWrapper.extract([])).toEqual([])
    })

    test("wrapper with no args", () => {
      expect(BashWrapper.extract(["nohup"])).toEqual([])
    })

    test("wrapper with only flags", () => {
      expect(BashWrapper.extract(["sudo", "-n"])).toEqual([])
    })

    test("timeout with only duration", () => {
      expect(BashWrapper.extract(["timeout", "5"])).toEqual([])
    })
  })
})
