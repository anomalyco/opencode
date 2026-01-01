import { describe, it, expect } from "bun:test"
import { Color } from "../../src/util/color"

describe("Color", () => {
  describe("isValidHex", () => {
    describe("valid hex colors", () => {
      it("should return true for valid 6-digit hex color with lowercase", () => {
        expect(Color.isValidHex("#ffffff")).toBe(true)
      })

      it("should return true for valid 6-digit hex color with uppercase", () => {
        expect(Color.isValidHex("#FFFFFF")).toBe(true)
      })

      it("should return true for valid 6-digit hex color with mixed case", () => {
        expect(Color.isValidHex("#FfFfFf")).toBe(true)
      })

      it("should return true for black color", () => {
        expect(Color.isValidHex("#000000")).toBe(true)
      })

      it("should return true for red color", () => {
        expect(Color.isValidHex("#ff0000")).toBe(true)
      })

      it("should return true for green color", () => {
        expect(Color.isValidHex("#00ff00")).toBe(true)
      })

      it("should return true for blue color", () => {
        expect(Color.isValidHex("#0000ff")).toBe(true)
      })

      it("should return true for hex with numbers and letters", () => {
        expect(Color.isValidHex("#1a2b3c")).toBe(true)
      })

      it("should return true for hex with all numbers", () => {
        expect(Color.isValidHex("#123456")).toBe(true)
      })

      it("should return true for hex with all letters", () => {
        expect(Color.isValidHex("#abcdef")).toBe(true)
      })

      it("should return true for hex with uppercase letters", () => {
        expect(Color.isValidHex("#ABCDEF")).toBe(true)
      })
    })

    describe("invalid hex colors", () => {
      it("should return false for undefined", () => {
        expect(Color.isValidHex(undefined)).toBe(false)
      })

      it("should return false for empty string", () => {
        expect(Color.isValidHex("")).toBe(false)
      })

      it("should return false for hex without hash", () => {
        expect(Color.isValidHex("ffffff")).toBe(false)
      })

      it("should return false for 3-digit hex color", () => {
        expect(Color.isValidHex("#fff")).toBe(false)
      })

      it("should return false for 8-digit hex color (with alpha)", () => {
        expect(Color.isValidHex("#ffffffff")).toBe(false)
      })

      it("should return false for 5-digit hex", () => {
        expect(Color.isValidHex("#fffff")).toBe(false)
      })

      it("should return false for 7-digit hex", () => {
        expect(Color.isValidHex("#fffffff")).toBe(false)
      })

      it("should return false for hex with invalid characters", () => {
        expect(Color.isValidHex("#gggggg")).toBe(false)
      })

      it("should return false for hex with spaces", () => {
        expect(Color.isValidHex("#ff ff ff")).toBe(false)
      })

      it("should return false for hex with special characters", () => {
        expect(Color.isValidHex("#ff@ff#")).toBe(false)
      })

      it("should return false for just hash", () => {
        expect(Color.isValidHex("#")).toBe(false)
      })

      it("should return false for multiple hashes", () => {
        expect(Color.isValidHex("##ffffff")).toBe(false)
      })

      it("should return false for hash at the end", () => {
        expect(Color.isValidHex("ffffff#")).toBe(false)
      })

      it("should return false for rgb string", () => {
        expect(Color.isValidHex("rgb(255,255,255)")).toBe(false)
      })

      it("should return false for color names", () => {
        expect(Color.isValidHex("white")).toBe(false)
      })

      it("should return false for null (cast to string)", () => {
        expect(Color.isValidHex(null as any)).toBe(false)
      })

      it("should return false for numbers", () => {
        expect(Color.isValidHex(123456 as any)).toBe(false)
      })
    })

    describe("edge cases", () => {
      it("should return false for whitespace", () => {
        expect(Color.isValidHex("   ")).toBe(false)
      })

      it("should return false for hex with leading whitespace", () => {
        expect(Color.isValidHex(" #ffffff")).toBe(false)
      })

      it("should return false for hex with trailing whitespace", () => {
        expect(Color.isValidHex("#ffffff ")).toBe(false)
      })

      it("should return false for hex with newline", () => {
        expect(Color.isValidHex("#ffffff\n")).toBe(false)
      })

      it("should return false for hex with tab", () => {
        expect(Color.isValidHex("#ffffff\t")).toBe(false)
      })
    })
  })

  describe("hexToRgb", () => {
    describe("basic color conversions", () => {
      it("should convert white to RGB", () => {
        const result = Color.hexToRgb("#ffffff")
        expect(result).toEqual({ r: 255, g: 255, b: 255 })
      })

      it("should convert black to RGB", () => {
        const result = Color.hexToRgb("#000000")
        expect(result).toEqual({ r: 0, g: 0, b: 0 })
      })

      it("should convert red to RGB", () => {
        const result = Color.hexToRgb("#ff0000")
        expect(result).toEqual({ r: 255, g: 0, b: 0 })
      })

      it("should convert green to RGB", () => {
        const result = Color.hexToRgb("#00ff00")
        expect(result).toEqual({ r: 0, g: 255, b: 0 })
      })

      it("should convert blue to RGB", () => {
        const result = Color.hexToRgb("#0000ff")
        expect(result).toEqual({ r: 0, g: 0, b: 255 })
      })

      it("should convert yellow to RGB", () => {
        const result = Color.hexToRgb("#ffff00")
        expect(result).toEqual({ r: 255, g: 255, b: 0 })
      })

      it("should convert cyan to RGB", () => {
        const result = Color.hexToRgb("#00ffff")
        expect(result).toEqual({ r: 0, g: 255, b: 255 })
      })

      it("should convert magenta to RGB", () => {
        const result = Color.hexToRgb("#ff00ff")
        expect(result).toEqual({ r: 255, g: 0, b: 255 })
      })
    })

    describe("case insensitivity", () => {
      it("should convert lowercase hex to RGB", () => {
        const result = Color.hexToRgb("#abcdef")
        expect(result).toEqual({ r: 171, g: 205, b: 239 })
      })

      it("should convert uppercase hex to RGB", () => {
        const result = Color.hexToRgb("#ABCDEF")
        expect(result).toEqual({ r: 171, g: 205, b: 239 })
      })

      it("should convert mixed case hex to RGB", () => {
        const result = Color.hexToRgb("#AbCdEf")
        expect(result).toEqual({ r: 171, g: 205, b: 239 })
      })
    })

    describe("numeric conversions", () => {
      it("should convert hex with all numbers", () => {
        const result = Color.hexToRgb("#123456")
        expect(result).toEqual({ r: 18, g: 52, b: 86 })
      })

      it("should convert hex with leading zeros", () => {
        const result = Color.hexToRgb("#010203")
        expect(result).toEqual({ r: 1, g: 2, b: 3 })
      })

      it("should convert hex with mid-range values", () => {
        const result = Color.hexToRgb("#7f7f7f")
        expect(result).toEqual({ r: 127, g: 127, b: 127 })
      })

      it("should convert hex to maximum values", () => {
        const result = Color.hexToRgb("#ffffff")
        expect(result.r).toBe(255)
        expect(result.g).toBe(255)
        expect(result.b).toBe(255)
      })

      it("should convert hex to minimum values", () => {
        const result = Color.hexToRgb("#000000")
        expect(result.r).toBe(0)
        expect(result.g).toBe(0)
        expect(result.b).toBe(0)
      })
    })

    describe("specific color values", () => {
      it("should convert orange-like color", () => {
        const result = Color.hexToRgb("#ff8800")
        expect(result).toEqual({ r: 255, g: 136, b: 0 })
      })

      it("should convert purple-like color", () => {
        const result = Color.hexToRgb("#8800ff")
        expect(result).toEqual({ r: 136, g: 0, b: 255 })
      })

      it("should convert pink-like color", () => {
        const result = Color.hexToRgb("#ff69b4")
        expect(result).toEqual({ r: 255, g: 105, b: 180 })
      })

      it("should convert brown-like color", () => {
        const result = Color.hexToRgb("#a52a2a")
        expect(result).toEqual({ r: 165, g: 42, b: 42 })
      })
    })

    describe("edge cases", () => {
      it("should handle hex with maximum F values", () => {
        const result = Color.hexToRgb("#ffffff")
        expect(result).toEqual({ r: 255, g: 255, b: 255 })
      })

      it("should handle alternating values", () => {
        const result = Color.hexToRgb("#f0f0f0")
        expect(result).toEqual({ r: 240, g: 240, b: 240 })
      })

      it("should handle sequential values", () => {
        const result = Color.hexToRgb("#abcdef")
        expect(result.r).toBe(171)
        expect(result.g).toBe(205)
        expect(result.b).toBe(239)
      })
    })
  })

  describe("hexToAnsiBold", () => {
    describe("valid conversions", () => {
      it("should convert valid white hex to ANSI bold", () => {
        const result = Color.hexToAnsiBold("#ffffff")
        expect(result).toBe("\x1b[38;2;255;255;255m\x1b[1m")
      })

      it("should convert valid black hex to ANSI bold", () => {
        const result = Color.hexToAnsiBold("#000000")
        expect(result).toBe("\x1b[38;2;0;0;0m\x1b[1m")
      })

      it("should convert valid red hex to ANSI bold", () => {
        const result = Color.hexToAnsiBold("#ff0000")
        expect(result).toBe("\x1b[38;2;255;0;0m\x1b[1m")
      })

      it("should convert valid green hex to ANSI bold", () => {
        const result = Color.hexToAnsiBold("#00ff00")
        expect(result).toBe("\x1b[38;2;0;255;0m\x1b[1m")
      })

      it("should convert valid blue hex to ANSI bold", () => {
        const result = Color.hexToAnsiBold("#0000ff")
        expect(result).toBe("\x1b[38;2;0;0;255m\x1b[1m")
      })

      it("should convert valid mixed hex to ANSI bold", () => {
        const result = Color.hexToAnsiBold("#abcdef")
        expect(result).toBe("\x1b[38;2;171;205;239m\x1b[1m")
      })

      it("should handle lowercase hex", () => {
        const result = Color.hexToAnsiBold("#ff8800")
        expect(result).toBe("\x1b[38;2;255;136;0m\x1b[1m")
      })

      it("should handle uppercase hex", () => {
        const result = Color.hexToAnsiBold("#FF8800")
        expect(result).toBe("\x1b[38;2;255;136;0m\x1b[1m")
      })

      it("should handle mixed case hex", () => {
        const result = Color.hexToAnsiBold("#Ff8800")
        expect(result).toBe("\x1b[38;2;255;136;0m\x1b[1m")
      })
    })

    describe("invalid conversions", () => {
      it("should return undefined for undefined input", () => {
        const result = Color.hexToAnsiBold(undefined)
        expect(result).toBeUndefined()
      })

      it("should return undefined for empty string", () => {
        const result = Color.hexToAnsiBold("")
        expect(result).toBeUndefined()
      })

      it("should return undefined for invalid hex without hash", () => {
        const result = Color.hexToAnsiBold("ffffff")
        expect(result).toBeUndefined()
      })

      it("should return undefined for 3-digit hex", () => {
        const result = Color.hexToAnsiBold("#fff")
        expect(result).toBeUndefined()
      })

      it("should return undefined for 8-digit hex", () => {
        const result = Color.hexToAnsiBold("#ffffffff")
        expect(result).toBeUndefined()
      })

      it("should return undefined for hex with invalid characters", () => {
        const result = Color.hexToAnsiBold("#gggggg")
        expect(result).toBeUndefined()
      })

      it("should return undefined for just hash", () => {
        const result = Color.hexToAnsiBold("#")
        expect(result).toBeUndefined()
      })

      it("should return undefined for color names", () => {
        const result = Color.hexToAnsiBold("red")
        expect(result).toBeUndefined()
      })

      it("should return undefined for rgb string", () => {
        const result = Color.hexToAnsiBold("rgb(255,0,0)")
        expect(result).toBeUndefined()
      })
    })

    describe("ANSI format verification", () => {
      it("should start with ANSI escape sequence", () => {
        const result = Color.hexToAnsiBold("#ff0000")
        expect(result).toMatch(/^\x1b\[38;2;/)
      })

      it("should end with bold modifier", () => {
        const result = Color.hexToAnsiBold("#ff0000")
        expect(result).toMatch(/m\x1b\[1m$/)
      })

      it("should contain semicolon-separated RGB values", () => {
        const result = Color.hexToAnsiBold("#ff0000")
        expect(result).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/)
      })

      it("should produce correct format for zero values", () => {
        const result = Color.hexToAnsiBold("#000000")
        expect(result).toContain("0;0;0")
      })

      it("should produce correct format for max values", () => {
        const result = Color.hexToAnsiBold("#ffffff")
        expect(result).toContain("255;255;255")
      })

      it("should produce correct format for mixed values", () => {
        const result = Color.hexToAnsiBold("#123456")
        expect(result).toContain("18;52;86")
      })
    })

    describe("edge cases", () => {
      it("should handle hex with leading zeros in RGB conversion", () => {
        const result = Color.hexToAnsiBold("#010203")
        expect(result).toBe("\x1b[38;2;1;2;3m\x1b[1m")
      })

      it("should handle mid-range gray values", () => {
        const result = Color.hexToAnsiBold("#7f7f7f")
        expect(result).toBe("\x1b[38;2;127;127;127m\x1b[1m")
      })

      it("should return undefined for whitespace", () => {
        const result = Color.hexToAnsiBold("   ")
        expect(result).toBeUndefined()
      })

      it("should return undefined for hex with spaces", () => {
        const result = Color.hexToAnsiBold("#ff ff ff")
        expect(result).toBeUndefined()
      })
    })
  })

  describe("integration tests", () => {
    it("should work with isValidHex and hexToRgb together", () => {
      const hex = "#ff8800"
      if (Color.isValidHex(hex)) {
        const rgb = Color.hexToRgb(hex)
        expect(rgb).toEqual({ r: 255, g: 136, b: 0 })
      }
    })

    it("should work with all three functions together", () => {
      const hex = "#ff0000"
      expect(Color.isValidHex(hex)).toBe(true)
      const rgb = Color.hexToRgb(hex)
      expect(rgb).toEqual({ r: 255, g: 0, b: 0 })
      const ansi = Color.hexToAnsiBold(hex)
      expect(ansi).toBe("\x1b[38;2;255;0;0m\x1b[1m")
    })

    it("should handle invalid hex consistently across functions", () => {
      const hex = "#fff"
      expect(Color.isValidHex(hex)).toBe(false)
      expect(Color.hexToAnsiBold(hex)).toBeUndefined()
    })

    it("should validate before converting in hexToAnsiBold", () => {
      const invalidHexes = ["", "ffffff", "#fff", "#gggggg", undefined]
      invalidHexes.forEach((hex) => {
        expect(Color.hexToAnsiBold(hex)).toBeUndefined()
      })
    })

    it("should produce consistent RGB values for same color", () => {
      const hex1 = "#abcdef"
      const hex2 = "#ABCDEF"
      const hex3 = "#AbCdEf"

      const rgb1 = Color.hexToRgb(hex1)
      const rgb2 = Color.hexToRgb(hex2)
      const rgb3 = Color.hexToRgb(hex3)

      expect(rgb1).toEqual(rgb2)
      expect(rgb2).toEqual(rgb3)
    })

    it("should produce consistent ANSI codes for same color regardless of case", () => {
      const ansi1 = Color.hexToAnsiBold("#abcdef")
      const ansi2 = Color.hexToAnsiBold("#ABCDEF")
      const ansi3 = Color.hexToAnsiBold("#AbCdEf")

      expect(ansi1).toBe(ansi2)
      expect(ansi2).toBe(ansi3)
    })
  })
})
