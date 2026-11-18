/**
 * Icons for the logo fan's Press item, on the same 16px grid as the Brand item's ruler: 1.25px
 * strokes centred on .625 / .375 lines so the edges land on whole pixels, square corners. Shapes
 * marked `fill` are solid blocks. Settings › Press icon (Design mode on the logo) picks one.
 */
export const pressIcons = {
  newspaper: {
    label: "Newspaper",
    shapes: [
      { d: "M2.625 2.625H13.375V13.375H2.625Z" },
      { d: "M5 5.625H8.5V8.125H5ZM10 5.625H11M10 8.125H11M5 10.625H11" },
    ],
  },
  megaphone: {
    label: "Megaphone",
    shapes: [
      { d: "M2.625 6.125H5.375L11.375 3.125V12.875L5.375 9.875H2.625Z" },
      { d: "M5.375 9.875V12.875H7.375M13.875 6.625V9.375" },
    ],
  },
  microphone: {
    label: "Microphone",
    shapes: [
      { d: "M5.625 1.625H10.375V9.375H5.625Z" },
      { d: "M3.625 7.375V11.375H12.375V7.375M8 11.375V14.375M5.625 14.375H10.375" },
    ],
  },
  quote: {
    label: "Quote",
    shapes: [
      {
        d: "M2.625 3.625H6.375V8.375L4.625 12.375M2.625 3.625V8.375H6.375M9.625 3.625H13.375V8.375L11.625 12.375M9.625 3.625V8.375H13.375",
      },
    ],
  },
  camera: {
    label: "Camera",
    shapes: [
      { d: "M1.625 4.625H14.375V13.375H1.625Z" },
      { d: "M5.625 4.625L6.625 2.625H9.375L10.375 4.625" },
      { d: "M5.625 6.625H10.375V11.375H5.625Z" },
    ],
  },
  folder: {
    label: "Press kit folder",
    shapes: [{ d: "M4.625 4.625V2.625H11.375V5.625" }, { d: "M1.625 4.625H6.375L7.375 5.625H14.375V13.375H1.625Z" }],
  },
  document: {
    label: "Headline page",
    shapes: [
      { d: "M3.625 1.625H12.375V14.375H3.625Z" },
      { d: "M5 3.75H11V6H5Z", fill: true },
      { d: "M5.625 8.125H10.375M5.625 10.125H10.375M5.625 12.125H8.375" },
    ],
  },
  broadcast: {
    label: "Broadcast",
    shapes: [
      {
        d: "M5.375 4.625H4.375V9.375H5.375M10.625 4.625H11.625V9.375H10.625M2.875 2.625H1.625V11.375H2.875M13.125 2.625H14.375V11.375H13.125",
      },
      { d: "M7 6H9V8H7Z", fill: true },
      { d: "M8 8V14.375" },
    ],
  },
  monogram: {
    label: "P monogram",
    shapes: [{ d: "M3.625 14.375V1.625H12.375V9.375H3.625" }, { d: "M6.625 4.625H9.375V6.375H6.625Z" }],
  },
} satisfies Record<string, { label: string; shapes: { d: string; fill?: boolean }[] }>

export type PressIconName = keyof typeof pressIcons
