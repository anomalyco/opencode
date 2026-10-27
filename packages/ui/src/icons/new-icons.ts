import type { IconName } from "./catalog"

// Artwork for the "New icons" experiment. Each body is the inner markup of a 16×16 SVG drawn with `currentColor`,
// such as `<path d="…" stroke="currentColor"/>`. An empty body keeps today's artwork for every name it replaces.
const newIcons = {
  checkmark: `<path d="M4.5 7.5L7 11.5L11.5 4.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "circle-checkmark": `<path d="M5 8L7.5 11L11 5.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41015 14.5 1.5 11.5899 1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C11.5899 1.5 14.5 4.41015 14.5 8Z" stroke="currentColor"/>`,
  search: `<path d="M11.5 7C11.5 9.48528 9.48528 11.5 7 11.5C4.51472 11.5 2.5 9.48528 2.5 7C2.5 4.51472 4.51472 2.5 7 2.5C9.48528 2.5 11.5 4.51472 11.5 7Z" stroke="currentColor"/><path d="M13.5 13.5L10.5 10.5" stroke-linecap="round" stroke="currentColor"/>`,
  ellipsis: `<path d="M5 8C5 8.55228 4.55228 9 4 9C3.44772 9 3 8.55228 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8Z" fill="currentColor"/><path d="M9 8C9 8.55228 8.55228 9 8 9C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7C8.55228 7 9 7.44772 9 8Z" fill="currentColor"/><path d="M13 8C13 8.55228 12.5523 9 12 9C11.4477 9 11 8.55228 11 8C11 7.44772 11.4477 7 12 7C12.5523 7 13 7.44772 13 8Z" fill="currentColor"/>`,
  worktree: `<path d="M1.5 11.5H5L9.5 5.5H14.5M12 8L14.5 5.5L12 3M9 11.5H14.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  monitor: `<path d="M4.5 14.5H11.5" stroke-linecap="round" stroke="currentColor"/><path d="M8 12V14" stroke-linecap="square" stroke="currentColor"/><path d="M1.5 11.5V2.5H14.5V11.5H1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "monitor-dot": `<path d="M4.5 14.5H11.5" stroke-linecap="round" stroke="currentColor"/><path d="M8 12V14" stroke-linecap="square" stroke="currentColor"/><path d="M16 3.5C16 4.88071 14.8807 6 13.5 6C12.1193 6 11 4.88071 11 3.5C11 2.11929 12.1193 1 13.5 1C14.8807 1 16 2.11929 16 3.5Z" fill="currentColor"/><path d="M10.3369 2C10.1892 2.31084 10.0866 2.64695 10.0361 3H2V11H14V6.96387C14.3531 6.91336 14.6892 6.81075 15 6.66309V11.5C15 11.7761 14.7761 12 14.5 12H1.5C1.22386 12 1 11.7761 1 11.5V2.5C1 2.22386 1.22386 2 1.5 2H10.3369Z" fill="currentColor"/>`,
  copy: `<path d="M9.5 3.5V1.5H1.5V10.5H4.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M6.5 14.5V5.5H14.5V14.5H6.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  code: `<path d="M4.5 4.5L1.5 8L4.5 11.5M11.5 4.5L14.5 8L11.5 11.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M6.5 13.5L9.5 2.5" stroke-linecap="round" stroke="currentColor"/>`,
  box: `<path d="M8 14.5L14.5 11V5L8 1.5L1.5 5V11L8 14.5ZM1.5 5L8 8.5M14.5 5L8 8.5M8 8.5V14.5" stroke-linecap="square" stroke-linejoin="round" stroke="currentColor"/>`,
  lock: `<path d="M2.5 14.5V7.5H13.5V14.5H2.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M5.5 7.5V4C5.5 2.61929 6.61929 1.5 8 1.5C9.38071 1.5 10.5 2.61929 10.5 4V7.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M7.5 10.5C7.5 10.2239 7.72386 10 8 10C8.27614 10 8.5 10.2239 8.5 10.5V12.5C8.5 12.7761 8.27614 13 8 13C7.72386 13 7.5 12.7761 7.5 12.5V10.5Z" fill="currentColor"/>`,
  sliders: `<path d="M7.5 11.5C7.5 12.6046 6.60457 13.5 5.5 13.5C4.39543 13.5 3.5 12.6046 3.5 11.5C3.5 10.3954 4.39543 9.5 5.5 9.5C6.60457 9.5 7.5 10.3954 7.5 11.5Z" stroke="currentColor"/><path d="M12.5 4.5C12.5 5.60457 11.6046 6.5 10.5 6.5C9.39543 6.5 8.5 5.60457 8.5 4.5C8.5 3.39543 9.39543 2.5 10.5 2.5C11.6046 2.5 12.5 3.39543 12.5 4.5Z" stroke="currentColor"/><path d="M8.0498 4C8.01702 4.16154 8 4.32878 8 4.5C8 4.67122 8.01702 4.83846 8.0498 5H1.5C1.22386 5 1 4.77614 1 4.5C1 4.22386 1.22386 4 1.5 4H8.0498ZM14.5 4C14.7761 4 15 4.22386 15 4.5C15 4.77614 14.7761 5 14.5 5H12.9502C12.983 4.83846 13 4.67122 13 4.5C13 4.32878 12.983 4.16154 12.9502 4H14.5Z" fill="currentColor"/><path d="M3.0498 11C3.01702 11.1615 3 11.3288 3 11.5C3 11.6712 3.01702 11.8385 3.0498 12H1.5C1.22386 12 1 11.7761 1 11.5C1 11.2239 1.22386 11 1.5 11H3.0498ZM14.5 11C14.7761 11 15 11.2239 15 11.5C15 11.7761 14.7761 12 14.5 12H7.9502C7.98298 11.8385 8 11.6712 8 11.5C8 11.3288 7.98298 11.1615 7.9502 11H14.5Z" fill="currentColor"/>`,
  trash: `<path d="M5.5 4.5H2.5L4 14.5H12L13.5 4.5H10.5M5.5 4.5V1.5H10.5V4.5M5.5 4.5H10.5M6.5 11.5L6 7M9.5 11.5L10 7" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  cross: `<path d="M4.5 11.5L8 8M8 8L11.5 4.5M8 8L4.5 4.5M8 8L11.5 11.5" stroke-linecap="round" stroke="currentColor"/>`,
  server: `<path d="M1.5 10.5V14.5H14.5V10.5M1.5 10.5H14.5M14.5 10.5V6.5L11.5 1.5H4.5L1.5 6.5V10.5M1.5 6.5H14.5" stroke-linecap="square" stroke-linejoin="round" stroke="currentColor"/><path d="M12.5 12.5H9.5M12.5 8.5H9.5" stroke-linecap="round" stroke="currentColor"/>`,
  globe: `<path d="M14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41015 14.5 1.5 11.5899 1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C11.5899 1.5 14.5 4.41015 14.5 8Z" stroke="currentColor"/><path d="M1.5 8H14.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M8 1.5C6.5 3 5.5 5.5 5.5 8C5.5 10.5 6.5 13 8 14.5C9.5 13 10.5 10.5 10.5 8C10.5 5.5 9.5 3 8 1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  archive: `<path d="M2.5 5.5V13.5H13.5V5.5M2.5 5.5H1.5V2.5H14.5V5.5H13.5M2.5 5.5H13.5M6.5 7.5H9.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  appearance: `<path d="M1.5 4.5L4.5 1.5M1.5 14.5L14.5 1.5M11.5 14.5L14.5 11.5M1.5 9.5L9.5 1.5M6.5 14.5L14.5 6.5" stroke-linecap="round" stroke="currentColor"/>`,
  submit: `<path d="M2.5 9.5H12.5C13.0523 9.5 13.5 9.05228 13.5 8.5V5.5C13.5 4.94772 13.0523 4.5 12.5 4.5H8.5M5.5 12.5L2.5 9.5L5.5 6.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  reset: `<path d="M2.5 6.5H12.5C13.0523 6.5 13.5 6.94772 13.5 7.5V10.5C13.5 11.0523 13.0523 11.5 12.5 11.5H8.5M5.5 9.5L2.5 6.5L5.5 3.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  annotate: `<path d="M8.5 14.5V5.5L14.5 11.5H11L8.5 14.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M5.5 13.5H1.5V2.5H14.5V7.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  download: `<path d="M8 2.5L8 10.5M4.5 7L8 10.5L11.5 7" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M1.5 10.5V13.5H14.5V10.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  skill: `<path d="M3 2.5C3.5 2.5 4.5 2.8 4.5 4L4.5 5.5V12C4.5 12.5 4.8 13.5 6 13.5M6 13.5C7.2 13.5 7.5 12.5 7.5 12V10.5H14.5V12C14.5 12.5 14.2 13.5 13 13.5H6ZM4.5 5.5H1.5V4C1.5 3.5 1.8 2.5 3 2.5M12.5 8.5V4.5C12.5 3.39543 11.6046 2.5 10.5 2.5H3" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M6.5 5.5H10.5M6.5 7.5H9" stroke-linecap="round" stroke="currentColor"/>`,
  "eye-open": `<path d="M1.5 8C2.5 6.5 4.5 4 8 4C11.5 4 13.5 6.5 14.5 8C13.5 9.5 11.5 12 8 12C4.5 12 2.5 9.5 1.5 8Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M9.5 8C9.5 8.82843 8.82843 9.5 8 9.5C7.17157 9.5 6.5 8.82843 6.5 8C6.5 7.17157 7.17157 6.5 8 6.5C8.82843 6.5 9.5 7.17157 9.5 8Z" fill="currentColor"/>`,
  "eye-closed": `<path d="M8 9.5V11.5M13 7.70453C12.3728 8.24287 11.6002 8.73156 10.6609 9.06269C9.8902 9.33437 9.00721 9.5 8 9.5M8 9.5C6.99279 9.5 6.1098 9.33437 5.33912 9.06269M10.6609 9.06269L11.5 11M5.33912 9.06269L4.5 11M1.5 6C1.86147 6.5422 2.3536 7.14974 3 7.70453C3.62725 8.24287 4.39976 8.73156 5.33912 9.06269M14.5 6C14.1385 6.5422 13.6464 7.14974 13 7.70453M13 7.70453L14.5 9.06269M3 7.70453L1.5 9.06269" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "chevron-up": `<path d="M4.5 9.5L8 6.5L11.5 9.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "arrow-up": `<path d="M8 12.5V3.5M11.5 7L8 3.5L4.5 7" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  plus: `<path d="M8 2.5V8M8 8V13.5M8 8H2.5M8 8H13.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  minus: `<path d="M2.5 8H13.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  folder: `<path d="M1.5 13.5V2.5H5.5L8.5 5.5H14.5V13.5H1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "folder-plus": `<path d="M7.5 13.5H1.5V2.5H5.5L8.5 5.5H14.5V6.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M9.5 11.5H12.5M12.5 11.5H15.5M12.5 11.5V8.5M12.5 11.5V14.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  edit: `<path d="M8.5 2.5H2.5V13.5H13.5V7.5M7.5 8.5V6.5L12.5 1.5L14.5 3.5L9.5 8.5H7.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "chat-bubble": `<path d="M1.5 2.5V10.5H5.5L8 13.5L10.5 10.5H14.5V2.5H1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  calendar: `<path d="M14.5 6.5V3.5H11.5M14.5 6.5V14.5H1.5V6.5M14.5 6.5H1.5M1.5 6.5V3.5H4.5M4.5 3.5V1.5M4.5 3.5H11.5M4.5 3.5V4.5M11.5 3.5V1.5M11.5 3.5V4.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  extensions: `<path d="M1.5 2.5V13.5H14.5V2.5H1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M4.5 6.5V9.5M8 6.5V9.5M11.5 6.5V9.5" stroke-linecap="round" stroke="currentColor"/>`,
  settings: `<path d="M1.5 11V5L8 1.5L14.5 5V11L8 14.5L1.5 11Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M10.5 8C10.5 9.38071 9.38071 10.5 8 10.5C6.61929 10.5 5.5 9.38071 5.5 8C5.5 6.61929 6.61929 5.5 8 5.5C9.38071 5.5 10.5 6.61929 10.5 8Z" stroke="currentColor"/>`,
  "square-arrow": `<path d="M5.5 2.5H2.5V13.5H13.5V10.5M8.5 7.5L13.5 2.5M13.5 7.5V2.5H8.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "circle-ban": `<path d="M14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41015 14.5 1.5 11.5899 1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C11.5899 1.5 14.5 4.41015 14.5 8Z" stroke="currentColor"/><path d="M3.5 12.5L12.5 3.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "window-analytics": `<path d="M6.5 2.5H1.5V13.5H14.5V10.5M9.5 2.5H14.5V7.5H9.5V2.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "globe-plus": `<path d="M9.5 11.5H12.5M12.5 11.5H15.5M12.5 11.5V8.5M12.5 11.5V14.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M8 1C11.866 1 15 4.13401 15 8C15 8.11231 14.9964 8.22395 14.9912 8.33496C14.9358 7.48617 14.4589 6.75503 13.7656 6.34668C13.1525 4.20296 11.3791 2.55021 9.16602 2.11426C10.0489 3.35264 10.6663 4.93158 10.8975 6.58105C10.3489 7.03965 10 7.72909 10 8.5H6.01465C6.13241 10.6267 6.98934 12.6854 8.20996 13.9941C8.44758 13.986 8.68133 13.9618 8.91113 13.9268C9.10021 13.9725 9.29688 14 9.5 14H10V14.5C10 14.5691 10.0043 14.6374 10.0098 14.7051C9.37302 14.8957 8.69876 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM2.02246 8.5C2.24434 11.1886 4.23728 13.3729 6.83301 13.8848C5.78755 12.4178 5.11145 10.4737 5.0127 8.5H2.02246ZM6.83301 2.11426C4.23719 2.62603 2.24434 4.81135 2.02246 7.5H5.0127C5.11147 5.52603 5.78728 3.58126 6.83301 2.11426ZM8 2.24219C6.89188 3.55495 6.12676 5.49755 6.01562 7.5H9.98438C9.87324 5.49755 9.10812 3.55495 8 2.24219Z" fill="currentColor"/>`,
  diff: `<path d="M4.5 6.5H8M8 6.5H11.5M8 6.5V3M8 6.5V10" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M4.5 12.5H11.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  providers: `<path d="M13.5 4.5V2.5H11.5M13.5 4.5H15.5M13.5 4.5V8M13.5 8H15.5M13.5 8V8.5V11.5M13.5 11.5V13.5H11.5M13.5 11.5H15.5M2.5 8H0.5M2.5 8V4.5M2.5 8V11.5M2.5 4.5V2.5H4.5M2.5 4.5H0.5M2.5 11.5V13.5H4.5M2.5 11.5H0.5M4.5 13.5V15.5M4.5 13.5H8M8 13.5V15.5M8 13.5H11.5M11.5 13.5V15.5M11.5 2.5V0.5M11.5 2.5H8M8 2.5V0.5M8 2.5H4.5M4.5 2.5V0.5M5.5 10.5V5.5H10.5V10.5H5.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
}

