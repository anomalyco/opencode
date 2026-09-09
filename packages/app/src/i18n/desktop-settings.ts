import type { DesktopNativeLocale } from "./desktop-native"

type KeepAwakeCopy = {
  title: string
  description: string
}

export const KEEP_AWAKE_COPY = {
  en: {
    title: "Keep computer and display awake",
    description: "Prevent the display from turning off and the computer from sleeping while OpenCode Desktop is running.",
  },
  zh: {
    title: "保持计算机和显示器唤醒",
    description: "OpenCode Desktop 运行时，防止显示器关闭并阻止计算机进入睡眠状态。",
  },
  zht: {
    title: "讓電腦和顯示器保持喚醒",
    description: "OpenCode Desktop 執行時，防止顯示器關閉並阻止電腦進入睡眠狀態。",
  },
  ko: {
    title: "컴퓨터와 디스플레이 절전 방지",
    description: "OpenCode Desktop이 실행되는 동안 디스플레이가 꺼지거나 컴퓨터가 절전 모드로 전환되지 않도록 합니다.",
  },
  de: {
    title: "Computer und Bildschirm aktiv halten",
    description: "Verhindert, dass sich der Bildschirm ausschaltet oder der Computer in den Ruhezustand wechselt, solange OpenCode Desktop ausgeführt wird.",
  },
  es: {
    title: "Mantener activos el equipo y la pantalla",
    description: "Evita que la pantalla se apague y que el equipo entre en suspensión mientras OpenCode Desktop esté en ejecución.",
  },
  fr: {
    title: "Maintenir l’ordinateur et l’écran actifs",
    description: "Empêche l’écran de s’éteindre et l’ordinateur de se mettre en veille tant qu’OpenCode Desktop est en cours d’exécution.",
  },
  da: {
    title: "Hold computer og skærm aktive",
    description: "Forhindrer, at skærmen slukker, og at computeren går i slumretilstand, mens OpenCode Desktop kører.",
  },
  ja: {
    title: "コンピューターとディスプレイをスリープさせない",
    description: "OpenCode Desktop の実行中は、ディスプレイがオフになったりコンピューターがスリープ状態になったりしないようにします。",
  },
  pl: {
    title: "Nie usypiaj komputera ani ekranu",
    description: "Zapobiega wyłączaniu ekranu i przechodzeniu komputera w tryb uśpienia podczas działania OpenCode Desktop.",
  },
  ru: {
    title: "Не выключать экран и не переводить компьютер в спящий режим",
    description: "Пока OpenCode Desktop запущен, экран не будет выключаться, а компьютер — переходить в спящий режим.",
  },
  uk: {
    title: "Не вимикати екран і не переводити комп’ютер у режим сну",
    description: "Поки OpenCode Desktop запущено, екран не вимикатиметься, а комп’ютер не переходитиме в режим сну.",
  },
  ar: {
    title: "إبقاء الكمبيوتر والشاشة في وضع التشغيل",
    description: "يمنع إيقاف تشغيل الشاشة ودخول الكمبيوتر في وضع السكون أثناء تشغيل OpenCode Desktop.",
  },
  no: {
    title: "Hold datamaskinen og skjermen aktive",
    description: "Hindrer at skjermen slås av og at datamaskinen går i hvilemodus mens OpenCode Desktop kjører.",
  },
  br: {
    title: "Mirout an urzhiataer hag ar skramm dihun",
    description: "Mirout a ra ar skramm ouzh lazhañ hag an urzhiataer ouzh mont da gousket e-pad ma vez OpenCode Desktop o vont en-dro.",
  },
  th: {
    title: "ป้องกันคอมพิวเตอร์และจอภาพเข้าสู่โหมดสลีป",
    description: "ป้องกันไม่ให้จอภาพปิดและคอมพิวเตอร์เข้าสู่โหมดสลีปขณะที่ OpenCode Desktop กำลังทำงาน",
  },
  bs: {
    title: "Drži računar i ekran budnim",
    description: "Sprečava isključivanje ekrana i prelazak računara u stanje mirovanja dok je OpenCode Desktop pokrenut.",
  },
  tr: {
    title: "Bilgisayarı ve ekranı uyanık tut",
    description: "OpenCode Desktop çalışırken ekranın kapanmasını ve bilgisayarın uyku moduna geçmesini engeller.",
  },
  hi: {
    title: "कंप्यूटर और डिस्प्ले को सक्रिय रखें",
    description: "OpenCode Desktop के चलने के दौरान डिस्प्ले को बंद होने और कंप्यूटर को स्लीप मोड में जाने से रोकता है।",
  },
  nl: {
    title: "Computer en beeldscherm actief houden",
    description: "Voorkomt dat het beeldscherm wordt uitgeschakeld en de computer in de slaapstand gaat terwijl OpenCode Desktop actief is.",
  },
  id: {
    title: "Jaga komputer dan layar tetap aktif",
    description: "Mencegah layar mati dan komputer masuk mode tidur selama OpenCode Desktop berjalan.",
  },
  vi: {
    title: "Giữ máy tính và màn hình luôn hoạt động",
    description: "Ngăn màn hình tắt và máy tính chuyển sang chế độ ngủ khi OpenCode Desktop đang chạy.",
  },
  it: {
    title: "Mantieni attivi computer e schermo",
    description: "Impedisce lo spegnimento dello schermo e la sospensione del computer mentre OpenCode Desktop è in esecuzione.",
  },
  ur: {
    title: "کمپیوٹر اور ڈسپلے کو فعال رکھیں",
    description: "OpenCode Desktop چلنے کے دوران ڈسپلے کو بند ہونے اور کمپیوٹر کو سلیپ موڈ میں جانے سے روکتا ہے۔",
  },
  pa: {
    title: "ਕੰਪਿਊਟਰ ਅਤੇ ਡਿਸਪਲੇ ਨੂੰ ਸਰਗਰਮ ਰੱਖੋ",
    description: "OpenCode Desktop ਚੱਲਦੇ ਸਮੇਂ ਡਿਸਪਲੇ ਨੂੰ ਬੰਦ ਹੋਣ ਅਤੇ ਕੰਪਿਊਟਰ ਨੂੰ ਸਲੀਪ ਮੋਡ ਵਿੱਚ ਜਾਣ ਤੋਂ ਰੋਕਦਾ ਹੈ।",
  },
  az: {
    title: "Kompüteri və ekranı aktiv saxla",
    description: "OpenCode Desktop işləyərkən ekranın sönməsinin və kompüterin yuxu rejiminə keçməsinin qarşısını alır.",
  },
  fi: {
    title: "Pidä tietokone ja näyttö hereillä",
    description: "Estää näytön sammumisen ja tietokoneen siirtymisen lepotilaan OpenCode Desktopin ollessa käynnissä.",
  },
  sv: {
    title: "Håll datorn och skärmen aktiva",
    description: "Förhindrar att skärmen stängs av och att datorn går in i viloläge medan OpenCode Desktop körs.",
  },
  am: {
    title: "ኮምፒውተሩን እና ማሳያውን ንቁ አድርግ",
    description: "OpenCode Desktop እየሰራ ሳለ ማሳያው እንዳይጠፋ እና ኮምፒውተሩ ወደ እንቅልፍ ሁነታ እንዳይገባ ይከላከላል።",
  },
  bg: {
    title: "Поддържане на компютъра и екрана активни",
    description: "Предотвратява изключването на екрана и преминаването на компютъра в режим на заспиване, докато OpenCode Desktop работи.",
  },
  bn: {
    title: "কম্পিউটার ও ডিসপ্লে সক্রিয় রাখুন",
    description: "OpenCode Desktop চলার সময় ডিসপ্লে বন্ধ হওয়া এবং কম্পিউটার স্লিপ মোডে যাওয়া প্রতিরোধ করে।",
  },
  ca: {
    title: "Mantén actius l’ordinador i la pantalla",
    description: "Evita que la pantalla s’apagui i que l’ordinador entri en repòs mentre OpenCode Desktop s’està executant.",
  },
  cs: {
    title: "Udržovat počítač a obrazovku aktivní",
    description: "Zabrání vypnutí obrazovky a přechodu počítače do režimu spánku, když je OpenCode Desktop spuštěný.",
  },
  dv: {
    title: "ކޮމްޕިއުޓަރާއި ސްކްރީން ހޭލައި ބަހައްޓާ",
    description: "OpenCode Desktop ދުވަމުން ދާ ހިނދު ސްކްރީން ނިވުމާއި ކޮމްޕިއުޓަރު ސްލީޕް މޯޑަށް ދިއުން ހުއްޓުވައެވެ.",
  },
  dz: {
    title: "གློག་རིག་འཕྲུལ་ཆས་དང་གསལ་ཤེལ་གཉིས་ཀ་ལས་ཀ་འབད་བཞག",
    description: "OpenCode Desktop ལས་ཀ་འབད་བའི་སྐབས་ གསལ་ཤེལ་གསད་ནི་དང་ གློག་རིག་འཕྲུལ་ཆས་ཉལ་ཐངས་ནང་འགྱོ་ནི་ལས་བཀགཔ་ཨིན།",
  },
  el: {
    title: "Διατήρηση υπολογιστή και οθόνης ενεργών",
    description: "Αποτρέπει την απενεργοποίηση της οθόνης και τη μετάβαση του υπολογιστή σε αναστολή λειτουργίας όσο εκτελείται το OpenCode Desktop.",
  },
  et: {
    title: "Hoia arvuti ja ekraan aktiivsena",
    description: "Takistab ekraani väljalülitumist ja arvuti unerežiimi minekut ajal, mil OpenCode Desktop töötab.",
  },
  fa: {
    title: "رایانه و نمایشگر را روشن نگه دار",
    description: "هنگام اجرای OpenCode Desktop از خاموش شدن نمایشگر و رفتن رایانه به حالت خواب جلوگیری می‌کند.",
  },
  fo: {
    title: "Halt telduna og skíggjan vakin",
    description: "Forðar skíggjanum í at sløkna og telduni í at fara í dvala, meðan OpenCode Desktop koyrir.",
  },
  hr: {
    title: "Drži računalo i zaslon budnima",
    description: "Sprječava isključivanje zaslona i prelazak računala u stanje mirovanja dok je OpenCode Desktop pokrenut.",
  },
  hu: {
    title: "A számítógép és a kijelző maradjon aktív",
    description: "Megakadályozza a kijelző kikapcsolását és a számítógép alvó állapotba lépését, amíg az OpenCode Desktop fut.",
  },
  hy: {
    title: "Համակարգիչն ու էկրանը պահել ակտիվ",
    description: "OpenCode Desktop-ի աշխատանքի ընթացքում կանխում է էկրանի անջատումը և համակարգչի քնի ռեժիմ անցնելը։",
  },
  is: {
    title: "Halda tölvunni og skjánum vakandi",
    description: "Kemur í veg fyrir að skjárinn slökkni og tölvan fari í svefn á meðan OpenCode Desktop er í gangi.",
  },
  ka: {
    title: "კომპიუტერისა და ეკრანის აქტიურ მდგომარეობაში შენარჩუნება",
    description: "OpenCode Desktop-ის მუშაობისას ხელს უშლის ეკრანის გამორთვას და კომპიუტერის ძილის რეჟიმში გადასვლას.",
  },
  km: {
    title: "រក្សាកុំព្យូទ័រ និងអេក្រង់ឱ្យសកម្ម",
    description: "ការពារមិនឱ្យអេក្រង់បិទ និងកុំព្យូទ័រចូលរបៀបគេង ខណៈពេល OpenCode Desktop កំពុងដំណើរការ។",
  },
  lo: {
    title: "ຮັກສາຄອມພິວເຕີ ແລະ ໜ້າຈໍໃຫ້ເຮັດວຽກຢູ່",
    description: "ປ້ອງກັນບໍ່ໃຫ້ໜ້າຈໍດັບ ແລະ ຄອມພິວເຕີເຂົ້າໂໝດພັກ ໃນຂະນະທີ່ OpenCode Desktop ກຳລັງເຮັດວຽກ.",
  },
  lt: {
    title: "Neleisti kompiuteriui ir ekranui užmigti",
    description: "Neleidžia ekranui išsijungti ir kompiuteriui pereiti į miego režimą, kol veikia OpenCode Desktop.",
  },
  lv: {
    title: "Neļaut datoram un ekrānam aizmigt",
    description: "Neļauj ekrānam izslēgties un datoram pāriet miega režīmā, kamēr darbojas OpenCode Desktop.",
  },
  mk: {
    title: "Одржувај ги компјутерот и екранот активни",
    description: "Спречува екранот да се исклучи и компјутерот да премине во режим на спиење додека работи OpenCode Desktop.",
  },
  mn: {
    title: "Компьютер болон дэлгэцийг идэвхтэй байлгах",
    description: "OpenCode Desktop ажиллаж байх үед дэлгэц унтрах болон компьютер унтах горимд шилжихээс сэргийлнэ.",
  },
  ms: {
    title: "Kekalkan komputer dan paparan aktif",
    description: "Menghalang paparan daripada dimatikan dan komputer daripada memasuki mod tidur semasa OpenCode Desktop berjalan.",
  },
  my: {
    title: "ကွန်ပျူတာနှင့် မျက်နှာပြင်ကို နိုးနေစေပါ",
    description: "OpenCode Desktop လည်ပတ်နေစဉ် မျက်နှာပြင်ပိတ်သွားခြင်းနှင့် ကွန်ပျူတာ အိပ်စက်မုဒ်သို့ ဝင်ရောက်ခြင်းကို တားဆီးပေးသည်။",
  },
  ne: {
    title: "कम्प्युटर र डिस्प्लेलाई सक्रिय राख्नुहोस्",
    description: "OpenCode Desktop चलिरहेको बेला डिस्प्ले बन्द हुन र कम्प्युटर स्लीप मोडमा जानबाट रोक्छ।",
  },
  ro: {
    title: "Menține computerul și ecranul active",
    description: "Împiedică oprirea ecranului și intrarea computerului în modul de repaus cât timp rulează OpenCode Desktop.",
  },
  si: {
    title: "පරිගණකය සහ තිරය සක්‍රියව තබන්න",
    description: "OpenCode Desktop ක්‍රියාත්මක වන අතරතුර තිරය අක්‍රිය වීම සහ පරිගණකය නිද්‍රා ප්‍රකාරයට යාම වළක්වයි.",
  },
  sk: {
    title: "Udržiavať počítač a obrazovku aktívne",
    description: "Zabráni vypnutiu obrazovky a prechodu počítača do režimu spánku, kým je OpenCode Desktop spustený.",
  },
  sl: {
    title: "Ohrani računalnik in zaslon aktivna",
    description: "Prepreči izklop zaslona in prehod računalnika v stanje spanja, ko je OpenCode Desktop zagnan.",
  },
  sq: {
    title: "Mbaji kompjuterin dhe ekranin aktivë",
    description: "Parandalon fikjen e ekranit dhe kalimin e kompjuterit në gjendje gjumi ndërsa OpenCode Desktop është duke punuar.",
  },
  sr: {
    title: "Одржавај рачунар и екран активним",
    description: "Спречава искључивање екрана и прелазак рачунара у режим спавања док је OpenCode Desktop покренут.",
  },
  tg: {
    title: "Компютер ва экранро фаъол нигоҳ доред",
    description: "Ҳангоми кори OpenCode Desktop хомӯш шудани экран ва ба ҳолати хоб гузаштани компютерро пешгирӣ мекунад.",
  },
  tk: {
    title: "Kompýuteri we ekrany işjeň sakla",
    description: "OpenCode Desktop işleýän wagty ekranyň öçmeginiň we kompýuteriň uky režimine geçmeginiň öňüni alýar.",
  },
  uz: {
    title: "Kompyuter va ekranni faol saqlash",
    description: "OpenCode Desktop ishlayotgan paytda ekran o‘chishi va kompyuter uyqu rejimiga o‘tishining oldini oladi.",
  },
} satisfies Record<DesktopNativeLocale, KeepAwakeCopy>

export function desktopSettingsDict(locale: DesktopNativeLocale) {
  const copy = KEEP_AWAKE_COPY[locale]
  return {
    "settings.general.row.keepAwake.title": copy.title,
    "settings.general.row.keepAwake.description": copy.description,
  } as const
}
