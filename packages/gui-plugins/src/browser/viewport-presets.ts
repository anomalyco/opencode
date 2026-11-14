export const quickPresets = [
  { id: "galaxy-s26", width: 360, height: 780, profile: "phone" },
  { id: "iphone-18-pro", width: 402, height: 874, profile: "phone" },
  { id: "ipad-air-11", width: 820, height: 1180, profile: "tablet" },
  { id: "laptop", width: 1280, height: 720, profile: "desktop" },
  { id: "desktop", width: 1440, height: 900, profile: "desktop" },
] as const

export const moreDevices = [
  { id: "iphone-se", width: 375, height: 667, profile: "phone" },
  { id: "iphone-16", width: 393, height: 852, profile: "phone" },
  { id: "iphone-17e", width: 390, height: 844, profile: "phone" },
  { id: "iphone-16-pro-max", width: 440, height: 956, profile: "phone" },
  { id: "iphone-duo-closed", width: 466, height: 678, profile: "phone" },
  { id: "iphone-duo-open", width: 951, height: 669, profile: "phone" },
  { id: "compact-phone", width: 360, height: 800, profile: "phone" },
  { id: "pixel-10", width: 412, height: 924, profile: "phone" },
  { id: "pixel-9-pro-fold", width: 412, height: 922, profile: "phone" },
  { id: "ipad-mini-a20-pro", width: 756, height: 1158, profile: "tablet" },
  { id: "ipad-pro-13", width: 1032, height: 1376, profile: "tablet" },
  { id: "surface-pro-10", width: 960, height: 1440, profile: "windows-tablet" },
] as const

export const devices = [...quickPresets, ...moreDevices] as const

export type Device = (typeof devices)[number]

export const previewScales = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
