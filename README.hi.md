<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">ओपन सोर्स एआई कोडिंग एजेंट।</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.hi.md">हिन्दी</a> |
  <a href="README.ur.md">اردو</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### इंस्टॉलेशन (Installation)

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# पैकेज मैनेजर्स
npm i -g @opencode/cli@latest      # या bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS और Linux (अनुशंसित, हमेशा नवीनतम)
brew install opencode              # macOS और Linux (आधिकारिक brew फॉर्मूला, कम अपडेट)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-beta              # Arch Linux (AUR से नवीनतम)
mise use -g opencode               # कोई भी OS
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> इंस्टॉल करने से पहले 0.1.x से पुराने वर्ज़न हटा दें।

### डेस्कटॉप ऐप (BETA)

OpenCode डेस्कटॉप एप्लिकेशन के रूप में भी उपलब्ध है। इसे [opencode.ai/download](https://opencode.ai/download) से डाउनलोड करें।

| प्लेटफ़ॉर्म           | डाउनलोड                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, या `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### इंस्टॉलेशन डायरेक्टरी (Installation Directory)

इंस्टॉल स्क्रिप्ट OpenCode को `$HOME/.opencode/bin` में इंस्टॉल करती है।

### एजेंट्स (Agents)

OpenCode में दो बिल्ट-इन एजेंट शामिल हैं जिनके बीच आप `Tab` की (key) दबाकर स्विच कर सकते हैं।

- **build** - डिफ़ॉल्ट, डेवलपमेंट के काम के लिए पूर्ण-एक्सेस एजेंट
- **plan** - विश्लेषण और कोड एक्सप्लोरेशन के लिए रीड-ओनली एजेंट
  - डिफ़ॉल्ट रूप से फ़ाइल संपादन की अनुमति नहीं देता
  - बैश कमांड चलाने से पहले अनुमति मांगता है
  - अपरिचित कोडबेस को एक्सप्लोर करने या बदलावों की योजना बनाने के लिए आदर्श

इसके अतिरिक्त जटिल खोज और बहु-चरणीय कार्यों के लिए एक **general** सब-एजेंट भी शामिल है।
यह आंतरिक रूप से उपयोग किया जाता है और संदेशों में `@general` लिखकर इसे बुलाया जा सकता है।

[एजेंट्स](https://opencode.ai/v2/docs/agents) के बारे में अधिक जानें।

### दस्तावेज़ (Documentation)

OpenCode को कॉन्फ़िगर करने के तरीके के बारे में अधिक जानकारी के लिए, [**हमारे दस्तावेज़ देखें**](https://opencode.ai/v2/docs)।

### योगदान देना (Contributing)

यदि आप OpenCode में योगदान देने में रुचि रखते हैं, तो कृपया पुल रिक्वेस्ट सबमिट करने से पहले हमारे [योगदान दस्तावेज़](./CONTRIBUTING.md) पढ़ें।

### OpenCode पर निर्माण (Building on OpenCode)

यदि आप किसी ऐसे प्रोजेक्ट पर काम कर रहे हैं जो OpenCode से संबंधित है और अपने नाम के हिस्से के रूप में "opencode" का उपयोग कर रहा है, उदाहरण के लिए "opencode-dashboard" या "opencode-mobile", तो कृपया अपने README में एक नोट जोड़कर स्पष्ट करें कि यह OpenCode टीम द्वारा नहीं बनाया गया है और किसी भी तरह से हमसे संबद्ध नहीं है।

---

**हमारे समुदाय से जुड़ें** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
