// Contributors whose GitHub avatar is a photo of a human face, the only ones the home page's
// contributor wall shows (no logos, organisations, default identicons or illustrations). Reviewed
// by hand from the top 200 contributors on Nov 2, 2026; borderline ones (a small figure in a
// landscape, a heavy filter, a painting, a mask or helmet) are left out. The id guards against a login being renamed and reused.
//
// To refresh: run `bun script/contributor-faces.ts`, open the contact sheet it writes, and add or
// remove entries here, with each one's commit count from the sheet. The wall puts the pinned ones
// first, then orders the rest by live contributions when GitHub answers, or by these stored counts
// when it doesn't (rate limited or down). Avatars load from the user id, so they never need the API.
// `avatar` replaces the GitHub avatar with a photo of the person in public/, where theirs isn't one.
export const faces: { login: string; id: number; contributions: number; avatar?: string }[] = [
  // An exception to the faces rule (his avatar is a painting), on David's request; see `pinned`.
  { login: "thdxr", id: 826656, contributions: 2998 },
  { login: "rekram1-node", id: 63023139, contributions: 2622 },
  { login: "adamdotdevin", id: 2363879, contributions: 2086 },
  { login: "Hona", id: 10430890, contributions: 739 },
  { login: "iamdavidhill", id: 1879069, contributions: 629 },
  // His GitHub avatar is the "KIT" logo, so the wall uses his X profile photo instead, saved at
  // 128×128 from https://unavatar.io/x/kitlangton (x.com/kitlangton) on Nov 3, 2026.
  { login: "kitlangton", id: 7587245, contributions: 2427, avatar: "/avatars/kitlangton.jpg" },
  { login: "fwang", id: 83515, contributions: 509 },
  { login: "jlongster", id: 17031, contributions: 403 },
  // His GitHub avatar is a full-body shot, so the wall uses a crop around his head, cut at 160×160
  // from that avatar (avatars.githubusercontent.com/u/53023) on Nov 5, 2026.
  { login: "jayair", id: 53023, contributions: 355, avatar: "/avatars/jayair.jpg" },
  { login: "simonklee", id: 52795, contributions: 136 },
  { login: "neriousy", id: 34747899, contributions: 133 },
  { login: "vimtor", id: 36263538, contributions: 112 },
  // Anomaly employees outside the top 200 or without a face on GitHub, added for `employees`.
  // Stefan's GitHub avatar is an illustration, so the wall uses a crop around his head from his X
  // profile photo, saved at 160×160 from https://unavatar.io/x/savram8 (x.com/savram8) on Nov 5, 2026.
  { login: "Slickstef11", id: 98915060, contributions: 6, avatar: "/avatars/slickstef11.jpg" },
  { login: "ludvigrask", id: 74653458, contributions: 2 },
  // Juliana's GitHub avatar is a default identicon, so the wall uses her X profile photo, saved at
  // 160×160 and cropped around her head from https://unavatar.io/x/juliana_ardila3
  // (x.com/juliana_ardila3) on Nov 5, 2026.
  { login: "huliardila33", id: 273166952, contributions: 0, avatar: "/avatars/huliardila33.jpg" },
  { login: "michellebakels", id: 74459302, contributions: 0 },
  { login: "dbpolito", id: 347400, contributions: 52 },
  { login: "timoclsn", id: 3763029, contributions: 41 },
  { login: "R44VC0RP", id: 89211796, contributions: 34 },
  { login: "gigamonster256", id: 19415285, contributions: 28 },
  { login: "alexyaroshuk", id: 34632190, contributions: 22 },
  { login: "shantur", id: 586441, contributions: 18 },
  { login: "goniz", id: 976803, contributions: 17 },
  { login: "noamzbr", id: 17730502, contributions: 14 },
  { login: "vaprdev", id: 13180538, contributions: 12 },
  { login: "dc85", id: 83497, contributions: 11 },
  { login: "ezynda3", id: 5308871, contributions: 11 },
  { login: "yordis", id: 4237280, contributions: 11 },
  { login: "IdrisGit", id: 85882535, contributions: 9 },
  { login: "Eric-Guo", id: 1131536, contributions: 7 },
  { login: "altendky", id: 543719, contributions: 7 },
  { login: "didier-durand", id: 2927957, contributions: 6 },
  { login: "malhashemi", id: 64827602, contributions: 6 },
  { login: "PhantomReactor", id: 28865991, contributions: 6 },
  { login: "roerohan", id: 42958812, contributions: 6 },
  { login: "major", id: 89910, contributions: 6 },
  { login: "Seungjun0906", id: 87404676, contributions: 6 },
  { login: "sauerdaniel", id: 81422812, contributions: 6 },
  { login: "edevil", id: 12426, contributions: 5 },
  { login: "Jaaneek", id: 25470423, contributions: 5 },
  { login: "AdiY00", id: 98228296, contributions: 5 },
  { login: "albingroen", id: 19674362, contributions: 5 },
  { login: "kynnyhsap", id: 30318777, contributions: 5 },
  { login: "neominik", id: 22345027, contributions: 5 },
  { login: "jamesmurdza", id: 33395784, contributions: 5 },
  { login: "jcampuza", id: 13089743, contributions: 5 },
  { login: "LeonMueller-OneAndOnly", id: 77194479, contributions: 5 },
  { login: "RhysSullivan", id: 39114868, contributions: 5 },
  { login: "aryasaatvik", id: 5666379, contributions: 5 },
  { login: "rmk40", id: 485042, contributions: 4 },
  { login: "kearns-cu", id: 90280289, contributions: 4 },
  { login: "SteffenDE", id: 4116351, contributions: 4 },
  { login: "tylergannon", id: 50593, contributions: 4 },
  { login: "aspiers", id: 100738, contributions: 4 },
  { login: "paralin", id: 534887, contributions: 4 },
  { login: "grota", id: 403432, contributions: 4 },
  { login: "justrau", id: 10882793, contributions: 4 },
  { login: "maharshi365", id: 26533074, contributions: 4 },
  { login: "kdcokenny", id: 99611484, contributions: 4 },
  { login: "tmeire", id: 109829, contributions: 3 },
  { login: "shanebishop1", id: 71288697, contributions: 3 },
  { login: "assagman", id: 12998211, contributions: 3 },
  { login: "sam-huckaby", id: 5497597, contributions: 3 },
  { login: "natewill", id: 50088025, contributions: 3 },
  { login: "ItsWendell", id: 591280, contributions: 3 },
  { login: "ahosker", id: 346166, contributions: 3 },
  { login: "christso", id: 3115311, contributions: 3 },
  { login: "edemaine", id: 2218736, contributions: 3 },
  { login: "kandros", id: 4562878, contributions: 3 },
  { login: "jknlsn", id: 9172090, contributions: 3 },
  { login: "mattgillard", id: 6270663, contributions: 3 },
  { login: "ShriKaranHanda", id: 79533543, contributions: 3 },
  { login: "jhrudden", id: 46122209, contributions: 3 },
  { login: "ryanskidmore", id: 4580448, contributions: 2 },
  { login: "HelloGGX", id: 19381672, contributions: 2 },
  { login: "spmurrayzzz", id: 1867809, contributions: 2 },
  { login: "rubdos", id: 1263440, contributions: 2 },
  { login: "rwese", id: 7153716, contributions: 2 },
  { login: "sin4ch", id: 79437046, contributions: 2 },
  { login: "NicolaivdSmagt", id: 6626737, contributions: 2 },
  { login: "ndraiman", id: 12609607, contributions: 2 },
  { login: "nwthomas", id: 28681364, contributions: 2 },
  { login: "danlapid", id: 15655504, contributions: 2 },
  { login: "cgilly2fast", id: 20808380, contributions: 2 },
  { login: "ajoslin", id: 1265995, contributions: 2 },
]

