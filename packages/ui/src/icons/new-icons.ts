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
  server: `<path d="M1.5 10.5V14.5H14.5V10.5M1.5 10.5H14.5M14.5 10.5V6.5L11.5 1.5H4.5L1.5 6.5V10.5M1.5 6.5H14.5" stroke-linecap="square" stroke-linejoin="round" stroke="currentColor"/><path d="M12.5 12.5H11.5M12.5 8.5H11.5" stroke-linecap="round" stroke="currentColor"/>`,
  globe: `<path d="M14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41015 14.5 1.5 11.5899 1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C11.5899 1.5 14.5 4.41015 14.5 8Z" stroke="currentColor"/><path d="M1.5 8H14.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M8 1.5C6.5 3 5.5 5.5 5.5 8C5.5 10.5 6.5 13 8 14.5C9.5 13 10.5 10.5 10.5 8C10.5 5.5 9.5 3 8 1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  archive: `<path d="M2.5 5.5V13.5H13.5V5.5M2.5 5.5H1.5V2.5H14.5V5.5H13.5M2.5 5.5H13.5M6.5 7.5H9.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  appearance: `<path d="M1.5 4.5L4.5 1.5M1.5 14.5L14.5 1.5M11.5 14.5L14.5 11.5M1.5 9.5L9.5 1.5M6.5 14.5L14.5 6.5" stroke-linecap="round" stroke="currentColor"/>`,
  submit: `<path d="M2.5 9.5H12.5C13.0523 9.5 13.5 9.05228 13.5 8.5V5.5C13.5 4.94772 13.0523 4.5 12.5 4.5H8.5M5.5 12.5L2.5 9.5L5.5 6.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  reset: `<path d="M2.5 6.5H12.5C13.0523 6.5 13.5 6.94772 13.5 7.5V10.5C13.5 11.0523 13.0523 11.5 12.5 11.5H8.5M5.5 9.5L2.5 6.5L5.5 3.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  annotate: `<path d="M8.5 14.5V5.5L14.5 11.5H11L8.5 14.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M5.5 13.5H1.5V2.5H14.5V7.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  download: `<path d="M8 2.5L8 10.5M4.5 7L8 10.5L11.5 7" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M1.5 10.5V13.5H14.5V10.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  skill: `<path d="M3 2.5C3.5 2.5 4.5 2.8 4.5 4L4.5 5.5V12C4.5 12.5 4.8 13.5 6 13.5M6 13.5C7.2 13.5 7.5 12.5 7.5 12V10.5H14.5V12C14.5 12.5 14.2 13.5 13 13.5H6ZM4.5 5.5H1.5V4C1.5 3.5 1.8 2.5 3 2.5M12.5 8.5V4.5C12.5 3.39543 11.6046 2.5 10.5 2.5H3" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M6.5 5.5H10.5M6.5 7.5H9" stroke-linecap="square" stroke-linejoin="round" stroke="currentColor"/>`,
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
  pairing: `<path d="M2.5 9V2.5H13.5V3.5M2.5 9L0.5 12.5H7.5M2.5 9H7.5" stroke-linecap="square" stroke-linejoin="round" stroke="currentColor"/><path d="M11.5 12.5H13.5M9.5 5.5V14.5H15.5V5.5H9.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  shortcut: `<path d="M5.5 13.5H10.5V8.5H13.5L8 2.5L2.5 8.5H5.5V13.5Z" stroke-linejoin="round" stroke="currentColor"/>`,
  flask: `<path d="M10.5 2.5V6.5L11.3571 8.5M10.5 2.5H5.5M10.5 2.5H12.5M5.5 2.5V6.5L4.21429 9.5M5.5 2.5H3.5M4.21429 9.5L2.5 13.5H13.5L11.3571 8.5M4.21429 9.5L11.3571 8.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "zoom-out": `<path d="M12.5 7.5C12.5 10.2614 10.2614 12.5 7.5 12.5C4.73858 12.5 2.5 10.2614 2.5 7.5C2.5 4.73858 4.73858 2.5 7.5 2.5C10.2614 2.5 12.5 4.73858 12.5 7.5Z" stroke="currentColor"/><path d="M13.5 13.5L11.5 11.5" stroke-linecap="round" stroke="currentColor"/><path d="M5.5 7.5H9.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "zoom-in": `<path d="M12.5 7.5C12.5 10.2614 10.2614 12.5 7.5 12.5C4.73858 12.5 2.5 10.2614 2.5 7.5C2.5 4.73858 4.73858 2.5 7.5 2.5C10.2614 2.5 12.5 4.73858 12.5 7.5Z" stroke="currentColor"/><path d="M13.5 13.5L11.5 11.5" stroke-linecap="round" stroke="currentColor"/><path d="M5 7.5H7.5M7.5 7.5H10M7.5 7.5V5M7.5 7.5V10" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "expand-corners": `<path d="M3.5 8V12.25C3.5 12.3881 3.61193 12.5 3.75 12.5H8" stroke-linecap="round" stroke="currentColor"/><path d="M12.5 8L12.5 3.75C12.5 3.61193 12.3881 3.5 12.25 3.5L8 3.5" stroke-linecap="round" stroke="currentColor"/>`,
  console: `<path d="M4.5 11.5L7.5 8.5L4.5 5.5M11.5 11.5H8.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M1.5 14.25V1.75C1.5 1.61193 1.61193 1.5 1.75 1.5H14.25C14.3881 1.5 14.5 1.61193 14.5 1.75V14.25C14.5 14.3881 14.3881 14.5 14.25 14.5H1.75C1.61193 14.5 1.5 14.3881 1.5 14.25Z" stroke-linecap="round" stroke="currentColor"/>`,
  "diff-split": `<path d="M14.5 13.5H1.5V2.5H14.5V13.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><rect opacity="0.5" x="3" y="4" width="4" height="8" fill="currentColor"/><rect opacity="0.5" x="9" y="4" width="4" height="8" fill="currentColor"/>`,
  "diff-unified": `<path d="M14.5 13.5H1.5V2.5H14.5V13.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><rect opacity="0.5" x="3" y="4" width="10" height="3" fill="currentColor"/><rect opacity="0.5" x="3" y="9" width="10" height="3" fill="currentColor"/>`,
  "lines-expand": `<path d="M10.5 4.5L8 2L5.5 4.5M10.5 11.5L8 14L5.5 11.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M2.5 8H13.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "lines-collapse": `<path d="M5.5 2.5L8 5L10.5 2.5M5.5 13.5L8 11L10.5 13.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><path d="M2.5 8H13.5" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  branch: `<circle cx="5" cy="12" r="1.5" stroke="currentColor"/><path d="M5.22983 10.4384V5.43842M6.55305 11.8019H8.83276C9.94392 11.8019 10.8421 10.8962 10.8327 9.78506L10.7966 5.50012" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/><circle cx="5" cy="4" r="1.5" stroke="currentColor"/><circle cx="11" cy="4" r="1.5" stroke="currentColor"/>`,
  document: `<path d="M3.5 13.25V2.75C3.5 2.61193 3.61193 2.5 3.75 2.5H8.39645C8.46275 2.5 8.52634 2.52634 8.57322 2.57322L12.4268 6.42678C12.4737 6.47366 12.5 6.53725 12.5 6.60355V13.25C12.5 13.3881 12.3881 13.5 12.25 13.5H3.75C3.61193 13.5 3.5 13.3881 3.5 13.25Z" stroke-linecap="round" stroke="currentColor"/>`,
  menu: `<path d="M2 8.00006H14M2 4.5H14M2 11.5H14" stroke="currentColor"/>`,
  help: `<path d="M14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41015 14.5 1.5 11.5899 1.5 8C1.5 4.41015 4.41015 1.5 8 1.5C11.5899 1.5 14.5 4.41015 14.5 8Z" stroke="currentColor"/><path d="M7.22461 9.50977V9.43555C7.22982 8.95117 7.27799 8.77279 7.36914 8.48633C7.46289 8.19987 7.5957 7.9681 7.76758 7.79102C7.93945 7.61393 8.14648 7.45247 8.38867 7.30664C8.54492 7.20768 8.68555 7.09701 8.81055 6.97461C8.93555 6.85221 9.03451 6.71159 9.10742 6.55273C9.18034 6.39388 9.2168 6.2181 9.2168 6.02539C9.2168 5.79362 9.16211 5.5931 9.05273 5.42383C8.94336 5.25456 8.79753 5.12435 8.61523 5.0332C8.43555 4.93945 8.23503 4.89258 8.01367 4.89258C7.81315 4.89258 7.62174 4.93424 7.43945 5.01758C7.25716 5.10091 7.10612 5.23112 6.98633 5.4082C6.86654 5.58268 6.79753 5.72591 6.7793 6.00195H5.5918C5.61003 5.5332 5.72852 5.2194 5.94727 4.89648C6.16602 4.57096 6.45508 4.32487 6.81445 4.1582C7.17643 3.99154 7.57617 3.9082 8.01367 3.9082C8.49284 3.9082 8.91211 3.99805 9.27148 4.17773C9.63086 4.35482 9.90951 4.60352 10.1074 4.92383C10.3079 5.24154 10.4082 5.61263 10.4082 6.03711C10.4082 6.32878 10.3626 6.5918 10.2715 6.82617C10.1803 7.05794 10.0501 7.26497 9.88086 7.44727C9.71419 7.62956 9.51367 7.79102 9.2793 7.93164C9.05794 8.06966 8.87826 8.21289 8.74023 8.36133C8.60482 8.50977 8.50586 8.68555 8.44336 8.88867C8.38086 9.0918 8.34701 9.13607 8.3418 9.43555V9.50977H7.22461Z" fill="currentColor"/><rect x="6.99902" y="10.6675" width="1.42432" height="1.42432" fill="currentColor"/>`,
  fork: `<path d="M8.39211 13.5L8.39211 8.10506C8.39211 8.03787 8.36505 7.9735 8.31705 7.92648L2.77783 2.50007M6.77783 2.50007L2.77783 2.50007L2.77783 6.50007M13.5002 6.50007L13.5002 2.50007L9.5002 2.50007M13.5002 2.50007L10 6" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  stop: `<path d="M13 3H3V13H13V3Z" fill="currentColor"/>`,
  "chevron-grabber": `<path d="M5 6L8 3.5L11 6M5 10L8 12.5L11 10" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
  "triangle-down": `<path d="M5.37624 6.75194C5.18184 6.41861 5.42224 6 5.80814 6H10.1921C10.578 6 10.8184 6.41861 10.624 6.75194L8.43203 10.5096C8.23909 10.8404 7.76119 10.8404 7.56825 10.5096L5.37624 6.75194Z" fill="currentColor"/>`,
  queue: `<path d="M8.5 4.5H14.5M8.5 11.5H14.5M1.5 2.5V6.5H5.5V2.5H1.5ZM1.5 9.5V13.5H5.5V9.5H1.5Z" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"/>`,
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
  "circle-xmark": { name: "cross" },
  server: { name: "server" },
  globe: { name: "globe" },
  "outline-globe": { name: "globe" },
  archive: { name: "archive" },
  appearance: { name: "appearance" },
  enter: { name: "submit" },
  "arrow-undo-down": { name: "submit" },
  reset: { name: "reset" },
  "outline-reset": { name: "reset" },
  "outline-undo": { name: "reset" },
  "window-cursor": { name: "annotate" },
  "outline-browser-annotate": { name: "annotate" },
  "select-element": { name: "annotate" },
  download: { name: "download" },
  "graduation-cap": { name: "skill" },
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
  "outline-pair": { name: "pairing" },
  keyboard: { name: "shortcut" },
  flask: { name: "flask" },
  "bullet-list": { name: "queue" },
  stop: { name: "stop" },
  fork: { name: "fork" },
  help: { name: "help" },
  menu: { name: "menu" },
  "file-document": { name: "document" },
  expand: { name: "lines-expand" },
  collapse: { name: "lines-collapse" },
  branch: { name: "branch" },
  split: { name: "diff-split" },
  unified: { name: "diff-unified" },
  "outline-expand": { name: "expand-corners" },
  "outline-console": { name: "console" },
  console: { name: "console" },
  terminal: { name: "console" },
  "outline-magnifier-minus": { name: "zoom-out" },
  "outline-magnifier-plus": { name: "zoom-in" },
  "chevron-grabber-vertical": { name: "chevron-grabber" },
  "fill-triangle-down": { name: "triangle-down" },
  review: { name: "diff" },
  "outline-globe-plus": { name: "globe-plus" },
}

// Still drawn with today's artwork under the experiment, awaiting a new design. Uses in the desktop app in brackets.
// Pairs on one line likely share a design.
//
// Status:   circle-x (1), outline-hexagonal-warning (7, old timeline only) / warning (6), status / status-active (4),
//           info (2)
// Features: mcp (5), models, link, share, brain / outline-brain, shield
// Arrows:   arrow-up-right (5) / outline-arrow-up-right (3), arrow-down-to-line (2)
// Layout:   layout-left / layout-left-full (4), layout-right / layout-right-full (2), dot-grid
// Files:    grid-plus (4), filetree, open-file (2),
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
