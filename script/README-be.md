# Беларуская лакалізацыя OpenCode (+ інсталяк)

Дададзена беларуская мова (`be`) у OpenCode і інсталяк для зборкі/ўстаноўкі бінарніка з убудаванай лакалізацыяй.

## Што дададзена

| Файл | Прызначэнне |
|---|---|
| `packages/app/src/i18n/be.ts` | Пераклад асноўнага дадатку (TUI/desktop), 1119 ключоў |
| `packages/ui/src/i18n/be.ts` | Пераклад UI-кампанентаў (diff, session review), 201 ключ |
| `packages/desktop/src/renderer/i18n/be.ts` | Пераклад натыўнага меню desktop, 22 ключы |
| `packages/console/app/src/i18n/be.ts` | Пераклад вэб-кансолі, 755 ключоў |
| `packages/app/src/i18n/desktop-native.ts` | Рэгістрацыя `be` у `DESKTOP_NATIVE_LOCALES / LABELS / LOCALE_TAGS` |
| `packages/app/src/context/language.tsx` | Лоадар `be` у `loaders` (дынамічны імпарт app+ui) |
| `packages/app/src/i18n/parity.test.ts` | `be` у `appLocales` (парытэт-тэст) |
| `packages/desktop/src/renderer/i18n/index.ts` | Імпарт `desktopBe` + галінка `build("be")` |
| `packages/app/src/i18n/desktop-native.test.ts` | `Беларуская` у чаканым спісе моваў |
| `packages/console/app/src/i18n/index.ts` | Лоадар `be` у кансолі |
| `packages/console/app/src/lib/language.ts` | `be` у `LOCALES / LABEL / TAG / DOCS / match()` |
| `script/be-locale-gen.py` | Генератар `be.ts` з `ru.ts` (слоўнік + правілы) |
| `script/validate-be.py` | Праверка парытэту ключоў/плейсхолдараў |
| `script/install-be.sh` | Інсталяк (Unix/macOS): зборка + устаноўка ў `~/.opencode/bin` |
| `script/install-be.ps1` | Інсталяк (Windows/PowerShell) |

## Як абнавіць пераклад

Пры змене `en.ts`/`ru.ts` перагенерыруй `be.ts`:

```bash
python script/be-locale-gen.py
python script/validate-be.py
```

Генератар пераўтварае рускі пераклад (`ru.ts`) у беларускі: увесь слоўнік агульных тэрмінаў + правілы канвертацыі (напрыклад `ться→цца`, `его→яга`). Словы, якіх няма ў слоўніку, застаюцца ў блізкай да рускай форме — гэта чарнавы пераклад, які варта вычытаць перад рэлізам.

## Як усталяваць (зборка + устаноўка)

Патрабуецца [bun](https://bun.sh) (`bun install` + `bun run script/build.ts`).

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File script\install-be.ps1
```

**Unix/macOS:**
```bash
bash script/install-be.sh
```

Скрыпты правяраюць наяўнасць `be.ts`, збіраюць бінарнік з убудаванай беларускай мовай, кладуць яго ў `~/.opencode/bin` і дадаюць у `PATH`.

## Праверка

- `script/validate-be.py` — усе ключы з `en.ts` прысутнічаюць у `be.ts`, плейсхолдары `{{...}}` захаваны.
- `script/be-audit.py` — спіс рускіх слоў, не пакрытых слоўнікам (павінна быць 0).
- Парытэт-тэст OpenCode (`packages/app/src/i18n/parity.test.ts`) цяпер уключае `be`.

## Вычытка носьбітам мовы (працоўны цыкл)

1. Экспарт для вычыткі:
   ```bash
   python script/be-export.py
   ```
   Стварае ў корані рэпа (і копіі ў корань праекта):
   - `be-translation-review.xlsx` — Excel (калонкі: domain / key / english / belarusian / comment)
   - `be-translation-review.csv` — CSV (адкрыецца ў Excel)
   - `be-translation-review.html` — старонка з пошукам, фільтрам і **рэдагаванай калонкай** (кнопка «Спампаваць праўкі»)
   - `be-translation-review.json` — машынны фармат
2. Носьбіт правіць беларускую калонку (у Excel ці проста на HTML-старонцы).
3. Імпарт праўкаў:
   ```bash
   python script/be-import.py [шлях да csv/json]
   ```
   Запісвае `script/be_overrides.py` (праўкі па поўных ключах, найвышэйшы прыярытэт).
4. Перагенерацыя і зборка:
   ```bash
   python script/be-locale-gen.py && python script/validate-be.py
   ```

## Дадатковыя слоўнікі

- `script/be_extra.py` — +649 слоў (асноўны дадатак).
- `script/be_extra2.py` — +612 слоў (вэб-кансоль: білінг, падпіскі).
- `script/be_overrides.py` — аўтагенераваныя праўкі носьбіта (не рэдагаваць рукамі).
