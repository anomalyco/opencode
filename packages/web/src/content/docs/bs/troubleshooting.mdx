---
title: Rješavanje problema
description: Uobičajeni problemi i kako ih riješiti.
---

Da biste otklonili probleme s OpenCode, počnite provjeravanjem dnevnika i lokalnih podataka koje pohranjuje na disku.

---

## Dnevnici

Log fajlovi se pišu na:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Pritisnite `WIN+R` i zalijepite `%USERPROFILE%\.local\share\opencode\log`

Datoteke evidencije se imenuju vremenskim oznakama (npr. `2025-01-09T123456.log`) i čuvaju se najnovijih 10 datoteka dnevnika.

Možete postaviti nivo dnevnika pomoću opcije komandne linije `--log-level` da biste dobili detaljnije informacije o otklanjanju grešaka. Na primjer, `opencode --log-level DEBUG`.

---

## Pohrana

OpenCode pohranjuje podatke o sesiji i druge podatke aplikacije na disku na:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Pritisnite `WIN+R` i zalijepite `%USERPROFILE%\.local\share\opencode`

Ovaj direktorij sadrži:

- `auth.json` - ​​Podaci o autentifikaciji kao što su API ključevi, OAuth tokeni
- `log/` - ​​Dnevnici aplikacije
- `project/` - ​​Podaci specifični za projekat kao što su podaci o sesiji i poruci
  - Ako je projekat unutar Git repo-a, on je pohranjen u `./<project-slug>/storage/`
  - Ako nije Git repo, pohranjuje se u `./global/storage/`

---

## Desktop aplikacija

OpenCode Desktop pokreće lokalni OpenCode server (`opencode-cli` sidecar) u pozadini. Većina problema je uzrokovana nedostatkom dodatka, oštećenom keš memorijom ili lošim postavkama servera.

### Brze provjere

- Potpuno zatvorite i ponovo pokrenite aplikaciju.
- Ako aplikacija prikaže ekran s greškom, kliknite na **Restart** i kopirajte detalje o grešci.
- samo za macOS: `OpenCode` meni -> **Ponovo učitaj Webview** (pomaže ako je korisnički interfejs prazan/zamrznut).

---

### Onemogućavanje dodataka

Ako se desktop aplikacija ruši pri pokretanju, visi ili se čudno ponaša, počnite s onemogućavanjem dodataka.

#### Provjerite globalnu konfiguraciju

Otvorite svoju globalnu konfiguracijsku datoteku i potražite ključ `plugin`.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (ili `~/.config/opencode/opencode.json`)
- **macOS/Linux** (starije instalacije): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Pritisnite `WIN+R` i zalijepite `%USERPROFILE%\.config\opencode\opencode.jsonc`

Ako imate konfigurirane dodatke, privremeno ih onemogućite uklanjanjem ključa ili postavljanjem na prazan niz:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Provjera direktorija dodataka

OpenCode također može učitati lokalne dodatke s diska. Privremeno ih maknite s puta (ili preimenujte folder) i ponovo pokrenite desktop aplikaciju:

- **Globalni dodaci**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Pritisnite `WIN+R` i zalijepite `%USERPROFILE%\.config\opencode\plugins`
- **Projektni dodaci** (samo ako koristite konfiguraciju po projektu)
  - `<your-project>/.opencode/plugins/`

Ako aplikacija ponovo počne raditi, ponovo omogućite dodatke jedan po jedan kako biste otkrili koji od njih uzrokuje problem.

---

### Brisanje keš memorije

Ako onemogućavanje dodataka ne pomogne (ili se instalacija dodatka zaglavila), obrišite keš memoriju kako bi ga OpenCode mogao ponovo izgraditi.

1. Potpuno zatvorite OpenCode Desktop.
2. Izbrišite keš direktorij:

- **macOS**: Finder -> `Cmd+Shift+G` -> zalijepi `~/.cache/opencode`
- **Linux**: obrišite `~/.cache/opencode` (ili pokrenite `rm -rf ~/.cache/opencode`)
- **Windows**: Pritisnite `WIN+R` i zalijepite `%USERPROFILE%\.cache\opencode`

3. Ponovo pokrenite OpenCode Desktop.

---

### Rješavanje problema sa vezom na serveru

OpenCode Desktop može ili pokrenuti svoj lokalni server (podrazumevano) ili se povezati na URL servera koji ste konfigurisali.

Ako vidite dijaloški okvir **"Povezivanje nije uspjelo"** (ili aplikacija nikada ne prođe kroz početni ekran), provjerite da li postoji prilagođeni URL servera.

#### Obrišite zadani URL servera radne površine

Na početnom ekranu kliknite na ime servera (sa tačkom statusa) da otvorite birač servera. U odjeljku **Podrazumevani server** kliknite na **Obriši**.

#### Uklonite `server.port` / `server.hostname` iz vaše konfiguracije

Ako vaš `opencode.json(c)` sadrži odjeljak `server`, privremeno ga uklonite i ponovo pokrenite desktop aplikaciju.

#### Provjerite varijable okruženja

Ako ste postavili `OPENCODE_PORT` u svom okruženju, desktop aplikacija će pokušati da koristi taj port za lokalni server.

- Poništite `OPENCODE_PORT` (ili odaberite slobodan port) i ponovo pokrenite.

---

### Linux: Wayland / X11 problemi

Na Linuxu, neka podešavanja Waylanda mogu uzrokovati prazne prozore ili greške sastavljača.

- Ako ste na Waylandu, a aplikacija je prazna/ispada, pokušajte pokrenuti sa `OC_ALLOW_WAYLAND=1`.
- Ako to pogorša stvari, uklonite ga i pokušajte pokrenuti pod X11 sesijom umjesto toga.

