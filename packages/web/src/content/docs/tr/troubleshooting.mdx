---
title: Sorun giderme
description: Yaygin sorunlar ve cozum adimlari.
---

opencode ile ilgili bir sorunu ayiklamak icin once loglari ve diskte tuttugu yerel verileri kontrol edin.

---

## Loglar

Log dosyalari su konuma yazilir:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: `WIN+R` tuslayip `%USERPROFILE%\.local\share\opencode\log` yapistirin

Log dosyalari zaman damgasiyla adlandirilir (ornegin `2025-01-09T123456.log`) ve en yeni 10 log dosyasi tutulur.

Daha ayrintili ayiklama bilgisi icin `--log-level` komut satiri secenegini kullanabilirsiniz. Ornek: `opencode --log-level DEBUG`.

---

## Depolama

opencode, oturum verilerini ve diger uygulama verilerini diskte su konumda saklar:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: `WIN+R` tuslayip `%USERPROFILE%\.local\share\opencode` yapistirin

Bu dizin sunlari icerir:

- `auth.json` - API anahtarlari, OAuth tokenlari gibi kimlik dogrulama verileri
- `log/` - Uygulama loglari
- `project/` - Oturum ve mesaj verileri gibi projeye ozel veriler
  - Proje bir Git deposundaysa `./<project-slug>/storage/` altinda saklanir
  - Git deposu degilse `./global/storage/` altinda saklanir

---

## Masaüstü uygulaması

opencode Desktop arka planda yerel bir opencode sunucusu (`opencode-cli` sidecar) calistirir. Sorunlarin cogu bozuk bir plugin, hasarli cache veya hatali sunucu ayarindan kaynaklanir.

### Hızlı kontroller

- Uygulamayi tamamen kapatip yeniden acin
- Uygulama hata ekrani gosteriyorsa **Restart**'a tiklayip hata detaylarini kopyalayin
- Yalnizca macOS: `opencode` menusu -> **Reload Webview** (arayuz bos/donukse yardimci olur)

---

### Eklentileri devre dışı bırakın

Desktop uygulamasi acilista cokuyorsa, takiliyorsa veya garip davranislar gosteriyorsa once pluginleri devre disi birakin.

#### Global config'i kontrol edin

Global config dosyanizi acin ve `plugin` anahtarini arayin.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (veya `~/.config/opencode/opencode.json`)
- **macOS/Linux** (eski kurulumlar): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: `WIN+R` tuslayip `%USERPROFILE%\.config\opencode\opencode.jsonc` yapistirin

Plugin tanimliysa anahtari kaldirarak veya bos bir diziye cekerek gecici olarak devre disi birakin:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Eklenti dizinlerini kontrol edin

opencode diskten yerel plugin de yukleyebilir. Bu dizinleri gecici olarak tasiyin (veya klasoru yeniden adlandirin) ve uygulamayi yeniden baslatin:

- **Global plugins**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: `WIN+R` tuslayip `%USERPROFILE%\.config\opencode\plugins` yapistirin
- **Project plugins** (sadece proje bazli config kullaniyorsaniz)
  - `<your-project>/.opencode/plugins/`

Uygulama duzelirse soruna neden olan plugini bulmak icin pluginleri tek tek yeniden etkinlestirin.

---

### Cache'i temizleyin

Pluginleri kapatmak ise yaramazsa (veya plugin kurulumu takili kaldiysa), opencode'un cache'i yeniden olusturmasi icin cache'i temizleyin.