type NewIconName = keyof typeof newIcons

export const newIconViewBox = "0 0 16 16"

// The new artwork each current name draws, turned clockwise by `rotate` degrees for the other directions.
const replacements: Partial<Record<IconName, { name: NewIconName; rotate?: number }>> = {
  check: { name: "checkmark" },
  "check-small": { name: "checkmark" },
  "circle-check": { name: "circle-checkmark" },
  "magnifying-glass": { name: "search" },
  "outline-dots": { name: "ellipsis" },
  "outline-worktree": { name: "worktree" },
  "branch-out": { name: "worktree" },
  monitor: { name: "monitor" },
  notifications: { name: "monitor-dot" },
  copy: { name: "copy" },
  "outline-copy": { name: "copy" },
  code: { name: "code" },
  "code-slash": { name: "code" },
  cube: { name: "box" },
  lock: { name: "lock" },
  sliders: { name: "sliders" },
  "outline-sliders": { name: "sliders" },
  trash: { name: "trash" },
  "outline-trash": { name: "trash" },
  close: { name: "cross" },
  "close-small": { name: "cross" },
  "xmark-small": { name: "cross" },
  "outline-xmark": { name: "cross" },
  server: { name: "server" },
  globe: { name: "globe" },
  "outline-globe": { name: "globe" },
  archive: { name: "archive" },
  appearance: { name: "appearance" },
  enter: { name: "submit" },
  reset: { name: "reset" },
  "outline-reset": { name: "reset" },
  "outline-undo": { name: "reset" },
  "window-cursor": { name: "annotate" },
  "outline-browser-annotate": { name: "annotate" },
  "select-element": { name: "annotate" },
  download: { name: "download" },
  "post-skill": { name: "skill" },
  eye: { name: "eye-open" },
  "outline-eye": { name: "eye-open" },
  "outline-eye-slash": { name: "eye-closed" },
  "chevron-down": { name: "chevron-up", rotate: 180 },
  "outline-chevron-down": { name: "chevron-up", rotate: 180 },
  "chevron-left": { name: "chevron-up", rotate: 270 },
  "chevron-right": { name: "chevron-up", rotate: 90 },
  "outline-chevron-right": { name: "chevron-up", rotate: 90 },
  "arrow-up": { name: "arrow-up" },
  "arrow-left": { name: "arrow-up", rotate: 270 },
  "outline-arrow-left": { name: "arrow-up", rotate: 270 },
  "arrow-right": { name: "arrow-up", rotate: 90 },
  "outline-arrow-right": { name: "arrow-up", rotate: 90 },
  plus: { name: "plus" },
  "plus-small": { name: "plus" },
  minus: { name: "minus" },
  dash: { name: "minus" },
  folder: { name: "folder" },
  "file-tree": { name: "folder" },
  "folder-add-left": { name: "folder-plus" },
  edit: { name: "edit" },
  comment: { name: "chat-bubble" },
  "bubble-5": { name: "chat-bubble" },
  "speech-bubble": { name: "chat-bubble" },
  extensions: { name: "extensions" },
  "settings-gear": { name: "settings" },
  "outline-square-arrow": { name: "square-arrow" },
  "square-arrow-top-right": { name: "square-arrow" },
  "circle-ban-sign": { name: "circle-ban" },
  "window-analytics": { name: "window-analytics" },
  providers: { name: "providers" },
  review: { name: "diff" },
  "outline-globe-plus": { name: "globe-plus" },
}

