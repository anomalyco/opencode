import type { ContentOverlay } from "./source"

export const content = {
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Masaüstü eklentileri oluşturun, kurun ve paylaşın.",
      link: "2.2'deki yenilikler",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Desktop'ta açık terminaller artık yeniden başlattığınızda da korunur.",
      link: "v2.2.4'e bakın",
    },
    "agents-can-now-generate-images": {
      text: "Agent'lar artık görsel üretebiliyor.",
      link: "v2.2.1'e bakın",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Oturumlarınızı telefonunuzdan yönetin.",
      link: "OpenCode Mobile ile tanışın",
    },
    "a-refreshed-desktop-app": {
      text: "Yenilenmiş masaüstü uygulaması.",
      link: "2.2'deki yenilikler",
    },
  },
  products: {
    desktop: {
      name: "Desktop",
      body: "macOS, Windows ve Linux'ta oturumlar, sekmeler, değişiklik farkları, yerleşik tarayıcı ve eklentiler.",
      action: "İndir",
    },
    mobile: {
      name: "Mobile",
      body: "Oturumları nerede olursanız olun telefonunuzdan başlatın, yönlendirin ve onaylayın.",
      action: "İndir",
    },
    terminal: {
      name: "Terminal",
      body: "Her kabukta, editörde ya da uzak sunucuda çalışan hızlı bir terminal arayüzü.",
      action: "Kur",
    },
    sdk: {
      name: "SDK",
      body: "OpenCode'u kendi betiklerinizden, CI işlerinizden ve araçlarınızdan yönetin.",
      action: "Belgeleri oku",
    },
    mini: {
      name: "Mini",
      body: "Sade bir terminal arayüzü. Yanıtlar kaydırma geçmişine yazılır, altta tek bir prompt kalır.",
      action: "Kur",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | macOS, Windows ve Linux için masaüstü uygulaması",
      description:
        "Dilediğiniz kadar OpenCode agent'ını paralel çalıştırın. Her değişikliği yan taraftaki tarayıcıda görün ve istediğiniz cihazdan devam edin. macOS, Windows ve Linux için.",
      intro:
        "Birden fazla agent'ı aynı anda çalıştırın, her oturum kendi sekmesinde kalsın. Değişiklik farklarını inceleyin, dilediğiniz satıra yorum bırakın ve sonucu yerleşik tarayıcıda kontrol edin. macOS, Windows ve Linux için.",
      showcase: {
        "parallel-agents": {
          title: "Paralel agent'lar",
          body: "Dilediğiniz kadar agent başlatın ve hepsini paralel çalıştırın. İşleri bittikçe aralarında geçiş yapın.",
        },
        "see-it-in-the-browser": {
          title: "Tarayıcıda gör",
          body: "Uygulamanız agent'ın yanındaki tarayıcıda açılır. Böylece hem siz hem de agent her değişikliği anında görür.",
        },
        "on-every-device": {
          title: "Her cihazda",
          body: "Tüm cihazlarınızdan agent başlatın. Masaüstü uygulamasında, terminalde veya telefonunuzda kaldığınız yerden devam edin.",
        },
        "extend-it": {
          title: "Genişletin",
          body: "Araçlarınızı ve hizmetlerinizi bağlayıp agent'ın bunları kullanmasını sağlayın. Dilerseniz OpenCode'a, kenar çubuğunda kendi arayüzü olan eklentiler yazdırın.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, kodlama oturumlarınız telefonunuzda",
      description:
        "OpenCode oturumlarını telefonunuzdan başlatıp yönlendirin. Agent bilgisayarınızda çalışırken onunla konuşun.",
      intro:
        "Nerede olursanız olun, oturumları telefonunuzdan başlatıp yönlendirin. Oturumu arayarak agent'la konuşun ya da dilediğiniz oturumu açıp kaldığınız yerden devam edin. OpenCode tüm bu işlemlerde kendi bilgisayarınızda çalışır.",
      features: {
        "notify-when-done": {
          title: "Bitince haber ver",
          body: "Başlattığınız bir oturum bitince kısa bir özet alın.",
        },
        "pair-from-anywhere": {
          title: "Her yerden eşle",
          body: "opencode pair --remote ile her ağdan bağlanın.",
        },
        "every-computer": {
          title: "Her bilgisayar",
          body: "Eşlediğiniz bilgisayarlar arasında tek dokunuşla geçin.",
        },
        "siri-and-shortcuts": {
          title: "Siri ve Kestirmeler",
          body: "Siri'den ya da Denetim Merkezi'nden arama veya oturum başlatın.",
        },
        "follow-along": {
          title: "Canlı takip",
          body: "Agent çalışırken zaman çizelgesindeki güncellemeleri anında görün.",
        },
        "your-computer": {
          title: "Bilgisayarınız",
          body: "Kendi makinenizde çalışan OpenCode'a bağlanır.",
        },
        "share-sheet": {
          title: "Paylaşım menüsü",
          body: "Uygulamayı açmadan her şeyi bir oturumla paylaşın.",
        },
        "mute-sessions": {
          title: "Sessize al",
          body: "Bir oturumu listede tutun ama bildirimlerini almayın.",
        },
      },
      showcase: {
        voice: {
          title: "Ses",
          body: "Oturumu arayıp ne istediğinizi söyleyin. Agent size sesli yanıt verir.",
        },
        sessions: {
          title: "Oturumlar",
          body: "Herhangi bir oturumu açıp durumunu görün ve kaldığınız yerden devam edin.",
        },
        results: {
          title: "Sonuçlar",
          body: "İstediğiniz iş tamamlandığında nelerin değiştiğini görüşmede dinleyin.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Açık kaynaklı kodlama agent'ı için terminal arayüzü",
      description:
        "OpenCode için her kabukta, editörde veya uzak sunucuda çalışan hızlı bir terminal arayüzü. Ne istediğinizi anlatın, değişiklik farklarını görün ve komutları onaylayın.",
      intro:
        "Her kabukta, editörde veya uzak sunucuda çalışan hızlı bir terminal arayüzü. Ne istediğinizi sade bir dille anlatın, değişiklik farklarını anında görün ve hangi komutların otomatik çalışacağını seçin.",
      features: {
        "any-terminal": {
          title: "Her terminal",
          body: "Her kabukta, editörünüzün terminalinde ya da uzak sunucuda çalışır.",
        },
        "diffs-in-the-timeline": {
          title: "Akışta değişiklik farkları",
          body: "Agent düzenleme yaptıkça değişiklik farklarını zaman çizelgesinde görün.",
        },
        "pick-up-later": {
          title: "Sonra devam et",
          body: "Son oturuma -c ile, dilediğiniz oturuma -s ile devam edin.",
        },
        "one-off-runs": {
          title: "Tek seferlik çalıştırma",
          body: "opencode run tek bir mesaj gönderir ve yanıtı yazdırır.",
        },
        "agents-and-commands": {
          title: "Agent ve komutlar",
          body: "shift+tab ile agent değiştirin, ctrl+p ile tüm komutları açın.",
        },
        "auto-approve": {
          title: "Otomatik onay",
          body: "Reddetmediğiniz her eyleme izin vermek için --auto ile çalıştırın.",
        },
        "any-server": {
          title: "Her sunucu",
          body: "--server ile bir OpenCode sunucusuna URL üzerinden bağlanın.",
        },
        "usage-stats": {
          title: "Kullanım istatistikleri",
          body: "opencode stats komutu paylaşılabilir kullanım istatistiklerini gösterir.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Sade bir dille anlatın",
          body: "Ne istediğinizi yazın. Agent çalışırken planını gösterir.",
        },
        "approve-what-runs": {
          title: "Komutlara siz onay verin",
          body: "Düzenlemeleri farklarıyla görün. Komutlar onayınızı bekler.",
        },
        "make-it-yours": {
          title: "Size özel",
          body: "Varsayılan tema, tokyonight ve diğer temalar arasında tek tuşla geçiş yapın.",
        },
        mini: {
          title: "Mini",
          body: "opencode mini komutunu çalıştırdığınızda yanıtlar terminalinizin kaydırma geçmişine yazılır.",
        },
      },
    },
    sdk: {
      title: "OpenCode | Betikler, CI işleri ve araçlar için TypeScript SDK",
      description:
        "OpenCode'u kendi betiklerinizden, CI işlerinizden ve araçlarınızdan yönetin. Tipli TypeScript istemcisi oturum oluşturur, prompt gönderir ve her olayı anında aktarır.",
      intro:
        "OpenCode'u kendi betiklerinizden, CI işlerinizden ve araçlarınızdan yönetin. SDK, OpenCode'u yapılandırmanız ve modellerinizle aynı süreçte çalıştırır. Tipli istemcisi oturum oluşturur, prompt gönderir ve tüm olayları akış olarak iletir.",
      features: {
        "typescript-client": {
          title: "TypeScript istemcisi",
          body: "@opencode/client ile aynı değerlere sahip tipli istekler ve olaylar.",
        },
        "sessions-from-code": {
          title: "Koddan oturum başlatma",
          body: "Herhangi bir betikten oturum oluşturun ve prompt gönderin.",
        },
        "any-model": {
          title: "Her model",
          body: "OpenCode kurulumunuzdaki modelleri kullanır.",
        },
        "npm-or-bun": {
          title: "npm ya da Bun",
          body: "npm i @opencode/sdk ya da bun add @opencode/sdk ile kurun.",
        },
        "in-process-host": {
          title: "Süreç içi host",
          body: "OpenCode'u ağa çıkmadan bellekte çalıştırır.",
        },
        "your-plugins": {
          title: "Eklentileriniz",
          body: "Süreç içi host'u oluştururken kendi eklentilerinizi parametre olarak geçin.",
        },
        "promise-or-effect": {
          title: "Promise ya da Effect",
          body: "Aynı değerlerle bir Promise API'si ve bir Effect API'si.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "OpenCode'u Workers üzerinde bir Cloudflare Durable Object içinde çalıştırın.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "CI sorunlarını koddan düzeltin",
          body: "Kısa bir betik OpenCode'dan başarısız testleri düzeltmesini ister ve testleri yeniden çalıştırır.",
        },
        "follow-every-step": {
          title: "Her adımı izleyin",
          body: "Olay akışından agent'ın çağırdığı her aracı anında görün.",
        },
        "build-your-own-tools": {
          title: "Kendi araçlarınızı geliştirin",
          body: "OpenCode'u birkaç satırla botlara, panolara ve iş akışlarına bağlayın.",
        },
        "in-your-process": {
          title: "Kendi sürecinizde",
          body: "OpenCode'u kendi yapılandırmanız ve modellerinizle uygulamanızın sürecinde çalıştırır.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, agent için sade bir terminal arayüzü",
      description:
        "Mini, OpenCode'u sade bir terminal arayüzünde çalıştırır. Yanıtlar terminalin kendi kaydırma geçmişine yazılır. Altta yalnızca prompt ve durum satırı kalır.",
      intro:
        "OpenCode için sade bir terminal arayüzü. opencode mini komutunu çalıştırın. Yanıtlar doğrudan terminalin kaydırma geçmişine yazılır. Diğer çıktılarda olduğu gibi yanıtları kaydırarak inceleyebilir, içinde arama yapabilir ve kopyalayabilirsiniz. Altta yalnızca prompt ve durum satırı kalır.",
      features: {
        "your-scrollback": {
          title: "Kaydırma geçmişi",
          body: "Yanıtlar normal terminal çıktısı olarak kaydırma geçmişine eklenir.",
        },
        "one-prompt": {
          title: "Tek prompt",
          body: "Agent, model, bağlam ve maliyet tek durum satırında.",
        },
        permissions: {
          title: "İzinler",
          body: "Düzenlemelere ve komutlara giriş alanından izin verin.",
        },
        "how-much-shows": {
          title: "Görünüm ayarları",
          body: "Düşünme ve araç çıktıları için sessiz, varsayılan veya tümünü göster modunu seçin.",
        },
        "pick-up-later": {
          title: "Sonra devam et",
          body: "Son oturuma -c ile, dilediğiniz oturuma -s ile devam edin.",
        },
        "same-opencode": {
          title: "Aynı OpenCode",
          body: "Diğer uygulamalarla aynı sunucu, agent'lar ve modeller.",
        },
        agents: {
          title: "Agent'lar",
          body: "Giriş alanından doğrudan başka bir agent'a geçin.",
        },
        compact: {
          title: "Sıkıştır",
          body: "Uzun oturumları /compact ile sıkıştırın.",
        },
      },
    },
  },
  extensionCard: {
    name: "Eklentiler",
    body: "OpenCode'u VS Code'da ya da ACP ile Zed ve diğer editörlerde kullanın.",
    action: "Kur",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "Agent'lar gerçek tarayıcınızı kullansın.",
      title: "OpenCode | Browse, kodlama agent'ları için gerçek tarayıcınız",
      description:
        "Browse, OpenCode ve diğer MCP istemcilerinin gerçek tarayıcınızı kullanmasını sağlar. Agent'lar sayfaları okur, tıklar, yazı yazar, ekran görüntüsü alıp sekmeleri kaydeder. Oturum açma ve 2FA adımlarını size bırakır.",
      intro:
        "Agent'larınızın gerçek tarayıcınızı açık sekmeleriniz, oturumlarınız ve eklentilerinizle birlikte kullanmasını sağlayan bir MCP sunucusu ve Chromium eklentisi. Agent'lar sekmeleri arka planda gruplandırarak açar, böylece işiniz bölünmez. Sayfaları okur, tıklar, yazı yazar, ekran görüntüsü alıp sekmeleri kaydederler. Oturum açma, 2FA veya ödeme için sıra size geldiğinde sekmeyi size devrederler. Continue düğmesine tıkladığınızda kaldıkları yerden devam ederler.",
      features: {
        "your-real-browser": {
          title: "Gerçek tarayıcınız",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera ve Chromium.",
        },
        "out-of-your-way": {
          title: "İşinizi bölmez",
          body: "Agent sekmeleri arka planda, daraltılmış gruplar hâlinde açılır.",
        },
        handoffs: {
          title: "Sıra sizde",
          body: "Oturum açma veya 2FA adımını kendiniz tamamlayın, ardından Continue düğmesine tıklayın.",
        },
        "lend-a-tab": {
          title: "Sekme ver",
          body: "Açık sekmeyi agent'a devretmek için araç çubuğundaki düğmeye tıklayın.",
        },
        "record-and-capture": {
          title: "Kayıt ve ekran görüntüsü",
          body: "Ekran görüntüleri, sekme kayıtları ve ağ trafiği.",
        },
        "any-mcp-client": {
          title: "Her MCP istemcisi",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed ve çok daha fazlası.",
        },
        "all-your-logins": {
          title: "Açık oturumlarınız",
          body: "Agent'lar oturum açtığınız siteleri kullanır. Anahtar da kurulum da gerekmez.",
        },
        "allowed-sites": {
          title: "İzin verilen siteler",
          body: "Agent'ın sekmesinde açabileceği siteleri siz belirleyin.",
        },
      },
      install:
        "Önce [Chrome uzantısını] kurun. Kalan adımları uzantı gösterir. Normalde gerekmez ama CLI'yi doğrudan kurmak isterseniz bu yöntemlerden birini kullanın.",
    },
  },
  apps: {
    browse: {
      category: "Agent'lar için tarayıcı kontrolü",
      body: "Agent'ınız gerçek tarayıcınızı açık oturumlarınız ve sekmelerinizle birlikte kullansın.",
    },
    hex: {
      category: "Sesle dikte",
      body: "Her uygulamada, doğrudan cihazınızda sesle dikte.",
    },
    opentunnel: {
      category: "Yerel tüneller",
      body: "Yerel uygulamalar için herkese açık HTTPS URL'leri.",
    },
    opentui: {
      category: "Kitaplık",
      body: "Terminal kullanıcı arayüzleri için bir kitaplık.",
    },
  },
  getStarted: {
    title: "Başlayın",
    lead: "Başlamanın en kolay yolu OpenCode'u indirip ücretsiz modelleri kullanmak. Hesap gerekmez. Daha fazla model için kendi aboneliğinizi bağlayın veya OpenCode Go kullanın.",
    phrases: {
      "download-opencode": {
        text: "OpenCode'u indirip",
      },
      "free-models": {
        text: "ücretsiz modelleri",
      },
      "your-own-subscription": {
        text: "kendi aboneliğinizi",
      },
      "a-subscription-you-already-have": {
        text: "zaten sahip olduğunuz bir abonelik",
      },
      "opencode-go": {
        text: "OpenCode Go",
      },
    },
    subscriptions: {
      "chatgpt-plus-pro": {
        name: "ChatGPT Plus/Pro",
      },
      "github-copilot": {
        name: "GitHub Copilot",
      },
    },
    plans: {
      "opencode-go": {
        name: "OpenCode Go",
      },
      "opencode-go-plus": {
        name: "OpenCode Go Plus",
      },
    },
    steps: {
      download: {
        title: "İndir",
        line: "Masaüstü, terminal ya da mobil.",
      },
      "use-free-models": {
        title: "Ücretsiz modelleri kullan",
        line: "OpenCode bir dizi ücretsiz modelle gelir. Hesap gerekmez.",
      },
      "add-more-models": {
        title: "Daha fazla model ekle",
        line: "Kendi aboneliğinizi bağlayın veya ayda 10 $'dan başlayan OpenCode Go ile özenle seçilmiş modelleri kullanın.",
      },
    },
    sentence:
      "OpenCode'u indirin ve ücretsiz modellerle başlayın. Daha fazla model istediğinizde kendi aboneliğinizi veya OpenCode Go'yu kullanın.",
  },
  byos: {
    title: "Kendi aboneliğinizi bağlayın",
    headline: "Mevcut aboneliklerinizi kullanın.",
    line: "ChatGPT Plus or Pro veya GitHub Copilot hesabınızla oturum açın. Dilerseniz OpenCode aboneliği kullanın.",
    yours: {
      label: "Aboneliğiniz",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
        "github-copilot": {
          name: "GitHub Copilot",
        },
      },
    },
    planLinks: ["OpenCode aboneliği", "OpenCode Go"],
    ours: {
      label: "OpenCode planları",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Agent için kurallar",
        copied: "Kurallar kopyalandı",
      },
    },
    naming: {
      title: "Adlandırma",
      body: "OpenCode'u büyük O ve büyük C ile tek kelime olarak yazın. Opencode, Open Code, OpenCode AI ya da Open-Code yazmayın.",
      code: "Küçük harfli `opencode` adını yalnızca kodda ve `opencode-figma` ya da `@acme/opencode-plugin` gibi paket adlarında kullanın.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Uygulama simgeleri, avatarlar ve diğer küçük alanlar için tek başına logo. Kare sürümlerde, kare biçiminde kırpan platformlar için kenar boşluğu vardır.",
        assets: {
          light: {
            name: "Açık",
          },
          dark: {
            name: "Koyu",
          },
          "square-light": {
            name: "Kare, açık",
          },
          "square-dark": {
            name: "Kare, koyu",
          },
        },
      },
      wordmark: {
        title: "Yazı logosu",
        body: "OpenCode'un kendine özgü harfleriyle yazılan tam ad. Adın tamamına yer olan her yerde kullanın.",
        assets: {
          light: {
            name: "Açık",
          },
          dark: {
            name: "Koyu",
          },
        },
      },
      "simple-wordmark": {
        title: "Sade yazı logosu",
        body: "Yazı logosunun tek renkli sürümü. Baskı, nakış ve yalnızca tek renge izin veren yerler için.",
        assets: {
          light: {
            name: "Açık",
          },
          dark: {
            name: "Koyu",
          },
        },
      },
    },
    icons: {
      title: "Avatarlar",
      body: "Slack, Discord, GitHub ve diğer profiller için 1024 px boyutunda kare avatarlar. Arka plan karenin tamamını doldurur. Logo, yuvarlak kırpmada da kesilmemesi için dairenin içinde kalır.",
      items: {
        dark: {
          name: "Koyu",
        },
        light: {
          name: "Açık",
        },
      },
    },
    colors: {
      title: "Renkler",
      body: "Logo ve yazı logosu tek bir mürekkep rengini üç opaklık düzeyinde kullanır. Koyu arka planlar için daha açık bir mürekkep rengi vardır. Aşağıda standart dosyalardaki renkler yer alıyor. Bunları yalnızca logo ve yazı logosunda kullanın, başka metinlere veya arka planlara uygulamayın. Kopyalamak için değere tıklayın.",
      palettes: {
        light: {
          name: "Açık",
          swatches: {
            ink: {
              name: "Mürekkep",
              use: "Logonun dış hattı ve “code” harfleri.",
            },
            "ink-70": {
              name: "Mürekkep %70",
              use: "“open” harfleri.",
              ink: "%70 opaklıkta mürekkep.",
            },
            "ink-20": {
              name: "Mürekkep %20",
              use: "Logonun iç tonu.",
              ink: "%20 opaklıkta mürekkep.",
            },
          },
        },
        dark: {
          name: "Koyu",
          swatches: {
            ink: {
              name: "Mürekkep",
              use: "Logonun dış hattı ve “code” harfleri.",
            },
            "ink-72": {
              name: "Mürekkep %72",
              use: "“open” harfleri.",
              ink: "%72 opaklıkta mürekkep.",
            },
            "ink-28": {
              name: "Mürekkep %28",
              use: "Logonun iç tonu.",
              ink: "%28 opaklıkta mürekkep.",
            },
          },
        },
      },
    },
    variants: {
      title: "Varyantlar",
      body: "Logonun net görünmesi için açık zeminde koyu, koyu zeminde açık sürümü seçin. Logo ve yazı logosu ayrı dosyalardır. Yalnızca birini kullanın.",
      groups: {
        default: {
          name: "Varsayılan",
          body: "Çoğu yerde bu logoyu kullanın. İç tonu saydamdır. Beyaz veya siyah zeminde iki tonlu gri logo gibi görünür. Fotoğraflarda, gradyanlarda ve renkli zeminlerde ise arka plan logonun içinden görünür.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Koyu",
                },
                light: {
                  name: "Açık",
                },
              },
            },
            wordmark: {
              title: "Yazı logosu",
              tiles: {
                dark: {
                  name: "Koyu",
                },
                light: {
                  name: "Açık",
                },
              },
            },
          },
        },
        simple: {
          name: "Sade",
          body: "Tek renklidir. Harflerin içi boştur, logonun iç tonu yoktur. Düz renkli zeminlerde, tek renkli baskıda ve gri tonları kullanamadığınız her yerde bu sürümü kullanın. Açık zeminde sade koyu sürümü, koyu zeminde sade açık sürümü seçin.",
          rows: {
            wordmark: {
              title: "Yazı logosu",
              tiles: {
                dark: {
                  name: "Koyu",
                },
                light: {
                  name: "Açık",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Kullanım",
      body: "Açık arka planlarda açık sürümleri, koyu arka planlarda koyu sürümleri kullanın. Logo ve yazı logosu ayrıdır. İkisinden birini kullanın, ikisini birlikte değil.",
      stroke: {
        title: "Bir çizgi",
        body: "Bu sayfadaki boşluk kuralları çizgi cinsinden ölçülür. Bir çizgi, logonun dış hattının kalınlığıdır, yani genişliğinin dörtte biri. Böylece logo 4 çizgi genişliğinde ve 5 çizgi yüksekliğindedir.",
      },
      clearSpace: {
        title: "Boş alan",
        body: "Logonun ve yazı logosunun her yanında en az iki çizgi boşluk bırakın. Logoda bir çizgi dış hattın kalınlığıdır, genişliğin dörtte biri. Yazı logosunda harflerin kalınlığıdır, yüksekliğin yedide biri.",
      },
      pixels: {
        title: "Tam pikseller",
        body: "Logonun oranı 4:5'tir. Bir çizgi, logo genişliğinin dörtte biridir. Kenarların ve çizgilerin piksel sınırlarına denk gelmesi için logoyu 4 × 5px'in katlarıyla ölçekleyin.",
        do: "Her kenarı ve 4px'lik çizgiyi piksel sınırlarına hizalayın.",
        dont: "4:5 oranını bozmayın. Kenarlar piksel aralarına denk gelirse bulanıklaşır.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Yazı logosu",
          },
        },
      },
      minimumTitle: "En küçük boyutlar",
      minimum: {
        logo: {
          title: "Logo",
          body: "En az 16 × 20px, 4px çizgiyle. Daha küçüğü bulanıklaşır.",
        },
        wordmark: {
          title: "Yazı logosu",
          body: "En az 117 × 21px, 3px çizgiyle. Daha küçüğü bulanıklaşır.",
        },
      },
    },
    donts: {
      title: "Yapmayın",
      body: "Logoyu ve yazı logosunu kullanırken kaçınılması gereken yaygın hatalar.",
      examples: {
        "two-tone": {
          caption: "logoyu yeni renklere boyamak.",
        },
        bright: {
          caption: "tek bir parlak renk kullanmak.",
        },
        gradient: {
          caption: "logoyu gradyanla doldurmak.",
        },
        inverted: {
          caption: "tonların yerini değiştirmek.",
        },
        stretch: {
          caption: "logonun en-boy oranını bozmak.",
        },
        shadow: {
          caption: "gölge eklemek.",
        },
        glow: {
          caption: "parlama ya da dış hat eklemek.",
        },
        lockup: {
          caption: "logonun yanına başka kelimeler koymak.",
        },
        "low-contrast": {
          caption: "düşük kontrastlı gri üstüne gri kullanmak.",
        },
        color: {
          caption: "iki tonlu gri logoyu renkli zemine yerleştirmek. Gri tonlar bu zeminde donuk görünür.",
        },
      },
    },
    integrations: {
      title: "Entegrasyonlar",
      body: "OpenCode ile uyumlu eklentiler, sağlayıcılar ve araçlar ya da OpenCode ile geliştirilen projeler bu bağı gösterebilir. Bir rozet veya ortak logo kullanın ve proje adında projenin size ait olduğunu açıkça belirtin.",
      badges: {
        body: "README'nize, dokümanlarınıza ya da sitenize bir rozet koyun ve opencode.ai'ye bağlayın. Arka planınıza göre açık ya da koyu dosyayı seçin (HTML kendiliğinden geçiş yapar) ve renkleri ya da metni değiştirmeyin.",
        sizes: "Her stil 20, 32 ve 44px boyutlarında (Shields yalnızca 20px), SVG ve 2× PNG olarak gelir.",
        mono: "Her dosyanın metni OpenMono ile yazılmış bir sürümü de var. Dosya uzantısından önce -mono ekleyin (örneğin opencode-works-with-a-light-20-mono.svg). OpenMono metnin tamamı büyük harf olsun istiyorsanız -mono-caps ekleyin.",
        groups: {
          "works-with": {
            title: "Uyumlu",
            alt: "OpenCode ile uyumlu",
            body: "OpenCode ile çalışan eklentiler, sağlayıcılar ve araçlar için.",
          },
          "built-with": {
            title: "Geliştirildi",
            alt: "OpenCode ile geliştirildi",
            body: "OpenCode ile geliştirilen projeler için.",
          },
        },
        styles: {
          a: {
            name: "Çerçeve",
          },
          c: {
            name: "Hücreler",
          },
          f: {
            name: "Dolu",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Ortak logo",
        body: "OpenCode ile iş ortağının logosunu, aralarına × işareti koyarak yan yana yerleştirin. İşaretin her iki tarafında 3 çizgi boşluk bırakın. İş ortağının logosunu OpenCode logosuyla aynı yükseklikte görünecek şekilde boyutlandırın ve tüm düzenin çevresinde boşluk bırakın.",
        partners: {
          github: {
            name: "GitHub",
          },
        },
      },
      naming: {
        title: "Projenizi adlandırma",
        body: "Projenin size ait olduğu anlaşılsın diye kendi adınızla başlayın.",
        rule: "`Linear for OpenCode` yazın ya da paketi `opencode-linear` olarak adlandırın. `OpenCode Linear` ya da `Linear by OpenCode` yazmayın.",
      },
    },
    trademarks: {
      title: "Markalar",
      body: "OpenCode ve OpenCode logosu Anomaly'nin ticari markalarıdır. Bunları Anomaly'nin sizi desteklediğini ya da sponsorluğunu yaptığını ima edecek şekilde, ürün ya da şirket adınızda ya da izinsiz ürünlerde kullanmayın.",
      contact: {
        before: "Sorularınız için ",
        after: " adresine yazın.",
      },
    },
  },
  press: {
    title: "OpenCode | Şirket bilgileri ve marka dosyalarıyla basın kiti",
    description:
      "OpenCode basın kiti. OpenCode ve onu geliştiren şirket Anomaly hakkında bilgiler, indirilebilir logolar ve yazı logoları, basın soruları için bir iletişim adresi.",
    hero: {
      title: "Basın",
      body: "OpenCode ve Anomaly hakkında yazacaklar için bilgiler, marka dosyaları ve iletişim adresleri.",
    },
    company: {
      title: "Anomaly hakkında",
      lead: "Anomaly, OpenCode'un arkasındaki şirkettir. Geliştiriciler için açık kaynaklı araçlar geliştirir.",
      more: "SST ve OpenTUI da Anomaly'nin projelerinden. Hepsi [GitHub](github) üzerinde açık kaynaklı.",
      learnMore: "Daha fazlası için [anoma.ly](site) adresine gidin.",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "Masaüstü, terminal ve mobil uygulamaları ile SDK'sı olan açık kaynaklı kodlama agent'ı. MIT lisanslı, GitHub'da 220.000'den fazla yıldızı var.",
        },
        sst: {
          name: "SST",
          body: "Kendi altyapınızda full-stack uygulamalar geliştirmek için bir framework. MIT lisanslı, 2020'den beri açık kaynaklı. GitHub'da 26.000'den fazla yıldızı var.",
        },
        opentui: {
          name: "OpenTUI",
          body: "TypeScript, React veya Solid ile terminal arayüzleri geliştirmek için, çekirdeği Zig ile yazılmış bir kitaplık. OpenCode bu kitaplığı üretimde kullanır. GitHub'da 13.000'den fazla yıldızı var.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "AI model özellikleri, fiyatları ve yetenekleri için herkese açık API'si olan açık kaynak bir veritabanı. 200'den fazla sağlayıcıdan 8.900'den fazla model listeler.",
        },
        hex: {
          name: "Hex",
          body: "Mac, Windows ve Linux için sesle dikte. Hex söylediklerinizi cihazınızda yazıya döker ve dilediğiniz uygulamaya yapıştırır. Ses cihazınızdan çıkmaz.",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "Makinenizdeki uygulamalara herkese açık bir HTTPS URL'si veren bir CLI ve SDK. TLS makinenizde sonlanır, böylece aktarıcı düz metni hiç görmez.",
        },
      },
    },
    about: {
      title: "OpenCode hakkında",
      body: "OpenCode ve ürünleri için uzun ve kısa sürümlerde, kopyalanmaya hazır tanıtım metinleri.",
      boilerplate: {
        long: "OpenCode açık kaynaklı bir kodlama agent'ıdır. Masaüstü uygulaması, terminal arayüzü, mobil uygulama ve SDK olarak kullanılabilir. Claude, GPT ve Gemini dahil, tüm sağlayıcıların modelleriyle çalışır. Anomaly'nin geliştirdiği OpenCode, MIT lisanslıdır. GitHub'da 220.000'den fazla yıldızı ve 1.000'den fazla katkı sağlayanı var. Her ay 22 milyondan fazla geliştirici OpenCode kullanıyor.",
        short:
          "OpenCode, Anomaly'nin geliştirdiği açık kaynaklı kodlama agent'ıdır. Masaüstü, terminal ve mobil uygulamaları ile bir SDK'sı vardır.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console, geliştiricilerin ve ekiplerin OpenCode ve diğer kodlama agent'ları için AI modellerine erişim satın alıp bu erişimi yönettiği web uygulamasıdır. En gelişmiş modeller ve açık ağırlıklı modeller için istek ücretini ön ödemeli krediden düşen bir kullandıkça öde inference hizmeti ve OpenCode Go abonelikleri sunar. Ekipler çalışma alanlarında Member, Admin ve Owner rollerini, çalışma alanı ve kullanıcı bazında harcama limitlerini, Okta, Microsoft Entra ID veya Google Workspace ile tek oturum açmayı ve SCIM'i kullanabilir. Console 30'dan fazla sağlayıcıyı destekler. Ekipler mevcut sağlayıcı hesaplarını bağlayabilir, Console'un inference hizmetini kullanmak zorunda değildir. Adresi opencode.ai/console.",
          short:
            "OpenCode Console, Anomaly'nin kullandıkça öde AI model erişimi, OpenCode Go abonelikleri ve bütçe ile tek oturum açma gibi ekip denetimleri sunan web uygulamasıdır.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go, kodlama modellerini sabit aylık ücretle kullanmak isteyen geliştiricilere yönelik bir aboneliktir. Go aylık 10 $, daha yüksek limitli Go Plus aylık 40 $, Go Teams ise üye başına aylık 20 $. Her plan agent ile kodlama için test edilmiş, özenle seçilmiş modeller içerir. Her modelin aylık kullanım limiti dolar cinsinden belirlenir. Kayan 5 saatlik ve haftalık dönemlerde aylık limitin sırasıyla %20'si ve %50'si kullanılabilir. Aboneler kredi yükleyebilir, limitlerine ulaştıklarında kullandıkça öde bakiyelerine geçebilir ve aboneliklerini istedikleri zaman iptal edebilir. Go, OpenCode ve diğer agent'larla çalışır. Adresi opencode.ai/console/go.",
          short:
            "OpenCode Go, Anomaly'nin geliştiricilere seçkin kodlama modellerinde aylık kullanım limitleri veren, aylık 10 $'dan başlayan aboneliğidir.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data, geliştiricilerin OpenCode'da hangi AI modellerini kullandığını ve bu dağılımın zamanla nasıl değiştiğini gösteren herkese açık bir panodur. En çok kullanılan modellerin sıralamasını, token kullanımını, oturum ve token maliyetlerini, önbellek oranlarını, pazar payını ve ülkelere göre dağılımı yayımlar. Rakamlar saatte bir toplanır, günler ve haftalar UTC'ye göredir. Kullanıcı ve oturum sayıları yaklaşıktır, maliyetler OpenCode model kataloğundaki liste fiyatlarını kullanır. Gazeteciler, sayfada gösterilen güncelleme saatiyle birlikte OpenCode Data (opencode.ai/data) olarak kaynak gösterebilir.",
          short:
            "OpenCode Data, opencode.ai/data adresinde AI modellerini OpenCode'daki gerçek kullanıma göre sıralayan, token, maliyet ve pazar payını saatlik güncelleyen herkese açık bir panodur.",
        },
      },
    },
    facts: {
      title: "Kısaca",
      items: {
        license: {
          label: "Lisans",
        },
        "first-release": {
          label: "İlk sürüm",
        },
        "made-by": {
          label: "Yapımcı",
        },
      },
    },
    milestones: {
      title: "Tarihçe",
      items: {
        "first-release-v0-0-1": {
          date: "Nis 2025",
          text: "İlk sürüm, v0.0.1",
        },
        "1-million-downloads": {
          date: "Eki 2025",
          text: "1 milyon+ indirme",
        },
        "opencode-1-0": {
          date: "Eki 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Ara 2025",
          text: "Desktop çıktı",
        },
        "10-million-downloads": {
          date: "Oca 2026",
          text: "10 milyon+ indirme",
        },
        "opencode-2-0": {
          date: "Eyl 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Kas 2026",
          text: "220.000+ GitHub yıldızı",
        },
      },
    },
    news: {
      title: "Son sürümler",
      intro: "OpenCode sık sık güncellenir. Yeni özellikler getiren son sürümler burada.",
      changelog: {
        text: "Tüm sürüm notları",
      },
      feed: {
        text: "RSS akışı",
      },
    },
    media: {
      title: "Medya",
      intro:
        "Uygulamalardan alınan ekran görüntülerini ve kısa videoları OpenCode hakkında yazarken kullanabilirsiniz.",
      note: "Tüm kayıtlar koyu temayı kullanır. Görseller ve kapaklar en fazla 1920 × 1080, dikeyde 1080 × 1350 boyutunda JPG'lerdir. Videolar sessiz MP4 kliplerdir.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Desktop filmi",
            },
            "frame-1": {
              title: "Desktop görseli 1",
            },
            "frame-2": {
              title: "Desktop görseli 2",
            },
            "frame-3": {
              title: "Desktop görseli 3",
            },
            "frame-4": {
              title: "Desktop görseli 4",
            },
            "feature-1": {
              title: "Paralel agent'lar",
            },
            "feature-2": {
              title: "Tarayıcıda gör",
            },
            "feature-3": {
              title: "Her cihazda",
            },
            "locked-portrait": {
              title: "Desktop filmi, dikey",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Mobile filmi",
            },
            "frame-1": {
              title: "Mobile görseli 1",
            },
            "frame-2": {
              title: "Mobile görseli 2",
            },
            "frame-3": {
              title: "Mobile görseli 3",
            },
            "feature-1": {
              title: "Ses",
            },
            "feature-2": {
              title: "Oturumlar",
            },
            "feature-3": {
              title: "Sonuçlar",
            },
            "locked-portrait": {
              title: "Mobile filmi, dikey",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Terminal filmi",
            },
            "frame-1": {
              title: "Terminal görseli 1",
            },
            "frame-2": {
              title: "Terminal görseli 2",
            },
            "frame-3": {
              title: "Terminal görseli 3",
            },
            "frame-4": {
              title: "Terminal görseli 4",
            },
            "feature-1": {
              title: "Sade bir dille anlatın",
            },
            "feature-2": {
              title: "Komutlara siz onay verin",
            },
            "feature-3": {
              title: "Size özel",
            },
            "locked-portrait": {
              title: "Terminal filmi, dikey",
            },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": {
              title: "SDK filmi",
            },
            "frame-1": {
              title: "SDK görseli 1",
            },
            "frame-2": {
              title: "SDK görseli 2",
            },
            "frame-3": {
              title: "SDK görseli 3",
            },
            "frame-4": {
              title: "SDK görseli 4",
            },
            "feature-1": {
              title: "CI sorunlarını koddan düzeltin",
            },
            "feature-2": {
              title: "Her adımı izleyin",
            },
            "feature-3": {
              title: "Kendi araçlarınızı geliştirin",
            },
            "locked-portrait": {
              title: "SDK filmi, dikey",
            },
          },
        },
      },
    },
    people: {
      title: "Ekip",
    },
    anomalyLogo: {
      title: "Anomaly logosu",
      body: "Siyah ve beyaz renkte Anomaly amblemi ve yazı logosu. PNG'ler 2048 px genişliğindedir.",
      assets: {
        "mark-black": {
          name: "Amblem, siyah",
        },
        "mark-white": {
          name: "Amblem, beyaz",
        },
        "wordmark-black": {
          name: "Yazı logosu, siyah",
        },
        "wordmark-white": {
          name: "Yazı logosu, beyaz",
        },
      },
      avatars: {
        body: "X, GitHub, Slack, LinkedIn ve diğer profiller için kare avatarlar. Amblem dairenin epey içinde durur, böylece yuvarlak kırpmada da bozulmaz. PNG'ler 1024 ve 400 px genişliğindedir.",
        items: {
          "avatar-dark": { name: "Avatar, koyu" },
          "avatar-light": { name: "Avatar, açık" },
        },
      },
      all: {
        text: "Tümünü indir",
      },
    },
    coverage: {
      title: "Basında",
    },
    brand: {
      title: "Marka",
      before:
        "OpenCode logolarını ve yazı logolarını tek bir ZIP dosyasında indirin. Tek tek dosyalar, varyantlar ve kullanım kuralları için ",
      link: {
        text: "Marka",
      },
      after: " sayfasına gidin.",
      usage:
        "Bu dosyaları OpenCode hakkında yazmak için kullanabilirsiniz. Onları değiştirmeyin ve OpenCode'un çalışmanızı desteklediğini ima etmeyin.",
    },
    product: {
      title: "Ürün",
      items: {
        desktop: {
          name: "Desktop",
          body: "macOS, Windows ve Linux'ta birden fazla agent'ı ayrı sekmelerde aynı anda çalıştırın. Değişiklik farklarını inceleyip sonuçları önizleyin.",
        },
        mobile: {
          name: "Mobile",
          body: "En yeni OpenCode uygulaması. Oturumu arayıp agent'la konuşun. Nerede olursanız olun, yaptığı değişiklikleri telefonunuzdan inceleyip onaylayın.",
        },
        terminal: {
          name: "Terminal",
          body: "Her kabukta, editörde veya uzak sunucuda çalışan bir terminal arayüzü. Değişiklik farklarını görün ve hangi komutların otomatik çalışacağını seçin.",
        },
        sdk: {
          name: "SDK",
          body: "Betikler, CI işleri ve kendi araçlarınız için tipli bir TypeScript istemcisi. Oturum oluşturun, prompt gönderin ve olayları gerçekleştiği anda akış olarak alın.",
        },
      },
    },
    contact: {
      title: "İletişim",
      items: {
        press: {
          title: "Basın",
          body: "Gazeteciler ve analistler için. Yalnızca medya taleplerine yanıt veriyoruz.",
        },
        support: {
          title: "Destek",
          body: "OpenCode ile ilgili yardım için issue açın veya topluluğa danışın. Hesap ve faturalandırma soruları için bize e-posta gönderin.",
          links: {
            "github-issues": {
              text: "GitHub issue'ları",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Güvenlik",
          body: "Bir güvenlik açığını GitHub üzerinden bildirin. 6 iş günü içinde yanıt gelmezse bize e-posta gönderin.",
          links: {
            "report-a-vulnerability": {
              text: "Güvenlik açığı bildir",
            },
            "security-anoma-ly": {
              text: "security@anoma.ly",
            },
          },
        },
      },
    },
  },
  download: {
    desktop: {
      title: "Desktop",
    },
    mobile: {
      title: "Mobile",
      stores: {
        "google-play": {
          label: "Google Play",
          device: "Android",
        },
      },
    },
    terminal: {
      title: "Terminal",
      installs: {
        curl: {
          name: "Betik",
        },
      },
    },
    extensions: {
      title: "Eklentiler",
      items: {
        "vs-code": {
          label: "VS Code",
        },
        cursor: {
          label: "Cursor",
        },
        zed: {
          label: "Zed",
        },
        windsurf: {
          label: "Windsurf",
        },
        vscodium: {
          label: "VSCodium",
        },
      },
    },
    faq: {
      items: {},
    },
  },
  productDownloads: {
    sdk: {
      more: {
        label: "SDK belgelerini okuyun",
      },
    },
    mini: {
      lead: "Mini, OpenCode CLI ile gelir. Bunlardan biriyle kurun, sonra opencode mini çalıştırın.",
      commands: {
        curl: {
          name: "Betik",
        },
      },
    },
    terminal: {
      commands: {
        curl: {
          name: "Betik",
        },
      },
    },
  },
  pair: {
    title: "Telefonunuzu bağlayın",
    cardTitle: "Telefonunuzu tek komutla eşleyin",
    intro:
      "OpenCode Mobile ile bilgisayarınızdaki OpenCode'u uzaktan yönetin. Oturumlar bilgisayarınızda çalışmaya devam eder. Uygulamadan oturumları görüp yönlendirebilirsiniz.",
    steps: {
      "get-the-app": {
        title: "Uygulamayı edinin",
        body: "OpenCode'u iPhone'unuza App Store'dan veya Android telefonunuza Google Play'den yükleyin.",
      },
      "run-this-on-your-computer": {
        title: "Bunu bilgisayarda çalıştırın",
        body: "Komut, tek kullanımlık bir bağlantı ve QR kodu verir. İkisi de 5 dakika sonra geçerliliğini yitirir.",
      },
      "scan-the-code": {
        title: "Kodu okutun",
        body: "QR kodunu uygulamayla okutun ya da bağlantıyı yapıştırın. Bilgisayarınızın son oturumları telefonunuzda açılır.",
      },
    },
    note: "--remote, OpenTunnel adresi üzerinden bağlandığı için eşleme her ağda çalışır. Aynı Wi-Fi ağındaysanız önce bir kez opencode service set hostname 0.0.0.0, ardından opencode pair komutunu çalıştırın.",
    facts: [
      "--remote, OpenTunnel adresi üzerinden bağlandığı için eşleme her ağda çalışır.",
      "Bağlantı ve kod tek kullanımlıktır. İkisi de 5 dakika sonra geçerliliğini yitirir.",
      "Bilgisayarı açık tutun. Agent telefonda değil, bilgisayarınızda çalışır.",
      "Aynı Wi-Fi ağındaysanız önce bir kez opencode service set hostname 0.0.0.0, ardından opencode pair komutunu çalıştırın.",
    ],
  },
} satisfies ContentOverlay
