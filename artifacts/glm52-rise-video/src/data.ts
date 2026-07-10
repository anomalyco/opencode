// Verified against the production opencode-stats PlanetScale DB.
// Scope: tier='Go' (OpenCode Go), dataset='zen', client='all', source='all', grain='day'.
// metric = total_tokens. Daily token volume per model; GLM-5.2 (zhipu) launched Jun 17.
// Segments per day (tokens): glm-5.2, deepseek-v4-flash, deepseek-v4-pro, minimax-m3, all others.

export type Day = {
  date: string
  total: number
  glm: number
  dsf: number
  dsp: number
  mm: number
  others: number
}

export const days: Day[] = [
  {
    date: "Jun 12",
    total: 2_283_799_449_383,
    glm: 0,
    dsf: 1_176_701_653_509,
    dsp: 569_527_034_307,
    mm: 159_016_250_684,
    others: 378_554_510_883,
  },
  {
    date: "Jun 13",
    total: 2_008_462_388_420,
    glm: 0,
    dsf: 995_338_131_997,
    dsp: 445_817_536_548,
    mm: 211_743_241_967,
    others: 355_563_477_908,
  },
  {
    date: "Jun 14",
    total: 2_007_785_405_251,
    glm: 0,
    dsf: 983_954_176_228,
    dsp: 428_151_999_341,
    mm: 262_476_527_930,
    others: 333_202_701_752,
  },
  {
    date: "Jun 15",
    total: 2_694_736_103_062,
    glm: 0,
    dsf: 1_255_893_953_859,
    dsp: 632_223_338_376,
    mm: 352_507_442_991,
    others: 454_111_367_836,
  },
  {
    date: "Jun 16",
    total: 2_838_153_758_908,
    glm: 0,
    dsf: 1_336_625_283_800,
    dsp: 676_480_415_730,
    mm: 305_268_829_013,
    others: 519_779_230_365,
  },
  {
    date: "Jun 17",
    total: 2_778_964_711_109,
    glm: 70_095_977_043,
    dsf: 1_339_831_523_555,
    dsp: 660_414_395_220,
    mm: 251_302_096_157,
    others: 457_320_719_134,
  },
  {
    date: "Jun 18",
    total: 2_806_992_430_656,
    glm: 201_130_231_172,
    dsf: 1_295_599_996_869,
    dsp: 595_665_008_776,
    mm: 322_205_104_324,
    others: 392_392_089_515,
  },
  {
    date: "Jun 19",
    total: 2_419_611_630_232,
    glm: 199_086_413_910,
    dsf: 1_115_750_468_802,
    dsp: 475_965_869_304,
    mm: 303_586_698_735,
    others: 325_222_179_481,
  },
  {
    date: "Jun 20",
    total: 2_188_278_916_865,
    glm: 193_931_516_396,
    dsf: 1_050_194_681_012,
    dsp: 395_303_435_278,
    mm: 281_998_000_337,
    others: 266_851_283_842,
  },
  {
    date: "Jun 21",
    total: 2_042_309_961_344,
    glm: 181_894_043_118,
    dsf: 985_164_570_580,
    dsp: 368_194_079_542,
    mm: 259_812_551_324,
    others: 247_244_716_780,
  },
  {
    date: "Jun 22",
    total: 2_893_934_325_663,
    glm: 301_759_048_475,
    dsf: 1_298_124_282_989,
    dsp: 581_012_596_194,
    mm: 371_581_117_839,
    others: 341_457_280_166,
  },
  {
    date: "Jun 23",
    total: 3_109_009_321_480,
    glm: 282_277_235_158,
    dsf: 1_423_571_678_821,
    dsp: 627_374_654_587,
    mm: 429_416_300_508,
    others: 346_369_452_406,
  },
  {
    date: "Jun 24",
    total: 2_939_149_971_595,
    glm: 256_497_442_533,
    dsf: 1_373_583_023_234,
    dsp: 601_270_997_775,
    mm: 391_586_493_231,
    others: 316_212_014_822,
  },
  {
    date: "Jun 25",
    total: 3_029_641_552_948,
    glm: 256_279_657_734,
    dsf: 1_481_084_002_776,
    dsp: 602_077_167_287,
    mm: 375_985_302_874,
    others: 314_215_422_277,
  },
]

export const launchIndex = 5 // Jun 17, first day of GLM-5.2 usage
// GLM-5.2 weekly token volume, Jun 19-25 (sum of glm): 1,671,725,357,324 = 1.67T
export const glmWeekTokensT = 1.672

// stacked segments, bottom -> top. GLM-5.2 is the hero (blue); the rest are the field it cut into.
export const segments = [
  { key: "glm", label: "GLM-5.2", color: "#3b5cf6", hero: true },
  { key: "dsf", label: "deepseek-v4-flash", color: "#9ca3ad" },
  { key: "dsp", label: "deepseek-v4-pro", color: "#b3b9c1" },
  { key: "mm", label: "minimax-m3", color: "#c8cdd3" },
  { key: "others", label: "other models", color: "#dde0e4" },
] as const
