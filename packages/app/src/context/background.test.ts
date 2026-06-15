import { expect, test } from "bun:test"
import { backgroundStyle } from "./background"

test("backgroundStyle returns empty style when disabled", () => {
  expect(
    backgroundStyle({
      enabled: false,
      image: "C:\\Users\\me\\Pictures\\bg.png",
      opacity: 0.8,
      blur: 4,
      fit: "cover",
    }),
  ).toEqual({})
})

test("backgroundStyle builds a local file background style", () => {
  expect(
    backgroundStyle({
      enabled: true,
      image: "C:\\Users\\me\\Pictures\\my bg.png",
      opacity: 0.35,
      blur: 8,
      fit: "cover",
    }),
  ).toEqual({
    "background-image": 'url("file:///C:/Users/me/Pictures/my%20bg.png")',
    "background-size": "cover",
    "background-repeat": "no-repeat",
    "background-position": "center",
    opacity: 0.35,
    filter: "blur(8px)",
    transform: "scale(1.02)",
  })
})

test("backgroundStyle uses platform local file URL when provided", () => {
  expect(
    backgroundStyle(
      {
        enabled: true,
        image: "C:\\Users\\me\\Pictures\\my bg.png",
        opacity: 0.35,
        blur: 0,
        fit: "cover",
      },
      (path) => `oc-local-file://background?path=${encodeURIComponent(path)}`,
    )["background-image"],
  ).toBe('url("oc-local-file://background?path=C%3A%5CUsers%5Cme%5CPictures%5Cmy%20bg.png")')
})

test("backgroundStyle encodes unicode Windows paths", () => {
  expect(
    backgroundStyle({
      enabled: true,
      image: "C:\\Users\\l\\Desktop\\背景图.png",
      opacity: 0.7,
      blur: 6,
      fit: "cover",
    })["background-image"],
  ).toBe('url("file:///C:/Users/l/Desktop/%E8%83%8C%E6%99%AF%E5%9B%BE.png")')
})

test("backgroundStyle supports repeated backgrounds", () => {
  expect(
    backgroundStyle({
      enabled: true,
      image: "/tmp/tile.png",
      opacity: 1,
      blur: 0,
      fit: "repeat",
    }),
  ).toEqual({
    "background-image": 'url("file:///tmp/tile.png")',
    "background-size": "auto",
    "background-repeat": "repeat",
    "background-position": "center",
    opacity: 1,
  })
})
