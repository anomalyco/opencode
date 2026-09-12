# الخطوط العربية وإعداد الـ terminal

التطبيق (TUI) ميقدرش يحمّل أو يختار خطوط. هو بيطلع خلايا يونيكود، والـ terminal
هو اللي بيرسمها بالخط اللي **أنت** بتختاره. التعديل اللي في المستودع ده بيظبط
**الترتيب والاتجاه والمحاذاة والالتفاف**؛ أما خط الـ terminal فهو اللي بيخلي
الحروف العربية تتوصل وتطلع بشكل صح.

> English: [fonts.md](./fonts.md)

## ليه مينفعش نحدد الخط من OpenCode

خلية الـ terminal هي حرف يونيكود واحد بيرسمه محرك خطوط الـ terminal (DirectWrite
في Windows Terminal). التطبيقات مينفعش تودّي خطوط في المسار ده. اللي التطبيق
**يقدر** يعمله — واللي بيعمله المستودع ده — هو إنه يحط الحروف الصح في الخلايا
الصح بالترتيب الصح.

## خطوط عربية مقترحة

| الخط | الطراز | ملاحظات |
| --- | --- | --- |
| [Cairo](https://fonts.google.com/specimen/Cairo) | سانس حديث | متناسب العرض؛ الأفضل كـ fallback |
| [Noto Naskh Arabic](https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic) | نسخ تقليدي | متناسب العرض |
| [IBM Plex Sans Arabic](https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic) | سانس احترافي | متناسب العرض |
| [Amiri](https://fonts.google.com/specimen/Amiri) | نسخ كلاسيكي | متناسب العرض |
| [Tajawal](https://fonts.google.com/specimen/Tajawal) / [Almarai](https://fonts.google.com/specimen/Almarai) | سانس حديث | متناسب العرض |

ويندوز بيجي أصلًا بخطوط **Segoe UI** و **Tahoma** و **Arial** وبيغطوا العربي،
فالعربي بيظهر من غير أي حاجة — لكن مش دايمًا بأحسن توصيل. تركيب خط من اللي فوق
بيحسّن شكل التشكيل.

> ملاحظة مهمة: الخطوط دي **متناسبة العرض** مش monospaced. لو حطيت واحد منها كـ
> `face` أساسي، النص اللاتيني هيبقى غير متساوي العرض والمحاذاة ممكن تخرب. الإعداد
> الموصى به إنك تسيب الخط الـ monospaced الأساسي وتضيف الخط العربي كـ
> **fallback**، فالحروف العربية بس هي اللي تستخدمه.

## Windows Terminal

ملف `settings.json` (نسخة المتجر):

```
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
```

### اختيار الخط من جوه OpenCode

اكتب `/fonts` في البرومبت وهتفتحلك قايمة الخطوط. بتعرض الخطوط المركّبة على
جهازك (الخطوط العربية المقترحة في الأول)، وبتحفظ اختيارك في إعدادات الـ terminal
لوحدها مع نسخة احتياطية. بعد كده اقفل التيرمنال وافتحه تاني. **ومش بتركّب أي خط
على الجهاز.**

الأمر ده بيعدّل `profiles.defaults.font.fallbacks`، يعني العربي هيستخدم الخط
اللي اخترته والإنجليزي والكود هيفضلوا بالخط الـ monospaced.

### يدويًا

أضف الخطوط العربية كـ fallbacks داخل `profiles.defaults.font`:

```json
{
  "profiles": {
    "defaults": {
      "font": {
        "fallbacks": ["Cairo", "Noto Naskh Arabic", "Segoe UI", "Tahoma"]
      }
    }
  }
}
```

أو شغّل السكربت الجاهز في نفس المجلد (بيعمل نسخة احتياطية أول حاجة):

```powershell
powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1
# أو مع تحديد الخط الأساسي كمان:
powershell -ExecutionPolicy Bypass -File docs/rtl/configure-windows-terminal-font.ps1 -Face "Cascadia Mono"
```

بعد التعديل اقفل Windows Terminal وافتحه تاني.

## ترمينال VS Code

في `settings.json`:

```json
{
  "terminal.integrated.fontFamily": "'Cascadia Mono', 'Cairo', 'Noto Naskh Arabic', monospace"
}
```

## الـ Console القديم (conhost)

كليك يمين على شريط العنوان → Properties → Font. التغطية محدودة؛ وWindows
Terminal أفضل للعربي.

## للتأكد

اكتب في برومبت OpenCode:

```
أهلاً بك في OpenCode
```

ولازم تلاقي الكلام مقروء من اليمين لليسار ومحاذى يمين.
