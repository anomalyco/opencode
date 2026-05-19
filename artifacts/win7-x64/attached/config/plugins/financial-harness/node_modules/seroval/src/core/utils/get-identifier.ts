// Written by https://github.com/DylanPiercey and is distributed under the MIT license.
const REF_START_CHARS = /* @__PURE__ */ 'hjkmoquxzABCDEFGHIJKLNPQRTUVWXYZ$_'; // Avoids chars that could evaluate to a reserved word.
const REF_START_CHARS_LEN = /* @__PURE__ */ REF_START_CHARS.length;
const REF_CHARS =
  /* @__PURE__ */ 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$_';
const REF_CHARS_LEN = /* @__PURE__ */ REF_CHARS.length;

export default function getIdentifier(index: number): string {
  let mod = index % REF_START_CHARS_LEN;
  let ref = REF_START_CHARS[mod];
  index = (index - mod) / REF_START_CHARS_LEN;
  while (index > 0) {
    mod = index % REF_CHARS_LEN;
    ref += REF_CHARS[mod];
    index = (index - mod) / REF_CHARS_LEN;
  }
  return ref;
}
