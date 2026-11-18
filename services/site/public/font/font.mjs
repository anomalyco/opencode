import { GLYPHS } from './glyphs.mjs';

export const FONT_FAMILY = 'OpenCode';
export const FONT_FILENAME = 'OpenCode.otf';
const LETTERS = Object.keys(GLYPHS);
const INVISIBLE = [0, 9, 10, 13, 0x200b, 0x200c, 0x200d, 0x2060, 0xfe0e, 0xfe0f, 0xfeff];
const RANGES = [
  [0x20, 0x7e],       // Every printable character on a standard keyboard.
  [0xa0, 0x24f],      // Latin-1 and Latin Extended A/B.
  [0x370, 0x52f],     // Greek and Cyrillic.
  [0x1e00, 0x1eff],   // Latin Extended Additional.
  [0x2000, 0x206f],   // Punctuation and spaces.
  [0x20a0, 0x214f],   // Currency and letterlike symbols.
  [0x2190, 0x23ff],   // Arrows, mathematics, and technical symbols.
  [0x2600, 0x27bf],   // Miscellaneous symbols and dingbats.
  [0x1f1e6, 0x1f1ff], // Regional indicators.
  [0x1f300, 0x1f6ff], // Common emoji, pictographs, and transport symbols.
  [0x1f900, 0x1faff], // Supplemental emoji.
];

export const FONT_CODE_POINTS = RANGES.flatMap(([start, end]) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index),
).filter(codePoint => !INVISIBLE.includes(codePoint));

export function defaultFontMapping(character) {
  const key = character.toLowerCase();
  if (Object.hasOwn(GLYPHS, key)) return key;
  let hash = 2166136261;
  for (const letter of key) hash = Math.imul(hash ^ letter.codePointAt(0), 16777619) >>> 0;
  return LETTERS[hash % LETTERS.length];
}

export function createLogoFont(opentype, mapCharacter = defaultFontMapping) {
  const path = data => opentype.Path.fromSVG(data, {
    flipY: true, flipYBase: 36, scale: 20, x: 60, y: 0,
  });
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: path(GLYPHS.o.ink) }),
    new opentype.Glyph({ name: '.null', unicodes: [...INVISIBLE], advanceWidth: 0, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'space', advanceWidth: 480, path: new opentype.Path() }),
  ];

  const letterIndices = new Map();
  for (const letter of LETTERS) {
    letterIndices.set(letter, glyphs.length);
    glyphs.push(new opentype.Glyph({ name: letter, advanceWidth: 600, path: path(GLYPHS[letter].ink) }));
  }

  let mappingHash = 2166136261;
  for (const codePoint of FONT_CODE_POINTS) {
    const character = String.fromCodePoint(codePoint);
    if (/\s/u.test(character)) {
      glyphs[2].addUnicode(codePoint);
      continue;
    }
    // Original logo letters always keep their identity, regardless of the map.
    const key = character.toLowerCase();
    const letter = Object.hasOwn(GLYPHS, key) ? key : mapCharacter(character);
    if (!letterIndices.has(letter)) throw new Error(`Invalid font mapping for U+${codePoint.toString(16)}`);
    glyphs[letterIndices.get(letter)].addUnicode(codePoint);
    mappingHash = Math.imul(mappingHash ^ letter.charCodeAt(0), 16777619) >>> 0;
  }
  // opentype.js selects cmap format 12 using each glyph's primary Unicode.
  // Promote a supplementary alias so emoji aliases are actually serialized.
  for (const glyph of glyphs) {
    const supplementary = glyph.unicodes.find(codePoint => codePoint > 0xffff);
    if (supplementary !== undefined) glyph.unicode = supplementary;
  }

  const signature = mappingHash.toString(16).padStart(8, '0');
  const font = new opentype.Font({
    familyName: FONT_FAMILY,
    styleName: 'Regular',
    postScriptName: `OpenCode-${signature}-Regular`,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    weightClass: 400,
    version: 'Version 1.001',
    description: 'A single-color, six-letter OpenCode logo alphabet. Other characters have fixed substitutions. Original text is preserved.',
    manufacturer: 'OpenType',
    designer: 'OpenCode wordmark',
    designerURL: 'https://opencode.ai',
    glyphs,
  });
  for (const names of Object.values(font.names)) {
    names.uniqueID = { en: `OpenCode-1.001-${signature}` };
  }
  return font;
}
