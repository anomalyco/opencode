import { describe, expect, test } from "bun:test"
import { BRANDS, resolveBrand, resolveBrandId } from "../src/index"
import { logoMuc, logoHubu } from "../src/logos"
import mucJson from "../brands/muc/brand.json"
import hubuJson from "../brands/hubu/brand.json"

describe("brand registry", () => {
  test("brand.json 镜像与 TS 事实源一致（防漂移）", () => {
    expect(mucJson).toEqual(BRANDS.muc!)
    expect(hubuJson).toEqual(BRANDS.hubu!)
  })

  test("resolveBrandId: BRAND 优先于 CHANNEL；hubu/prod/muc/默认", () => {
    expect(resolveBrandId({ BRAND: "hubu" })).toBe("hubu")
    expect(resolveBrandId({ OPENCODE_CHANNEL: "hubu" })).toBe("hubu")
    expect(resolveBrandId({ OPENCODE_CHANNEL: "prod" })).toBe("opencode")
    expect(resolveBrandId({ OPENCODE_CHANNEL: "muc" })).toBe("muc")
    expect(resolveBrandId({})).toBe("muc")
  })

  test("hubu 深链协议与 exchange 路径", () => {
    expect(resolveBrand({ BRAND: "hubu" }).protocolScheme).toBe("hubu")
    expect(resolveBrand({ BRAND: "hubu" }).exchangePath).toBe("/api/v1/hubu/exchange")
    expect(resolveBrand({ BRAND: "muc" }).exchangePath).toBe("/api/v1/muc/exchange")
  })

  test("ASCII 画行数一致（hubu 左右等宽）", () => {
    for (const l of [logoMuc, logoHubu]) expect(l.left.length).toBe(l.right.length)
    // hubu 为规整块状字：左右同列数
    for (let i = 0; i < logoHubu.left.length; i++) {
      expect(logoHubu.left[i]!.length).toBe(logoHubu.right[i]!.length)
    }
  })
})
