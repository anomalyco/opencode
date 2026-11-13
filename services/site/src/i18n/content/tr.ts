import type { ContentOverlay } from "./source"

export const content = {
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Masaüstü eklentileri oluşturun, kurun ve paylaşın.",
      link: "2.2'deki yenilikler",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Masaüstü terminalleri artık yeniden başlatmalarda kapanmıyor.",
      link: "v2.2.4'e bakın",
    },
    "agents-can-now-generate-images": {
      text: "Ajanlar artık görsel üretebiliyor.",
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
      body: "macOS, Windows ve Linux'ta oturumlar, sekmeler, diff'ler, yerleşik tarayıcı ve eklentiler.",
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
      action: "Dokümanlar",
    },
    mini: {
      name: "Mini",
      body: "Minimal bir terminal arayüzü. Yanıtlar kaydırma geçmişinize yazılır, altta tek bir prompt kalır.",
      action: "Kur",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | macOS, Windows ve Linux için masaüstü uygulaması",
      description:
        "İstediğiniz kadar OpenCode ajanını paralel çalıştırın, her değişikliği yanlarındaki tarayıcıda görün ve her cihazdan devam edin. macOS, Windows ve Linux için.",
      intro:
        "Birden fazla ajanı aynı anda, her oturumu kendi sekmesinde çalıştırın. Her değişikliği diff olarak inceleyin, istediğiniz satıra yorum yapın ve sonucu yerleşik tarayıcıda kontrol edin. macOS, Windows ve Linux için.",
      showcase: {
        "parallel-agents": {
          title: "Paralel ajanlar",
          body: "İstediğiniz kadar ajan başlatın ve hepsinin paralel çalışmasına izin verin. Bitirdikçe aralarında geçiş yapın.",
        },
        "see-it-in-the-browser": {
          title: "Tarayıcıda gör",
          body: "Uygulamanız ajanın yanında bir tarayıcıda açılır, böylece ikiniz de her değişikliği anında görürsünüz.",
        },
        "on-every-device": {
          title: "Her cihazda",
          body: "Tüm cihazlarınızda ajan başlatın ve masaüstü uygulamasından, terminalden ya da telefonunuzdan devam edin.",
        },
        "extend-it": {
          title: "Genişletin",
          body: "Araçlarınızı ve hizmetlerinizi bağlayın, ajan her şeyle çalışabilsin. Ya da OpenCode'un kendisi için kenar çubuğunda kendi arayüzü olan eklentiler yapmasını sağlayın.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, kodlama oturumlarınız telefonunuzda",
      description:
        "OpenCode oturumlarını telefonunuzdan başlatın ve yönetin. Ajan bilgisayarınızda çalışırken onunla konuşun.",
      intro:
        "Nerede olursanız olun oturumları telefonunuzdan başlatın ve yönetin. Bir oturumu arayıp ajanla konuşun ya da bir oturum açıp kaldığınız yerden devam edin, hepsi kendi bilgisayarınızdaki OpenCode üzerinde.",
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
          body: "Ajan çalışırken zaman çizelgesinin güncellenmesini izleyin.",
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
          body: "Oturumu arayın, ne istediğinizi söyleyin. Ajan sesli yanıt verir.",
        },
        sessions: {
          title: "Oturumlar",
          body: "Herhangi bir oturumu açıp durumunu görün ve kaldığınız yerden devam edin.",
        },
        steer: {
          title: "Yönet",
          body: "Oturumun ortasında yön değiştirmek için yeni bir mesaj gönderin.",
        },
        results: {
          title: "Sonuçlar",
          body: "İstediğiniz iş bitince arama size neyin değiştiğini anlatır.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Açık kaynaklı kodlama ajanı için terminal arayüzü",
      description:
        "OpenCode için her kabukta, editörde ya da uzak sunucuda çalışan hızlı bir terminal arayüzü. Ne istediğinizi anlatın, her düzenlemeyi diff olarak görün ve komutları onaylayın.",
      intro:
        "Her kabukta, editörde ya da uzak sunucuda çalışan hızlı bir terminal arayüzü. Ne istediğinizi sade bir dille anlatın, her düzenlemenin diff olarak gelişini izleyin ve hangi komutların kendiliğinden çalışacağını seçin.",
      features: {
        "any-terminal": {
          title: "Her terminal",
          body: "Her kabukta, editörünüzün terminalinde ya da uzak sunucuda çalışır.",
        },
        "diffs-in-the-timeline": {
          title: "Akışta diff'ler",
          body: "Ajan düzenleme yaptıkça her birini zaman çizelgesinde diff olarak görün.",
        },
        "pick-up-later": {
          title: "Sonra devam et",
          body: "Son oturuma -c ile, herhangi birine -s ile devam edin.",
        },
        "one-off-runs": {
          title: "Tek seferlik",
          body: "opencode run tek bir mesaj gönderir ve yanıtı yazdırır.",
        },
        "agents-and-commands": {
          title: "Ajan ve komutlar",
          body: "shift+tab ile ajan değiştirin, ctrl+p ile tüm komutları açın.",
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
          title: "İstatistikler",
          body: "opencode stats paylaşılabilir kullanım istatistikleri gösterir.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Sade bir dille sor",
          body: "Ne istediğinizi yazın, ajan çalışırken planını gösterir.",
        },
        "approve-what-runs": {
          title: "Çalışanı onayla",
          body: "Düzenlemeler diff olarak görünür, komutlar izninizi bekler.",
        },
        "make-it-yours": {
          title: "Size özel",
          body: "Tek tuşla tema değiştirin, varsayılandan tokyonight'a ve daha fazlasına.",
        },
        mini: {
          title: "Mini",
          body: "opencode mini'yi çalıştırın, yanıtlar kaydırma geçmişinize yazılır.",
        },
      },
    },
    sdk: {
      title: "OpenCode | Betikler, CI işleri ve araçlar için TypeScript SDK",
      description:
        "OpenCode'u kendi betiklerinizden, CI işlerinizden ve araçlarınızdan yönetin. Tipli TypeScript istemcisi oturum oluşturur, prompt gönderir ve her olayı anında aktarır.",
      intro:
        "OpenCode'u kendi betiklerinizden, CI işlerinizden ve araçlarınızdan yönetin. SDK, OpenCode'u kendi yapılandırmanız ve modellerinizle sürecinizin içinde çalıştırır. Tipli istemcisi oturum oluşturur, prompt gönderir ve her olayı aktarır.",
      features: {
        "typescript-client": {
          title: "TypeScript istemcisi",
          body: "@opencode/client ile aynı değerlere sahip tipli istekler ve olaylar.",
        },
        "sessions-from-code": {
          title: "Koddan oturumlar",
          body: "Herhangi bir betikten oturum oluşturun ve prompt gönderin.",
        },
        "any-model": {
          title: "Her model",
          body: "OpenCode kurulumunuzdaki modelleri kullanır.",
        },
        "npm-or-bun": {
          title: "npm ya da bun",
          body: "npm i @opencode/sdk ya da bun add @opencode/sdk ile kurun.",
        },
        "in-process-host": {
          title: "Süreç içi host",
          body: "OpenCode'u ağ adımı olmadan bellekte çalıştırır.",
        },
        "your-plugins": {
          title: "Eklentileriniz",
          body: "Süreç içi host'u oluştururken kendi eklentilerinizi verin.",
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
          title: "CI'ı koddan düzelt",
          body: "Kısa bir betik OpenCode'dan başarısız testleri düzeltmesini ister ve testleri yeniden çalıştırır.",
        },
        "follow-every-step": {
          title: "Her adımı izle",
          body: "Ajanın çağırdığı her aracı anında görmek için olayları aktarın.",
        },
        "build-your-own-tools": {
          title: "Kendi araçların",
          body: "OpenCode'u birkaç satırla botlara, panolara ve iş akışlarına bağlayın.",
        },
        "in-your-process": {
          title: "Kendi sürecinizde",
          body: "OpenCode'u kendi yapılandırmanız ve modellerinizle sürecinizin içinde çalıştırır.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, ajan için minimal bir terminal arayüzü",
      description:
        "Mini, OpenCode'u minimal bir terminal arayüzünde çalıştırır. Yanıtlar terminalin kendi kaydırma geçmişine yazılır, altta yalnızca bir prompt ve bir durum satırı kalır.",
      intro:
        "OpenCode için minimal bir terminal arayüzü. opencode mini'yi çalıştırın, yanıtlar doğrudan terminalinizin kaydırma geçmişine yazılsın. Onları diğer çıktılar gibi kaydırır, arar ve kopyalarsınız. Altta yalnızca prompt ve bir durum satırı kalır.",
      features: {
        "your-scrollback": {
          title: "Kaydırma geçmişi",
          body: "Yanıtlar sıradan terminal geçmişine dönüşür.",
        },
        "one-prompt": {
          title: "Tek prompt",
          body: "Ajan, model, bağlam ve maliyet tek bir durum satırında.",
        },
        permissions: {
          title: "İzinler",
          body: "Düzenlemelere ve komutlara prompt alanından izin verin.",
        },
        "how-much-shows": {
          title: "Ne kadar görünür",
          body: "Düşünme ve araç çıktısı için sessiz, varsayılan ya da tümü.",
        },
        "pick-up-later": {
          title: "Sonra devam et",
          body: "Son oturuma -c ile, herhangi birine -s ile devam edin.",
        },
        "same-opencode": {
          title: "Aynı OpenCode",
          body: "Diğer uygulamalarla aynı sunucu, ajanlar ve modeller.",
        },
        agents: {
          title: "Ajanlar",
          body: "Ajanları doğrudan prompt'tan değiştirin.",
        },
        compact: {
          title: "Sıkıştır",
          body: "Uzun bir oturumu /compact ile küçültün.",
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
      body: "Ajanlar gerçek tarayıcınızı kullansın.",
      title: "OpenCode | Browse, kodlama ajanları için gerçek tarayıcınız",
      description:
        "Browse, OpenCode'un ve diğer MCP istemcilerinin gerçek tarayıcınızı kullanmasını sağlar. Ajanlar arka plan sekmelerini Playwright ile yönetir, girişleri ve 2FA'yı size bırakır.",
      intro:
        "Ajanlarınızın gerçek tarayıcınızı, yani sekmelerinizi, oturum açmış hesaplarınızı ve eklentilerinizi kullanmasını sağlayan bir MCP sunucusu ve bir Chromium eklentisi. Sekmeleri Playwright ile açıp yönetir, ekran görüntüsü alır ve ekranı kaydederler. Bunu yolunuza çıkmayan, gruplanmış arka plan sekmelerinde yaparlar. Sıra size geldiğinde, örneğin bir giriş, 2FA istemi ya da ödeme için, sekmeyi size verirler ve siz Continue'ya tıklayınca devam ederler.",
      features: {
        "your-real-browser": {
          title: "Gerçek tarayıcınız",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera ve Chromium.",
        },
        "out-of-your-way": {
          title: "Yolunuzda değil",
          body: "Ajan sekmeleri arka planda, daraltılmış gruplarda açılır.",
        },
        handoffs: {
          title: "Devir",
          body: "Girişi ya da 2FA adımını kendiniz yapın, sonra Continue'ya tıklayın.",
        },
        "lend-a-tab": {
          title: "Sekme ver",
          body: "Açık bir sekmeyi ajana vermek için araç çubuğu düğmesine tıklayın.",
        },
        "record-and-capture": {
          title: "Kaydet ve yakala",
          body: "Ekran görüntüleri, ekran kayıtları ve HAR olarak ağ trafiği.",
        },
        "any-mcp-client": {
          title: "Her MCP istemcisi",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed ve çok daha fazlası.",
        },
        "all-your-logins": {
          title: "Tüm oturum açmalarınız",
          body: "Ajanlar zaten oturum açtığınız siteleri kullanır. Anahtar yok, kurulum yok.",
        },
        allowlists: {
          title: "İzin listeleri",
          body: "Bir oturumun sekmelerini belirttiğiniz sitelerle sınırlayın.",
        },
      },
      install:
        "Önce [Chrome uzantısını] yükleyin. Kalan adımlarda size yol gösterir. CLI'yi doğrudan yüklemek için (buna ihtiyacınız olmamalı) bunlardan birini kullanın.",
    },
  },
  apps: {
    browse: {
      category: "Ajanlar için tarayıcı kontrolü",
      body: "Ajanınız gerçek tarayıcınızı, oturumlarınız ve sekmelerinizle kullansın.",
    },
    hex: {
      category: "Sesle dikte",
      body: "Her uygulama için cihaz üzerinde sesle dikte.",
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
    lead: "Başlamanın en kolay yolu OpenCode'u indirip ücretsiz modelleri kullanmak. Hesap gerekmez. Daha fazlası için kendi aboneliğinizi getirin ya da OpenCode Go kullanın.",
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
        title: "Ücretsiz modeller",
        line: "OpenCode bir dizi ücretsiz modelle gelir. Hesap gerekmez.",
      },
      "add-more-models": {
        title: "Model ekle",
        line: "Kendi aboneliğinizi getirin ya da aylık 10 $'dan başlayan OpenCode Go seçkisini kullanın.",
      },
    },
    sentence:
      "OpenCode'u indirin, ücretsiz modellerle başlayın, daha fazlasını istediğinizde kendi aboneliğinizi ya da OpenCode Go'yu kullanın.",
  },
  byos: {
    title: "Kendi aboneliğinizi getirin",
    headline: "Zaten sahip olduğunuz abonelikleri kullanın.",
    line: "ChatGPT Plus ya da Pro veya GitHub Copilot ile giriş yapın. Ya da bir OpenCode aboneliği kullanın.",
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
        text: "Ajan için kurallar",
        copied: "Kopyalandı",
      },
    },
    naming: {
      title: "Ad",
      body: "OpenCode'u büyük O ve büyük C ile tek kelime olarak yazın. Opencode, Open Code, OpenCode AI ya da Open-Code yazmayın.",
      code: "Küçük harfli `opencode` adını yalnızca kodda ve `opencode-figma` ya da `@acme/opencode-plugin` gibi paket adlarında kullanın.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Uygulama simgeleri, avatarlar ve diğer küçük alanlar için tek başına logo. Kare sürümler, kareye kırpan yerler için kenar boşluğu ekler.",
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
        body: "OpenCode harf biçimleriyle yazılmış tam ad. Adı tam yazacak yer olan her yerde kullanın.",
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
      body: "Slack, Discord, GitHub ve diğer profiller için 1024px kare avatarlar. Arka plan tüm kareyi doldurur ve logo dairenin epey içinde durur, böylece yuvarlak kırpmada da bozulmaz.",
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
      body: "Logo ve yazı logosu tek bir mürekkebi üç opaklıkta kullanır, koyu arka planlar için daha açık bir mürekkep vardır. Aşağıdaki değerler standart dosyalardaki renklerdir. Bunları yalnızca logo ve yazı logosu için kullanın; diğer metinlerde veya arka planlarda kullanmayın. Kopyalamak için bir değere tıklayın.",
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
      body: "Logoyu arka planınızda net gösteren sürümü seçin, açık arka planda koyu, koyu arka planda açık. Logo ve yazı logosu ayrı dosyalardır, ikisinden birini kullanın.",
      groups: {
        default: {
          name: "Varsayılan",
          body: "Neredeyse her yerde kullanılacak logo. İç tonu saydamdır. Beyaz ya da siyah üzerinde iki tonlu grilerle tamamen aynı görünür, fotoğraf, gradyan ve renkler üzerinde ise arka plan içinden görünür.",
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
          body: "Tek renk, açık harf içleri, iç ton yok. Düz renkli arka planlarda, tek renkli baskıda ve grilerin kullanılamadığı her yerde kullanın. Açık renklerde sade koyu, koyu renklerde sade açık.",
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
        body: "Logonun oranları 4:5'te sabittir ve bir çizgi genişliğinin dörtte biridir. Her kenar ve her çizgi tam bir piksele denk gelsin diye 4 × 5px adımlarla ölçekleyin.",
        do: "her kenar ve 4px çizgi tam piksellerde.",
        dont: "logoyu 4:5 dışında boyutlandırmak, kenarlar piksel aralarına düşer ve bulanıklaşır.",
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
          caption: "logoyu germek ya da basmak.",
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
          caption: "iki tonlu gri logoyu renkli arka plana koymak, orada griler bulanık görünür.",
        },
      },
    },
    integrations: {
      title: "Entegrasyonlar",
      body: "OpenCode ile çalışan eklentiler, sağlayıcılar ve araçlar ile onunla yapılmış projeler bunu belirtebilir. Bir rozet ya da ortaklık logosu kullanın ve projenize sizin olduğu açıkça anlaşılacak bir ad verin.",
      badges: {
        body: "README'nize, dokümanlarınıza ya da sitenize bir rozet koyun ve opencode.ai'ye bağlayın. Arka planınıza göre açık ya da koyu dosyayı seçin (HTML kendiliğinden geçiş yapar) ve renkleri ya da metni değiştirmeyin.",
        sizes: "Her stil 20, 32 ve 44px boyutlarında (Shields yalnızca 20px), SVG ve 2× PNG olarak gelir.",
        mono: "Her dosyanın OpenTUI Mono metinli bir sürümü de var. Uzantıdan önce -mono ekleyin, örneğin opencode-works-with-a-light-20-mono.svg, ya da büyük harfli OpenTUI Mono için -mono-caps.",
        groups: {
          "works-with": {
            title: "Uyumlu",
            alt: "OpenCode ile uyumlu",
            body: "OpenCode ile çalışan eklentiler, sağlayıcılar ve araçlar için.",
          },
          "built-with": {
            title: "Yapıldı",
            alt: "OpenCode ile yapıldı",
            body: "OpenCode ile yapılmış projeler için.",
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
        body: "OpenCode logosunu ve ortak logosunu aralarında bir × ile yan yana koyun. ×'in her iki yanında 3 çizgi boşluk bırakın, ortak logosunu OpenCode logosu kadar yüksek görünecek şekilde boyutlandırın ve tüm bileşimin çevresinde boş alan bırakın.",
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
        before: "Sorularınız için e-posta gönderin, ",
        after: ".",
      },
    },
  },
  press: {
    title: "OpenCode | Şirket bilgileri ve marka dosyalarıyla basın kiti",
    description:
      "OpenCode basın kiti. OpenCode ve onu geliştiren şirket Anomaly hakkında bilgiler, indirilebilir logolar ve yazı logoları, basın soruları için bir iletişim adresi.",
    hero: {
      title: "Basın",
      body: "OpenCode ve Anomaly hakkında yazmak için bilgiler, marka dosyaları ve iletişim.",
    },
    company: {
      title: "Anomaly hakkında",
      lead: "Anomaly, OpenCode'u geliştiren şirkettir. Geliştiriciler için açık kaynak araçlar yapar.",
      more: "Diğer projeler arasında SST ve OpenTUI var, hepsi [GitHub](github) üzerinde açık kaynak.",
      learnMore: "Daha fazlası için [anoma.ly](site) adresine gidin.",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "Masaüstü, terminal ve mobil uygulamaları ile bir SDK'sı olan açık kaynaklı kodlama ajanı. MIT lisanslı, 220.000'den fazla GitHub yıldızı.",
        },
        sst: {
          name: "SST",
          body: "Kendi altyapınızda full-stack uygulamalar kurmak için bir framework. MIT lisanslı, 2020'den beri açık, 26.000'den fazla GitHub yıldızı.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Zig ile yazılmış bir çekirdekle TypeScript, React ya da Solid'de terminal arayüzleri için bir kitaplık. OpenCode onu üretimde kullanır. 13.000'den fazla GitHub yıldızı.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "AI model özellikleri, fiyatları ve yetenekleri için herkese açık API'si olan açık kaynak bir veritabanı. 200'den fazla sağlayıcıdan 8.900'den fazla model listeler.",
        },
        hex: {
          name: "Hex",
          body: "Mac, Windows ve Linux için sesle dikte. Hex cihazınızda yazıya döker ve her uygulamaya yapıştırır, böylece ses cihazdan hiç çıkmaz.",
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
        long: "OpenCode açık kaynaklı bir kodlama ajanıdır. Masaüstü uygulaması, terminal arayüzü, mobil uygulama ve SDK olarak gelir ve Claude, GPT ve Gemini dahil her sağlayıcının modelleriyle çalışır. OpenCode MIT lisanslıdır ve Anomaly tarafından geliştirilir. 220.000'den fazla GitHub yıldızı ve 1.000'den fazla katkıcısı vardır, her ay 22 milyondan fazla geliştirici onu kullanır.",
        short:
          "OpenCode, Anomaly'nin masaüstü, terminal ve mobil uygulamaları ile bir SDK'sı olan açık kaynaklı kodlama ajanıdır.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console, geliştiricilerin ve ekiplerin OpenCode ve diğer kodlama ajanları için AI model erişimi satın alıp yönettiği web uygulamasıdır. Sınır modeller ve açık ağırlıklı modeller için ön ödemeli kredilerden istek başına ücretlendirilen kullandıkça öde çıkarımı ve OpenCode Go abonelikleri sunar. Ekipler Member, Admin ve Owner rollerine sahip çalışma alanları, çalışma alanı ve kullanıcı başına harcama limitleri, Okta, Microsoft Entra ID ya da Google Workspace ile tek oturum açma ve SCIM elde eder. Console 30'dan fazla sağlayıcıyı destekler, böylece ekipler mevcut sağlayıcı hesaplarını bağlayabilir ve Console'un kendi çıkarımı isteğe bağlıdır. Adresi opencode.ai/console.",
          short:
            "OpenCode Console, Anomaly'nin kullandıkça öde AI model erişimi, OpenCode Go abonelikleri ve bütçe ile tek oturum açma gibi ekip denetimleri sunan web uygulamasıdır.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go, kodlama modelleri için sabit aylık fiyat isteyen geliştiricilere yönelik bir aboneliktir. Go aylık 10 $, daha yüksek limitli Go Plus aylık 40 $, Go Teams ise üye başına aylık 20 $'dır. Her plan, ajanlı kodlama için test edilmiş seçkin bir model kümesi içerir. Kullanım limitleri her model için aylık dolar tutarlarıdır, aylık limitin %20'si ve %50'si olan kayan 5 saatlik ve haftalık paylarla birlikte. Aboneler kredi yükleyebilir, kullandıkça öde bakiyesine geçebilir ve istedikleri zaman iptal edebilir. Go, OpenCode ve diğer ajanlarla çalışır. Adresi opencode.ai/console/go.",
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
      intro: "OpenCode sık sık sürüm çıkarır. Yeni özellikler içeren en yeni sürümler bunlar.",
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
        "Her uygulamanın gerçek üründen kaydedilmiş görselleri ve kısa videoları. OpenCode hakkında yazarken kullanabilirsiniz.",
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
              title: "Sekmelerde oturumlar",
            },
            "feature-2": {
              title: "İncele ve yorumla",
            },
            "feature-3": {
              title: "Tarayıcıda gör",
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
              title: "Onaylar",
            },
            "feature-3": {
              title: "Oturumlar",
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
              title: "Sade bir dille sor",
            },
            "feature-2": {
              title: "Çalışanı onayla",
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
              title: "CI'ı koddan düzelt",
            },
            "feature-2": {
              title: "Her adımı izle",
            },
            "feature-3": {
              title: "Kendi araçların",
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
          body: "macOS, Windows ve Linux'ta birden fazla ajanı aynı anda, her birini kendi sekmesinde çalıştırın. Her değişikliği diff olarak inceleyin ve önizleyin.",
        },
        mobile: {
          name: "Mobile",
          body: "En yeni OpenCode uygulaması. Ajanla konuşmak için bir oturumu arayın, ardından değişikliklerini her yerden telefonunuzla inceleyip onaylayın.",
        },
        terminal: {
          name: "Terminal",
          body: "Her kabukta, editörde ya da uzak sunucuda çalışan bir terminal arayüzü. Her düzenlemeyi diff olarak görün ve hangi komutların kendiliğinden çalışacağını seçin.",
        },
        sdk: {
          name: "SDK",
          body: "Betikler, CI işleri ve kendi araçlarınız için tipli bir TypeScript istemcisi. Oturum oluşturun, prompt gönderin ve her olayı geldikçe aktarın.",
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
          body: "OpenCode ile ilgili yardım için bir issue açın ya da topluluğa sorun. Hesap ve faturalama soruları için bize e-posta gönderin.",
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
        label: "SDK dokümanlarını okuyun",
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
      "OpenCode Mobile, bilgisayarınızdaki OpenCode için bir uzaktan kumandadır. Oturumlarınız orada çalışmaya devam eder, uygulama onları gösterir ve yönlendirmenizi sağlar.",
    steps: {
      "get-the-app": {
        title: "Uygulamayı edinin",
        body: "OpenCode betasını TestFlight üzerinden iPhone'unuza kurun. Android uygulaması çok yakında.",
      },
      "run-this-on-your-computer": {
        title: "Bunu bilgisayarda çalıştırın",
        body: "Tek kullanımlık bir bağlantı ve bir QR kodu yazdırır. İkisi de bir kez çalışır ve 5 dakikada sona erer.",
      },
      "scan-the-code": {
        title: "Kodu okutun",
        body: "QR kodunu uygulamayla okutun ya da bağlantıyı yapıştırın. Bilgisayarınızın son oturumları telefonunuzda açılır.",
      },
    },
    note: "--remote bir OpenTunnel adresi üzerinden bağlanır, bu yüzden her ağdan çalışır. Aynı Wi-Fi'daysanız bir kez opencode service set hostname 0.0.0.0, ardından opencode pair çalıştırın.",
    facts: [
      "Eşleme her ağdan çalışır, çünkü --remote bir OpenTunnel adresi üzerinden bağlanır.",
      "Bağlantı ve kod bir kez çalışır ve 5 dakikada sona erer.",
      "Bilgisayarı açık tutun, çünkü ajan telefonda değil, orada çalışır.",
      "Aynı Wi-Fi'daysanız bir kez opencode service set hostname 0.0.0.0, ardından opencode pair çalıştırın.",
    ],
  },
} satisfies ContentOverlay