// Always first on the wall, in this order, whatever the contribution order (David's request):
// thdxr, jayair (Jay), fwang (Frank), adamdotdevin, iamdavidhill, rekram1-node, kitlangton (Kit).
// The rest of the Anomaly team follows (`employees`), then everyone else by contributions.
export const pinned = [826656, 53023, 83515, 2363879, 1879069, 63023139, 7587245]

// The rest of the Anomaly team (the team in humans.txt, matched to GitHub on Nov 5, 2026), right
// after `pinned` and ordered among themselves like everyone else. Only those in `faces` show;
// Brendonovich, usrnk1, kommander (Sebastian) and arvsrn (Aarav) are listed but left off the wall
// until there's a photo of them, as neither their GitHub nor their X avatar is one.
export const employees = [
  10430890, // Hona (Luke)
  14191578, // Brendonovich (Brendan)
  17031, // jlongster (James)
  7547651, // usrnk1
  335157, // kommander (Sebastian)
  52795, // simonklee (Simon)
  34747899, // neriousy (Filip)
  36263538, // vimtor (Victor)
  96787824, // arvsrn (Aarav)
  89211796, // R44VC0RP (Ryan)
  13180538, // vaprdev (Alan)
  98915060, // Slickstef11 (Stefan)
  74653458, // ludvigrask (Ludvig)
  273166952, // huliardila33 (Juliana)
  74459302, // michellebakels (Michelle)
]