---

### Windows: WebView2 izvršno okruženje

Na Windows-u, OpenCode Desktop zahtijeva Microsoft Edge **WebView2 Runtime**. Ako se aplikacija otvori u praznom prozoru ili se ne pokrene, instalirajte/ažurirajte WebView2 i pokušajte ponovo.

---

### Windows: Opšti problemi sa performansama

Ako imate spore performanse, probleme s pristupom datotekama ili probleme s terminalom na Windows-u, pokušajte koristiti [WSL (Windows podsistem za Linux)](/docs/windows-wsl). WSL pruža Linux okruženje koje radi neprimetnije sa OpenCode karakteristikama.

---

### Obavještenja se ne prikazuju

OpenCode Desktop prikazuje sistemska obavještenja samo kada:

- obavještenja su omogućena za OpenCode u postavkama vašeg OS-a, i
- prozor aplikacije nije fokusiran.

---

### Resetovanje pohrane desktop aplikacije

Ako se aplikacija ne pokrene i ne možete izbrisati postavke unutar korisničkog sučelja, resetirajte spremljeno stanje desktop aplikacije.

1. Zatvorite OpenCode Desktop.
2. Pronađite i izbrišite ove datoteke (oni žive u direktoriju podataka OpenCode Desktop aplikacije):

- `opencode.settings.dat` (URL zadanog servera za desktop)
- `opencode.global.dat` i `opencode.workspace.*.dat` (stanje korisničkog interfejsa poput nedavnih servera/projekata)

Da brzo pronađete direktorij:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (onda potražite nazive fajlova iznad)
- **Linux**: potražite nazive fajlova iznad pod `~/.local/share`
- **Windows**: Pritisnite `WIN+R` -> `%APPDATA%` (zatim potražite nazive fajlova iznad)

---

## Traženje pomoći

Ako imate problema s OpenCode:

1. **Prijavite probleme na GitHub**

   Najbolji način da prijavite greške ili zatražite funkcije je putem našeg GitHub spremišta:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Prije kreiranja novog problema, pretražite postojeće probleme da vidite je li vaš problem već prijavljen.

2. **Pridružite se našem Discordu**

   Za pomoć u stvarnom vremenu i diskusiju u zajednici, pridružite se našem Discord serveru:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Uobičajeni problemi

Evo nekih uobičajenih problema i kako ih riješiti.

---

### OpenCode se ne pokreće

1. Provjerite dnevnike za poruke o greškama
2. Pokušajte pokrenuti sa `--print-logs` da vidite izlaz u terminalu
3. Uvjerite se da imate najnoviju verziju sa `opencode upgrade`

---

### Problemi s autentifikacijom

1. Pokušajte ponovo autentifikovati sa naredbom `/connect` u TUI
2. Provjerite da li su vaši API ključevi važeći
3. Uvjerite se da vaša mreža dozvoljava veze s API-jem provajdera

---

### Model nije dostupan

1. Provjerite jeste li se autentifikovali kod provajdera
2. Provjerite je li naziv modela u vašoj konfiguraciji tačan
3. Neki modeli mogu zahtijevati poseban pristup ili pretplate

Ako naiđete na `ProviderModelNotFoundError` najvjerovatnije niste u pravu
referenciranje modela negdje.
Modele treba referencirati ovako: `<providerId>/<modelId>`

primjeri:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Da saznate kojim modelima imate pristup, pokrenite `opencode models`

---

### ProviderInitError

Ako naiđete na grešku ProviderInitError, vjerovatno imate nevažeću ili oštećenu konfiguraciju.

Da biste ovo riješili:

1. Prvo provjerite da li je vaš provajder ispravno postavljen slijedeći [vodič za pružatelje](/docs/providers)
2. Ako se problem nastavi, pokušajte obrisati pohranjenu konfiguraciju:

```bash
   rm -rf ~/.local/share/opencode
```

Na Windows-u pritisnite `WIN+R` i izbrišite: `%USERPROFILE%\.local\share\opencode`

3. Ponovo izvršite autentifikaciju kod svog provajdera koristeći naredbu `/connect` u TUI.

---

### AI_APICallError i problemi sa paketom dobavljača

Ako naiđete na greške API poziva, to može biti zbog zastarjelih paketa dobavljača. OpenCode dinamički instalira pakete dobavljača (OpenAI, Anthropic, Google, itd.) po potrebi i kešira ih lokalno.

Da biste riješili probleme s paketom dobavljača:

1. Obrišite keš paketa provajdera:

```bash
   rm -rf ~/.cache/opencode
```

Na Windows-u pritisnite `WIN+R` i izbrišite: `%USERPROFILE%\.cache\opencode`

2. Ponovo pokrenite OpenCode da ponovo instalirate najnovije pakete dobavljača

Ovo će prisiliti OpenCode da preuzme najnovije verzije paketa dobavljača, što često rješava probleme kompatibilnosti s parametrima modela i promjenama API-ja.

---

### Copy/paste ne radi na Linuxu

Korisnici Linuxa moraju imati instaliran jedan od sljedećih uslužnih programa međuspremnika da bi funkcionirala funkcionalnost kopiranja/lijepljenja:

**Za X11 sisteme:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Za Wayland sisteme:**

```bash
apt install -y wl-clipboard
```

**Za okruženja bez glave:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

OpenCode će otkriti da li koristite Wayland i preferirate `wl-clipboard`, u suprotnom će pokušati pronaći alate međuspremnika po redoslijedu: `xclip` i `xsel`.