// Still drawn with today's artwork under the experiment, awaiting a new design. Uses in the desktop app in brackets.
// Pairs on one line likely share a design.
//
// Status:   circle-xmark (10) / circle-x (1), outline-hexagonal-warning (7) / warning (6), status / status-active (4),
//           help (3), info (2)
// Features: terminal (6), mcp (5), branch (5, held back), console / outline-console (2), stop, models,
//           link, share, brain / outline-brain, shield, graduation-cap
// Arrows:   arrow-up-right (5) / outline-arrow-up-right (3), arrow-down-to-line (2), arrow-undo-down
// Layout:   layout-left / layout-left-full (4), layout-right / layout-right-full (2), chevron-grabber-vertical (4),
//           fill-triangle-down (3), menu (2), expand / collapse, split / unified, dot-grid
// Files:    grid-plus (4), filetree, file-document (3), open-file (2),
//           outline-quote (3), outline-cookie, outline-steer, outline-wave-audio,
//           refresh / outline-rotate-clockwise
// Brand:    discord
// Search:   magnifying-glass-menu (only passed to BasicTool, which draws no icon)

/**
 * The new artwork a current name draws under the experiment, or undefined while it has none.
 * @param name - A current catalog name.
 */
export function getNewIcon(name: IconName) {
  const replacement = replacements[name]

  if (!replacement) return

  const body = newIcons[replacement.name]

  if (!body) return

  return replacement.rotate ? `<g transform="rotate(${replacement.rotate} 8 8)">${body}</g>` : body
}
