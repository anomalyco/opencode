import type { Dict } from "./en"
import { dict as en } from "./en"

export const dict = {
  ...en,
  "go.referral.ended.label": "Uyarı",
  "go.referral.ended":
    "Tavsiye programı sona erdi. Tavsiye bağlantıları artık size veya bağlantıyı paylaşan kişiye kredi kazandırmıyor.",
  "nav.github": "GitHub",
  "nav.docs": "Dokümantasyon",
  "nav.enterprise": "Kurumsal",
  "nav.zen": "Zen",
  "nav.login": "Giriş",
  "nav.free": "İndir",
  "nav.home": "Ana sayfa",
  "nav.openMenu": "Menüyü aç",
  "nav.getStartedFree": "Ücretsiz başla",
  "nav.logoAlt": "OpenCode",

  "nav.context.copyLogo": "Logoyu SVG olarak kopyala",
  "nav.context.copyWordmark": "Wordmark'ı SVG olarak kopyala",
  "nav.context.brandAssets": "Marka varlıkları",

  "footer.github": "GitHub",
  "footer.docs": "Dokümantasyon",
  "footer.changelog": "Değişiklik günlüğü",
  "footer.discord": "Discord",
  "footer.x": "X",

  "legal.brand": "Marka",
  "legal.privacy": "Gizlilik",
  "legal.terms": "Koşullar",

  "email.title": "Yeni ürünler yayınladığımızda ilk siz haberdar olun",
  "email.subtitle": "Erken erişim için bekleme listesine katılın.",
  "email.placeholder": "E-posta adresi",
  "email.subscribe": "Abone ol",
  "email.success": "Neredeyse bitti, gelen kutunuzu kontrol edin ve e-postanızı onaylayın",
  "email.error": "Abonelik başarısız oldu. Lütfen tekrar deneyin.",

  "notFound.title": "Bulunamadı | opencode",
  "notFound.heading": "404 - Sayfa bulunamadı",
  "notFound.home": "Ana sayfa",
  "notFound.docs": "Dokümantasyon",
  "notFound.github": "GitHub",
  "notFound.discord": "Discord",
  "notFound.logoLightAlt": "opencode açık logo",
  "notFound.logoDarkAlt": "opencode koyu logo",

  "common.cancel": "İptal",
  "common.contactUs": "Bize ulaşın",

  "common.videoUnsupported": "Tarayıcınız video etiketini desteklemiyor.",
  "common.figure": "Şekil {{n}}.",
  "common.faq": "SSS",
  "common.learnMore": "Daha fazla bilgi",

  "app.meta.description": "OpenCode - Açık kaynaklı kodlama ajanı.",

  "home.title": "OpenCode | Açık kaynaklı yapay zeka kodlama ajanı",

  "home.banner.badge": "Yeni",

  "home.hero.title": "Açık kaynaklı yapay zeka kodlama ajanı",
  "home.hero.subtitle.a": "Ücretsiz modeller dahil veya herhangi bir sağlayıcıdan herhangi bir modeli bağlayın,",
  "home.hero.subtitle.b": "Claude, GPT, Gemini ve daha fazlası dahil.",

  "home.install.ariaLabel": "Kurulum seçenekleri",

  "home.what.title": "OpenCode nedir?",
  "home.what.body":
    "OpenCode, terminalinizde, IDE'nizde veya masaüstünde kod yazmanıza yardım eden açık kaynaklı bir ajandır.",
  "home.what.multiSession.title": "Çoklu oturum",
  "home.what.multiSession.body": "Aynı projede birden fazla ajanı paralel çalıştırın",
  "home.what.copilot.title": "GitHub Copilot",
  "home.what.copilot.body": "Copilot hesabınızı kullanmak için GitHub ile giriş yapın",
  "home.what.chatgptPlus.title": "ChatGPT Plus/Pro",
  "home.what.chatgptPlus.body": "ChatGPT Plus veya Pro hesabınızı kullanmak için OpenAI ile giriş yapın",
  "home.what.anyModel.title": "Herhangi bir model",
  "home.what.anyModel.body": "Models.dev üzerinden 75+ LLM sağlayıcısı, yerel modeller dahil",
  "home.what.anyEditor.title": "Herhangi bir editör",
  "home.what.anyEditor.body": "Terminal arayüzü, masaüstü uygulaması ve IDE uzantısı olarak kullanılabilir",
  "home.what.readDocs": "Dokümanları oku",

  "home.growth.title": "Açık kaynaklı yapay zeka kodlama ajanı",
  "home.growth.body":
    "GitHub'da <strong>{{stars}}</strong>+ yıldız, <strong>{{contributors}}</strong> katılımcı ve <strong>{{commits}}</strong>+ commit ile OpenCode, her ay <strong>{{monthlyUsers}}</strong>+ geliştirici tarafından kullanılıyor ve güveniliyor.",
  "home.growth.githubStars": "GitHub Yıldızları",
  "home.growth.contributors": "Katılımcılar",
  "home.growth.monthlyDevs": "Aylık Geliştiriciler",

  "home.privacy.title": "Gizlilik öncelikli tasarlandı",
  "home.privacy.body":
    "OpenCode kodunuzu veya bağlam verilerinizi saklamaz; bu sayede gizliliğe duyarlı ortamlarda çalışabilir.",
  "home.privacy.learnMore": "Hakkında daha fazla bilgi:",
  "home.privacy.link": "gizlilik",

  "home.faq.q1": "OpenCode nedir?",
  "home.faq.a1":
    "OpenCode, herhangi bir AI modeliyle kod yazmanıza ve çalıştırmanıza yardım eden açık kaynaklı bir ajandır. Terminal arayüzü, masaüstü uygulaması veya IDE uzantısı olarak kullanılabilir.",
  "home.faq.q2": "OpenCode'u nasıl kullanırım?",
  "home.faq.a2.before": "Başlamanın en kolay yolu",
  "home.faq.a2.link": "girişi okumaktır",
  "home.faq.q3": "OpenCode için ek AI aboneliklerine ihtiyacım var mı?",
  "home.faq.a3.p1": "Şart değil. OpenCode, hesap açmadan kullanabileceğiniz ücretsiz modellerle gelir.",
  "home.faq.a3.p2.beforeZen": "Bunun dışında, popüler kodlama modellerini kullanmak için bir",
  "home.faq.a3.p2.afterZen": " hesabı oluşturabilirsiniz.",
  "home.faq.a3.p3": "Zen'i öneriyoruz, ancak OpenCode OpenAI, Anthropic, xAI gibi popüler sağlayıcılarla da çalışır.",
  "home.faq.a3.p4.beforeLocal": "Hatta",
  "home.faq.a3.p4.localLink": "yerel modellerinizi bağlayabilirsiniz",
  "home.faq.q4": "Mevcut AI aboneliklerimi OpenCode ile kullanabilir miyim?",
  "home.faq.a4.p1": "Evet, ChatGPT Plus/Pro veya GitHub Copilot aboneliklerinizi kullanabilirsiniz.",
  "home.faq.q5": "OpenCode'u sadece terminalde mi kullanabilirim?",
  "home.faq.a5.beforeDesktop": "Artık hayır! OpenCode artık sizin bu cihazlarınıza",
  "home.faq.a5.desktop": "masaüstü",
  "home.faq.a5.and": "ve",
  "home.faq.a5.web": "web",
  "home.faq.q6": "OpenCode ne kadar?",
  "home.faq.a6":
    "OpenCode %100 ücretsizdir. Ayrıca ücretsiz model setiyle gelir. Başka bir sağlayıcı bağlarsanız ek maliyetler olabilir.",
  "home.faq.q7": "Veri ve gizlilik ne olacak?",
  "home.faq.a7.p1": "Verileriniz yalnızca ücretsiz modellerimizi kullandığınızda saklanır.",
  "home.faq.a7.p2.beforeModels": "Daha fazla bilgi:",
  "home.faq.a7.p2.modelsLink": "modellerimiz",
  "home.faq.q8": "OpenCode açık kaynak mı?",
  "home.faq.a8.p1": "Evet, OpenCode tamamen açık kaynaktır. Kaynak kodu",
  "home.faq.a8.p2": "'da",
  "home.faq.a8.mitLicense": "MIT Lisansı",
  "home.faq.a8.p3":
    "altında herkese açıktır, yani herkes kullanabilir, değiştirebilir veya geliştirmeye katkıda bulunabilir. Topluluktan herkes issue açabilir, pull request gönderebilir ve işlevselliği genişletebilir.",

  "home.zenCta.title": "Kodlama ajanları için güvenilir, optimize modeller",
  "home.zenCta.body":
    "Zen, OpenCode'un kodlama ajanları için özel olarak test edip benchmark ettiği seçilmiş AI modellerine erişim sağlar. Sağlayıcılar arasında tutarsız performans ve kalite konusunda endişelenmeyin; çalışan, doğrulanmış modelleri kullanın.",
  "home.zenCta.link": "Zen hakkında",

  "zen.title": "OpenCode Zen | Kodlama ajanları için güvenilir, optimize edilmiş modellerin seçilmiş seti",
  "zen.hero.title": "Kodlama ajanları için güvenilir, optimize modeller",
  "zen.hero.body":
    "Zen, OpenCode'un kodlama ajanları için özel olarak test edip benchmark ettiği seçilmiş AI modellerine erişim sağlar. Sağlayıcılar arasında tutarsız performans ve kalite konusunda endişelenmeyin; çalışan, doğrulanmış modelleri kullanın.",

  "zen.faq.q1": "OpenCode Zen nedir?",
  "zen.faq.a1":
    "Zen, OpenCode ekibi tarafından oluşturulan ve kodlama ajanları için test edilip benchmark edilen seçilmiş bir AI model setidir.",
  "zen.faq.q2": "Zen'i daha doğru yapan nedir?",
  "zen.faq.a2":
    "Zen yalnızca kodlama ajanları için özel olarak test edilip benchmark edilmiş modelleri sunar. Biftek kesmek için tereyağı bıçağı kullanmazsın; kodlama için kötü modeller kullanma.",
  "zen.faq.q3": "Zen daha ucuz mu?",
  "zen.faq.a3":
    "Zen kâr amaçlı değildir. Zen, model sağlayıcılarının maliyetlerini size yansıtır. Zen'in kullanımı arttıkça OpenCode daha iyi fiyatlar pazarlayabilir ve bunları size yansıtabilir.",
  "zen.faq.q4": "Zen ne kadar?",
  "zen.faq.a4.p1.beforePricing": "Zen",
  "zen.faq.a4.p1.pricingLink": "istek başı ücret alır",
  "zen.faq.a4.p1.afterPricing":
    "ve hiçbir markup eklemez, yani model sağlayıcının ücretlendirdiği tutarı aynen ödersiniz.",
  "zen.faq.a4.p2.beforeAccount": "Toplam maliyetiniz kullanım miktarına bağlıdır ve aylık harcama limitlerini",
  "zen.faq.a4.p2.accountLink": "hesabınızda ayarlayabilirsiniz",
  "zen.faq.a4.p3":
    "Maliyetleri karşılamak için OpenCode, $20 bakiye yüklemesi başına yalnızca $1.23 tutarında küçük bir ödeme işleme ücreti ekler.",
  "zen.faq.q5": "Veri ve gizlilik ne olacak?",
  "zen.faq.a5.beforeExceptions":
    "Tüm Zen modelleri ABD'de ve AB'de barındırılır. Sağlayıcılar sıfır-retention politikasını uygular ve verilerinizi model eğitimi için kullanmaz; şu",
  "zen.faq.a5.exceptionsLink": "istisnalarla",
  "zen.faq.q6": "Harcama limitleri ayarlayabilir miyim?",
  "zen.faq.a6": "Evet, hesabınızda aylık harcama limitleri ayarlayabilirsiniz.",
  "zen.faq.q7": "İptal edebilir miyim?",
  "zen.faq.a7":
    "Evet, istediğiniz zaman faturalandırmayı devre dışı bırakabilir ve kalan bakiyenizi kullanabilirsiniz.",
  "zen.faq.q8": "Zen'i diğer kodlama ajanlarıyla kullanabilir miyim?",
  "zen.faq.a8":
    "Zen OpenCode ile harika çalışır, ama Zen'i herhangi bir ajan ile kullanabilirsiniz. Tercih ettiğiniz kodlama ajanında kurulum talimatlarını izleyin.",
  "zen.faq.q9": "Para iadesi alabilir miyim?",
  "zen.faq.a9":
    "Ücret son 14 gün içinde tahsil edildiyse ve bu satın alımdan gelen kredilerin hiçbirini kullanmadıysanız para iadesine hak kazanabilirsiniz. {{contact}} ve para iadesi talep edin.",

  "zen.cta.start": "Zen'i kullanmaya başlayın",
  "zen.pricing.title": "20$ Kullandıkça öde bakiyesi ekle",
  "zen.pricing.fee": "(+1,23$ kart işlem ücreti)",
  "zen.pricing.body":
    "Herhangi bir ajan ile kullanın. Aylık harcama limitlerini belirleyin. İstediğiniz zaman iptal edin.",
  "zen.problem.title": "Zen hangi sorunu çözüyor?",
  "zen.problem.body":
    "Pek çok model mevcut ancak yalnızca birkaçı kodlama ajanlarıyla iyi çalışıyor. Çoğu sağlayıcı, bunları değişen sonuçlarla farklı şekilde yapılandırır.",
  "zen.problem.subtitle": "Bu sorunu yalnızca OpenCode kullanıcıları için değil, herkes için düzeltiyoruz.",
  "zen.problem.item1": "Seçilen modelleri test etme ve ekiplerine danışmanlık yapma",
  "zen.problem.item2": "Düzgün bir şekilde teslim edildiklerinden emin olmak için sağlayıcılarla çalışmak",
  "zen.problem.item3": "Önerdiğimiz tüm model-sağlayıcı kombinasyonlarının karşılaştırılması",
  "zen.how.title": "Zen nasıl çalışır?",
  "zen.how.body": "Zen'i OpenCode ile kullanmanızı önersek de, Zen'i herhangi bir ajan ile kullanabilirsiniz.",
  "zen.how.step1.title": "Kaydolun ve 20$ bakiye ekleyin",
  "zen.how.step1.beforeLink": "takip edin",
  "zen.how.step1.link": "kurulum talimatları",
  "zen.how.step2.title": "Şeffaf fiyatlandırmayla Zen kullanın",
  "zen.how.step2.link": "istek başına ödeme",
  "zen.how.step2.afterLink": "sıfır işaretlemeyle",
  "zen.how.step3.title": "Otomatik yükleme",
  "zen.how.step3.body": "isteğe bağlı otomatik yüklemeyi etkinleştirin, bakiye eşiğini ve yükleme tutarını seçin",
  "zen.privacy.title": "Gizliliğiniz bizim için önemlidir",
  "zen.privacy.beforeExceptions":
    "Tüm Zen modelleri ABD'de ve AB'de barındırılmaktadır. Sağlayıcılar sıfır saklama politikası izler ve verilerinizi model eğitimi için kullanmaz; şu",
  "zen.privacy.exceptionsLink": "aşağıdaki istisnalar",

  "go.promo.kimiK31Pro": "Kimi K3.1 Pro artık Go'da kullanılabilir.",
  "go.title": "OpenCode Go | Herkes için düşük maliyetli kodlama modelleri",
  "go.meta.description":
    "Go ayda 10$'dır; cömert kullanım limitleri ve önde gelen kodlama modellerine güvenilir erişim sunar.",
  "go.hero.title": "Herkes için düşük maliyetli kodlama modelleri",
  "go.hero.tagline": "Herhangi bir ajanla kullanın. Gerekirse kredi yükleyin. İstediğiniz zaman iptal edin.",
  "go.hero.body":
    "Go, dünya çapındaki programcılara ajan tabanlı kodlama getiriyor. En yetenekli açık kaynaklı modellere cömert limitler ve güvenilir erişim sunarak, maliyet veya erişilebilirlik konusunda endişelenmeden güçlü ajanlarla geliştirme yapmanızı sağlar.",

  "go.cta.text": "Go'ya abone ol",
  "go.plans.month": "aylık",
  "go.plans.plus.cta": "Go Plus'a abone ol",
  "go.plans.plus.description": "Go Plus ayda 40$'dır ve daha yüksek limitler sunar.",
  "go.plans.go.feature1": "Seçilmiş, uygun fiyatlı modeller",
  "go.plans.go.feature2": "Ajan destekli kodlama için test edildi",
  "go.plans.go.feature3": "Cömert limitler ve güvenilir erişim",
  "go.plans.plus.feature1": "Go'daki her şey dahil",
  "go.plans.plus.feature2": "Daha uzun, odaklı kodlama oturumları için daha yüksek limitler",
  "go.plans.plus.feature3": "Daha büyük ve zorlu projeler için",
  "go.plans.limits": "Limitler",
  "go.plans.description": "Model başına 5 saatlik tahmini istek ve aylık kullanım limitleri",
  "go.plans.legend": "Planlar",
  "go.graph.period": "Kullanım",
  "go.graph.model": "Model",
  "go.graph.requests": "Tahmini istek / 5 saat",
  "go.graph.allowance": "Aylık kullanım",
  "go.graph.new": "Yeni",
  "go.graph.bonus": "{{count}}× kullanım",
  "go.graph.scale": "Doğrusal olmayan istek ölçeği",
  "go.graph.showAll": "{{count}} modelin tümünü göster",
  "go.graph.showLess": "Daha az model göster",
  "go.graph.limitedRegions": "sınırlı bölgeler",
  "go.graph.limitedTime": "sınırlı süre",
  "go.graph.usageLimits": "Kullanım limitleri",

  "go.problem.title": "Go hangi sorunu çözüyor?",
  "go.problem.body":
    "OpenCode deneyimini mümkün olduğunca çok kişiye ulaştırmaya odaklandık. OpenCode Go, ayda 10$ olan düşük maliyetli bir aboneliktir. Cömert limitler ve en yetenekli açık kaynak modellere güvenilir erişim sağlar.",
  "go.problem.item1": "Düşük maliyetli abonelik fiyatlandırması",
  "go.problem.item2": "Cömert limitler ve güvenilir erişim",
  "go.problem.item3": "Mümkün olduğunca çok programcı için geliştirildi",
  "go.problem.item4": "Ajan tabanlı kodlama için test edilmiş, özenle seçilmiş model seçenekleri",
  "go.how.title": "Go nasıl çalışır?",
  "go.how.body": "Go ayda 10$'dır. OpenCode veya herhangi bir ajanla kullanabilirsiniz.",
  "go.how.step1.title": "Bir hesap oluşturun",
  "go.how.step1.beforeLink": "takip edin",
  "go.how.step1.link": "kurulum talimatları",
  "go.how.step2.title": "Go'ya abone olun",
  "go.how.step2.link": "Ayda 10$",
  "go.how.step2.afterLink": "cömert limitlerle",
  "go.how.step3.title": "Kodlamaya başlayın",
  "go.how.step3.body": "açık kaynaklı modellere güvenilir erişimle",
  "go.faq.q1": "OpenCode Go nedir?",
  "go.faq.a1":
    "Go, ajan tabanlı kodlama için yetenekli açık kaynaklı modellere güvenilir erişim sağlayan düşük maliyetli bir aboneliktir.",
  "go.faq.q2": "Go hangi modelleri içerir?",
  "go.faq.a2": "Go, aşağıda listelenen modelleri cömert limitler ve güvenilir erişimle sunar.",
  "go.faq.q3": "Go, Zen ile aynı mı?",
  "go.faq.a3":
    "Hayır. Zen kullandıkça öde modelidir; Go ise ayda 10$'dır ve özenle seçilmiş model seçeneklerine cömert limitlerle güvenilir erişim sunar.",
  "go.faq.q4": "Go ne kadar?",
  "go.faq.a4.p1.beforePricing": "Go'nun maliyeti",
  "go.faq.a4.p1.pricingLink": "ayda 10$",
  "go.faq.a4.p1.afterPricing": "cömert limitlerle.",
  "go.faq.a4.p2.beforeAccount": "Aboneliğinizi",
  "go.faq.a4.p2.accountLink": "hesabınızdan",
  "go.faq.a4.p3": "yönetebilirsiniz. İstediğiniz zaman iptal edin.",
  "go.faq.q5": "Veri ve gizlilik ne olacak?",
  "go.faq.a5.model": "Model",
  "go.faq.a5.training": "Model eğitimi",
  "go.faq.a5.retention": "Veri saklama",
  "go.faq.a5.retention30": "30 gün",
  "go.faq.a5.retention0": "0 gün",
  "go.faq.a5.used": "Kullanılır",
  "go.faq.a5.notUsed": "Kullanılmaz",
  "go.faq.a5.notZdr": "ZDR değil",
  "go.faq.a5.grokRetention":
    "ZDR, durum bilgisi tutan Responses API, Files and Collections ve Batch API dahil olmak üzere saklanan verilere bağlı önemli API özelliklerini devre dışı bırakır.",
  "go.faq.a5.gptRetention":
    "Tüm API özelliklerinin kullanımı için kötüye kullanım izleme günlükleri oluşturulur ve 30 güne kadar saklanır.",
  "go.faq.a5.learnMore": "Daha fazla bilgi",
  "go.faq.a5.deepseekRetention":
    "ZDR anlaşması aylık olarak yenilenir. Mevcut anlaşma 31 Ekim 2026 tarihine kadar geçerlidir.",
  "go.faq.a5.museRetention":
    "İstemlerinizi ve tamamlamalarınızı gelecekteki Meta modellerini eğitmek için kullanma izni karşılığında büyük ölçüde indirimli token fiyatları.",

  "go.faq.q6": "Kredi yükleyebilir miyim?",
  "go.faq.a6": "Daha fazla kullanıma ihtiyacınız varsa, hesabınıza kredi yükleyebilirsiniz.",
  "go.faq.q7": "İptal edebilir miyim?",
  "go.faq.a7": "Evet, istediğiniz zaman iptal edebilirsiniz.",
  "go.faq.q8": "Go'yu diğer kodlama ajanlarıyla kullanabilir miyim?",
  "go.faq.a8":
    "Evet, Go'yu herhangi bir ajanla kullanabilirsiniz. Tercih ettiğiniz kodlama ajanındaki kurulum talimatlarını izleyin.",

  "go.faq.q9": "Ücretsiz modeller ve Go arasındaki fark nedir?",
  "go.faq.a9":
    "Ücretsiz modeller, Big Pickle'ı ve o sırada mevcut olan promosyonel modelleri içerir. Go ise kayan zaman aralıklarında daha yüksek istek kotalarıyla özenle seçilmiş model seçenekleri sunar: aylık kotanın %20'si her 5 saatte, %50'si haftada ve %100'ü ayda kullanılabilir. Modele özgü kullanım hakları farklılık gösterebilir (gerçek istek sayıları modele ve kullanıma göre değişir).",
  "go.faq.q10": "Para iadesi alabilir miyim?",
  "go.faq.a10":
    "Ücret son 14 gün içinde tahsil edildiyse ve ilgili faturalandırma döneminde Go kullanım hakkınızı hiç kullanmadıysanız para iadesine hak kazanabilirsiniz. {{contact}} ve para iadesi talep edin.",

  "download.title": "OpenCode | İndir",
  "download.meta.description": "OpenCode'u macOS, Windows ve Linux için indirin",
  "download.section.terminal": "OpenCode Terminal",
  "download.section.desktop": "OpenCode Desktop",
  "download.section.extensions": "OpenCode Eklentileri",
  "download.section.integrations": "OpenCode Entegrasyonları",
  "download.action.download": "İndir",
  "download.action.install": "Kur",

  "download.platform.macosAppleSilicon": "macOS (Apple Silicon)",
  "download.platform.macosIntel": "macOS (Intel)",
  "download.platform.windowsX64": "Windows (x64)",
  "download.platform.windowsArm64": "Windows (ARM64)",
  "download.platform.linuxDeb": "Linux (.deb)",
  "download.platform.linuxRpm": "Linux (.rpm)",

  "download.faq.a3.beforeLocal":
    "Tam olarak değil, ama muhtemelen. OpenCode'u ücretli bir sağlayıcıya bağlamak istiyorsanız bir AI aboneliği gerekir, ancak",
  "download.faq.a3.localLink": "yerel modeller",
  "download.faq.a3.afterLocal.beforeZen": "ile ücretsiz çalışabilirsiniz. Kullanıcıları",
  "download.faq.a3.afterZen":
    " kullanmaya teşvik ediyoruz, ancak OpenCode OpenAI, Anthropic, xAI vb. gibi tüm popüler sağlayıcılarla çalışır.",

  "download.faq.a5.p1": "OpenCode %100 ücretsizdir.",
  "download.faq.a5.p2.beforeZen":
    "Ek maliyetler, bir model sağlayıcısına olan aboneliğinizden gelir. OpenCode herhangi bir model sağlayıcısıyla çalışır, ancak",
  "download.faq.a5.p2.afterZen": " kullanmanızı öneririz.",

  "enterprise.title": "OpenCode | Kurumunuz için kurumsal çözümler",
  "enterprise.meta.description": "Kurumsal çözümler için OpenCode ile iletişime geçin",
  "enterprise.hero.title": "Kodunuz size aittir",
  "enterprise.hero.body1":
    "OpenCode, hiçbir veri veya bağlam saklamadan ve lisans kısıtlamaları ya da sahiplik iddiaları olmadan kuruluşunuzun içinde güvenli şekilde çalışır. Ekibinizle bir deneme başlatın, ardından SSO'nuz ve dahili AI geçidiniz ile entegre ederek tüm kuruluşunuzda devreye alın.",
  "enterprise.hero.body2": "Nasıl yardımcı olabileceğimizi bize söyleyin.",
  "enterprise.form.name.label": "Ad soyad",
  "enterprise.form.name.placeholder": "Jeff Bezos",
  "enterprise.form.role.label": "Rol",
  "enterprise.form.role.placeholder": "Yönetim Kurulu Başkanı",
  "enterprise.form.company.label": "Şirket",
  "enterprise.form.company.placeholder": "Acme Inc",
  "enterprise.form.email.label": "Şirket e-postası",
  "enterprise.form.email.placeholder": "jeff@amazon.com",
  "enterprise.form.phone.label": "Telefon numarası",
  "enterprise.form.phone.placeholder": "+1 234 567 8900",
  "enterprise.form.inferenceSpend.label": "Şirketinizin mevcut aylık çıkarım (inference) harcaması nedir (USD)?",
  "enterprise.form.inferenceSpend.placeholder": "Bir aralık seçin (isteğe bağlı)",
  "enterprise.form.inferenceSpend.none": "Henüz harcama yok",
  "enterprise.form.inferenceSpend.under1k": "$1K altı",
  "enterprise.form.inferenceSpend.1kTo10k": "$1K–$10K",
  "enterprise.form.inferenceSpend.10kTo50k": "$10K–$50K",
  "enterprise.form.inferenceSpend.50kTo100k": "$50K–$100K",
  "enterprise.form.inferenceSpend.over100k": "$100K veya daha fazla",
  "enterprise.form.message.label": "Hangi problemi çözmeye çalışıyorsunuz?",
  "enterprise.form.message.placeholder": "Şu konuda yardıma ihtiyacımız var...",
  "enterprise.form.send": "Gönder",
  "enterprise.form.sending": "Gönderiliyor...",
  "enterprise.form.success": "Mesaj gönderildi, yakında size dönüş yapacağız.",
  "enterprise.form.success.submitted": "Form başarıyla gönderildi.",
  "enterprise.form.error.allFieldsRequired": "Tüm alanlar gereklidir.",
  "enterprise.form.error.invalidEmailFormat": "Geçersiz e-posta formatı.",
  "enterprise.form.error.invalidInferenceSpend": "Geçerli bir çıkarım harcaması aralığı seçin.",
  "enterprise.form.error.internalServer": "İç sunucu hatası.",
  "enterprise.form.error.captcha": "Captcha doğrulaması başarısız oldu. Lütfen tekrar deneyin.",
  "enterprise.faq.title": "SSS",
  "enterprise.faq.q1": "OpenCode Enterprise nedir?",
  "enterprise.faq.a1":
    "OpenCode Enterprise, kodunuzun ve verilerinizin asla altyapınızı terk etmemesini sağlamak isteyen kurumlar içindir. Bunu, SSO'nuz ve dahili AI geçidiniz ile entegre olan merkezileştirilmiş bir konfigürasyonla sağlar.",
  "enterprise.faq.q2": "OpenCode Enterprise'a nasıl başlarım?",
  "enterprise.faq.a2":
    "Ekibinizle dahili bir deneme ile başlayın. OpenCode varsayılan olarak kodunuzu veya bağlam verilerinizi saklamaz, bu da başlamayı kolaylaştırır. Ardından fiyatlandırma ve uygulama seçeneklerini görüşmek için bize ulaşın.",
  "enterprise.faq.q3": "Kurumsal fiyatlandırma nasıl çalışır?",
  "enterprise.faq.a3":
    "Kendi LLM geçidiniz varsa, kullanılan tokenlar için ücret almıyoruz. Daha fazla bilgi için, kurumunuzun ihtiyaçlarına göre özel bir teklif için bize ulaşın.",
  "enterprise.faq.q4": "OpenCode Enterprise ile verilerim güvende mi?",
  "enterprise.faq.a4":
    "Evet. OpenCode kodunuzu veya bağlam verilerinizi saklamaz. Tüm işleme yerel olarak ya da AI sağlayıcınıza doğrudan API çağrıları ile gerçekleştirilir. Merkezileştirilmiş konfigürasyon ve SSO entegrasyonu ile verileriniz kurumunuzun altyapısı içinde güvende kalır.",

  "brand.title": "OpenCode | Marka",
  "brand.meta.description": "OpenCode marka kılavuzu",
  "brand.heading": "Marka kılavuzu",
  "brand.subtitle": "OpenCode markası ile çalışmanıza yardımcı olacak kaynaklar ve varlıklar.",
  "brand.downloadAll": "Tüm varlıkları indir",

  "changelog.title": "OpenCode | Değişiklik günlüğü",
  "changelog.meta.description": "OpenCode sürüm notları ve değişiklik günlüğü",
  "changelog.hero.title": "Değişiklik günlüğü",
  "changelog.hero.subtitle": "OpenCode için yeni güncellemeler ve iyileştirmeler",
  "changelog.empty": "Değişiklik günlüğü kaydı bulunamadı.",
  "changelog.viewJson": "JSON'u görüntüle",
} satisfies Dict