1. opencode Desktop'u tamamen kapatin
2. Cache dizinini silin:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/.cache/opencode`
- **Linux**: `~/.cache/opencode` dizinini silin (veya `rm -rf ~/.cache/opencode` calistirin)
- **Windows**: `WIN+R` tuslayip `%USERPROFILE%\.cache\opencode` yapistirin

3. opencode Desktop'u yeniden baslatin

---

### Sunucu bağlantı sorunlarını düzeltin

opencode Desktop ya kendi yerel sunucusunu baslatir (varsayilan) ya da sizin tanimladiginiz bir sunucu URL'sine baglanir.

**"Connection Failed"** penceresi goruyorsaniz (veya uygulama acilis ekranini gecemiyorsa), ozel bir sunucu URL'si olup olmadigini kontrol edin.

#### Desktop varsayilan sunucu URL'sini temizleyin

Ana ekranda sunucu adina (durum noktali) tiklayarak Server secicisini acin. **Default server** bolumunde **Clear**'a tiklayin.

#### Config'ten `server.port` / `server.hostname` kaldirin

`opencode.json(c)` dosyanizda `server` bolumu varsa gecici olarak kaldirin ve desktop uygulamasini yeniden baslatin.

#### Ortam degiskenlerini kontrol edin

Ortamda `OPENCODE_PORT` ayarliysa desktop uygulamasi yerel sunucu icin o portu kullanmaya calisir.

- `OPENCODE_PORT` degerini kaldirin (veya bos bir port secin) ve yeniden baslatin

---

### Linux: Wayland / X11 sorunları

Linux'ta bazi Wayland kurulumlari bos pencere veya compositor hatalarina yol acabilir.

- Wayland kullaniyorsaniz ve uygulama bos/acilmiyorsa `OC_ALLOW_WAYLAND=1` ile baslatin
- Bu daha kotu olursa kaldirip X11 oturumunda baslatmayi deneyin

---

### Windows: WebView2 Çalışma Zamanı

Windows'ta opencode Desktop, Microsoft Edge **WebView2 Runtime** gerektirir. Uygulama bos pencereyle aciliyorsa veya hic baslamiyorsa WebView2'yi kurup/guncelleyip tekrar deneyin.

---

### Windows: Genel performans sorunları

Windows'ta yavaslik, dosya erisim sorunlari veya terminal problemleri yasiyorsaniz [WSL (Windows Subsystem for Linux)](/docs/windows-wsl) kullanmayi deneyin. WSL, opencode ozellikleriyle daha sorunsuz calisan bir Linux ortami saglar.

---

### Bildirimler görünmüyor

opencode Desktop sistem bildirimlerini yalnizca su durumlarda gosterir:

- Isletim sistemi ayarlarinizda opencode icin bildirimler etkinse
- Uygulama penceresi odakta degilse

---

### Desktop depolamasını sıfırlayın (son çare)

Uygulama acilmiyorsa ve ayarlari arayuz icinden temizleyemiyorsaniz, desktop uygulamasinin kayitli durumunu sifirlayin.

1. opencode Desktop'u kapatin
2. Su dosyalari bulun ve silin (opencode Desktop uygulama veri dizininde yer alirlar):

- `opencode.settings.dat` (desktop varsayilan sunucu URL'si)
- `opencode.global.dat` ve `opencode.workspace.*.dat` (son sunucular/projeler gibi UI durumu)

Dizini hizlica bulmak icin:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (ardindan yukaridaki dosya adlarini aratin)
- **Linux**: `~/.local/share` altinda bu dosya adlarini aratin
- **Windows**: `WIN+R` -> `%APPDATA%` (ardindan bu dosya adlarini aratin)

---

## Yardım alın

opencode ile ilgili bir sorun yasiyorsaniz:

1. **GitHub'da issue acin**

   Hata bildirmek veya ozellik talep etmek icin en iyi yol GitHub depomuzdur:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Yeni issue acmadan once sorununuzun daha once raporlanip raporlanmadigini kontrol edin.

2. **Discord'a katilin**

   Gercek zamanli yardim ve topluluk sohbeti icin Discord sunucumuza katilin:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Yaygın sorunlar

Asagida yaygin sorunlar ve cozumleri yer aliyor.

---

### opencode başlamıyor

1. Hata mesaji icin loglari kontrol edin
2. Terminalde cikti gormek icin `--print-logs` ile calistirin
3. `opencode upgrade` ile en guncel surumu kullandiginizdan emin olun

---

### Kimlik doğrulama sorunları

1. TUI'da `/connect` komutuyla yeniden kimlik dogrulamasi yapin
2. API anahtarlarinizin gecerli oldugunu kontrol edin
3. Aginizin provider API baglantilarina izin verdiginden emin olun

---

### Model kullanılamıyor

1. Provider ile kimlik dogrulamasi yaptiginizi kontrol edin
2. Config'teki model adinin dogru oldugunu dogrulayin
3. Bazi modeller ozel erisim veya abonelik gerektirebilir

`ProviderModelNotFoundError` aliyorsaniz buyuk olasilikla bir yerde model referansi yanlistir.
Model referansi su formatta olmalidir: `<providerId>/<modelId>`

Ornekler:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Erisiminiz olan modelleri gormek icin `opencode models` calistirin.

---

### ProviderInitError

`ProviderInitError` aliyorsaniz buyuk olasilikla config'iniz gecersiz veya bozulmustur.

Cozum adimlari:

1. Once [providers rehberini](/docs/providers) izleyerek provider kurulumunun dogru oldugunu dogrulayin
2. Sorun surerse kayitli konfigurasyonu temizlemeyi deneyin:

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   Windows'ta `WIN+R` tuslayip su konumu silin: `%USERPROFILE%\.local\share\opencode`

3. TUI'da `/connect` komutuyla provider kimlik dogrulamasini tekrar yapin

---

### AI_APICallError ve provider paket sorunlari

API cagrisi hatalari aliyorsaniz bunun nedeni guncel olmayan provider paketleri olabilir. opencode, provider paketlerini (OpenAI, Anthropic, Google vb.) gerektikce dinamik yukler ve yerelde onbellekler.

Provider paket sorunlarini gidermek icin:

1. Provider paket cache'ini temizleyin:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   Windows'ta `WIN+R` tuslayip su konumu silin: `%USERPROFILE%\.cache\opencode`

2. En guncel provider paketlerini yeniden kurmak icin opencode'u yeniden baslatin

Bu, opencode'un en yeni provider paket surumlerini indirmesini zorlar ve model parametresi/API degisikliklerinden kaynakli uyumsuzluklari cogu zaman cozer.

---

### Linux'ta kopyala/yapıştır çalışmıyor

Linux kullanicilarinin kopyala/yapistir ozelliginin calismasi icin asagidaki pano araclarindan en az birini kurmasi gerekir:

**X11 sistemleri icin:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Wayland sistemleri icin:**

```bash
apt install -y wl-clipboard
```

**Headless ortamlar icin:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode, Wayland kullandiginizi algilarsa `wl-clipboard` tercihi yapar. Aksi halde sirayla `xclip` ve `xsel` araclarini arar.
