import { expect, test } from "bun:test"
import { hostDisplay } from "./host-display"

test("draws the real web authority independently of the path and in ASCII", () => {
  expect(hostDisplay("https://accounts.example.com.long.tenant.example.co.uk/docs?x#y")).toEqual({scheme:"https://",host:"accounts.example.com.long.tenant.example.co.uk",rest:"/docs?x#y"})
  expect(hostDisplay("https://bücher.de/")?.host).toBe("xn--bcher-kva.de")
  expect(hostDisplay("http://[::1]:1234/path")?.host).toBe("[::1]:1234")
  expect(hostDisplay("https://label@example.test/")).toBeUndefined()
  expect(hostDisplay("workspace://session/path")).toBeUndefined()
})
