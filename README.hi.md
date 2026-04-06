<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">ओपन सोर्स AI कोडिंग एजेंट।</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.hi.md">हिन्दी</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### इंस्टॉलेशन (Installation)

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# पैकेज मैनेजर
npm i -g opencode-ai@latest        # या bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS और Linux (अनुशंसित, हमेशा अपडेटेड)
brew install opencode              # macOS और Linux (आधिकारिक brew फ़ॉर्मूला, कम अपडेट होता है)
sudo pacman -S opencode            # Arch Linux (स्टेबल)
paru -S opencode-bin               # Arch Linux (AUR से नवीनतम)
mise use -g opencode               # कोई भी OS
nix run nixpkgs#opencode           # या नवीनतम dev ब्रांच के लिए github:anomalyco/opencode
```

> [!TIP]
> इंस्टॉल करने से पहले 0.1.x से पुराने वर्शन हटा दें।

### डेस्कटॉप ऐप (Desktop App) (BETA)

OpenCode एक डेस्कटॉप एप्लिकेशन के रूप में भी उपलब्ध है। सीधे [रिलीज़ पेज](https://github.com/anomalyco/opencode/releases) या [opencode.ai/download](https://opencode.ai/download) से डाउनलोड करें।

| प्लेटफ़ॉर्म            | डाउनलोड                                |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, या AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### इंस्टॉलेशन डायरेक्टरी (Installation Directory)

इंस्टॉल स्क्रिप्ट इंस्टॉलेशन पाथ के लिए निम्नलिखित प्राथमिकता क्रम का पालन करती है:

1. `$OPENCODE_INSTALL_DIR` - कस्टम इंस्टॉलेशन डायरेक्टरी
2. `$XDG_BIN_DIR` - XDG बेस डायरेक्टरी स्पेसिफिकेशन अनुरूप पाथ
3. `$HOME/bin` - मानक यूज़र बाइनरी डायरेक्टरी (यदि मौजूद है या बनाई जा सकती है)
4. `$HOME/.opencode/bin` - डिफ़ॉल्ट फ़ॉलबैक

```bash
# उदाहरण
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### एजेंट्स (Agents)

OpenCode में दो बिल्ट-इन एजेंट्स हैं जिन्हें आप `Tab` की (key) से बदल सकते हैं।

- **build** - डिफ़ॉल्ट, डेवलपमेंट कार्य के लिए पूर्ण-एक्सेस एजेंट
- **plan** - विश्लेषण और कोड एक्सप्लोरेशन के लिए रीड-ओनली एजेंट
  - डिफ़ॉल्ट रूप से फाइल एडिट करने से मना करता है
  - बैश कमांड चलाने से पहले अनुमति माँगता है
  - अपरिचित कोडबेस एक्सप्लोर करने या बदलावों की योजना बनाने के लिए आदर्श

इसके अलावा जटिल सर्च और मल्टीस्टेप टास्क के लिए एक **general** सबएजेंट भी शामिल है।
यह आंतरिक रूप से उपयोग किया जाता है और संदेशों में `@general` लिखकर इस्तेमाल किया जा सकता है।

एजेंट्स के बारे में और जानें: [docs](https://opencode.ai/docs/agents)।

### डॉक्यूमेंटेशन (Documentation)

OpenCode को कॉन्फ़िगर करने के बारे में अधिक जानकारी के लिए, [**हमारे डॉक्स देखें**](https://opencode.ai/docs)।

### योगदान (Contributing)

यदि आप OpenCode में योगदान देना चाहते हैं, तो पुल रिक्वेस्ट सबमिट करने से पहले कृपया हमारा [कॉन्ट्रिब्यूटिंग गाइड](./CONTRIBUTING.md) पढ़ें।

### OpenCode पर निर्माण (Building on OpenCode)

यदि आप किसी ऐसे प्रोजेक्ट पर काम कर रहे हैं जो OpenCode से संबंधित है और अपने नाम के हिस्से के रूप में "opencode" का उपयोग करता है, उदाहरण के लिए "opencode-dashboard" या "opencode-mobile", तो कृपया अपनी README में एक नोट जोड़ें जो स्पष्ट करे कि यह OpenCode टीम द्वारा नहीं बनाया गया है और किसी भी तरह से हमसे संबद्ध नहीं है।

### अक्सर पूछे जाने वाले प्रश्न (FAQ)

#### यह Claude Code से कैसे अलग है?

क्षमता के मामले में यह Claude Code से काफ़ी मिलता-जुलता है। यहाँ मुख्य अंतर दिए गए हैं:

- 100% ओपन सोर्स
- किसी प्रोवाइडर से बंधा नहीं है। हालाँकि हम [OpenCode Zen](https://opencode.ai/zen) के माध्यम से दिए जाने वाले मॉडल्स की सिफारिश करते हैं, OpenCode का उपयोग Claude, OpenAI, Google, या यहाँ तक कि लोकल मॉडल्स के साथ भी किया जा सकता है। जैसे-जैसे मॉडल्स बेहतर होंगे, उनके बीच का अंतर कम होगा और कीमतें घटेंगी, इसलिए प्रोवाइडर-एग्नॉस्टिक होना महत्वपूर्ण है।
- आउट-ऑफ़-द-बॉक्स LSP सपोर्ट
- TUI पर फ़ोकस। OpenCode neovim यूज़र्स और [terminal.shop](https://terminal.shop) के क्रिएटर्स द्वारा बनाया गया है; हम टर्मिनल में जो संभव है उसकी सीमाओं को आगे बढ़ाने का प्रयास कर रहे हैं।
- क्लाइंट/सर्वर आर्किटेक्चर। यह, उदाहरण के लिए, OpenCode को आपके कंप्यूटर पर चलाने की अनुमति दे सकता है जबकि आप इसे मोबाइल ऐप से रिमोटली नियंत्रित करें, जिसका अर्थ है कि TUI फ्रंटएंड संभावित क्लाइंट्स में से केवल एक है।

---

**हमारी कम्युनिटी से जुड़ें** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
