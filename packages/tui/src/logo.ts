// 校园 Harness: 品牌字画选择。
// - muc：中央民族大学校名（PingFang 字形半块字符画，民大红主题下渲染）
//   生成链路：osascript 渲字 → sips 转 BMP → 降采样（详见项目记录），勿手改笔画
// - hubu：湖北大学 "HUBU" 块状字（来自 @opencode-ai/brand/logos）
import { resolveBrand } from "@opencode-ai/brand"
import { logoHubu } from "@opencode-ai/brand/logos"

const brand = resolveBrand()
const isHubu = brand.id === "hubu"

export const logo = isHubu
  ? logoHubu
  : {
  left: [
    "      ▄█              █▄        ▄▄▄▄▄▄▄▄▄▄▄▄",
    " ▄▄▄▄▄██▄▄▄▄▄▄   ▓██████████    ██▀▓▓▓▓▓▓▓██",
    " ██▀▀▀██▀▀▀▀██   ▓█   ██  ██    ████████████",
    " ██   ██    ██  ▓▄█▄▓▄██▓▓██▓   ██▄▄▄▄██▄▄▄▄▓",
    " █████████████  ▀▀▀▀▀████▀▀▀▀▓  ██▀▀▀▀▀██▀▀▀▀",
    " ▀▓   ██    ▀▓     ▄█▀ ▀█▄▄     ██   ▓ ▀█▄ ▓▄",
    "      ██        ▄██▀▓    ▀██▄▄  █████▀  ▀████",
    "      ▓▀        ▓▓          ▀              ▓",
  ],
  right: [
    "  ▄▄   ▄▄             █▄         ▄▄ ▓█▄  ▄█▓",
    "▓█████▄███████        ██       ▓▄▄██▄██▄▄██▄▄",
    " ▓█▄▓▓█▀██▄▄▄▄  ██████████████ ██▀▀▀▀▀▀▀▀▀▀██",
    " ▓█▀██ ██▀█▀▀▓       ███▄      ▀▀ ▀▀▀▀▀███▓▀▀",
    " ▓█▓▄█▄███████▓     ▄█▓▀█▄     ▓▄▄▄▄▄▄██▄▄▄▄▄",
    " ██ ██  ▄███▓     ▄██▓  ▓██▄   ▓▀▀▀▀▀▀█▀▀▀▀▀▀",
    "▄█▀▄██▓▄█▀ ▀█▄▓ ▄██▀      ▀██▄     ▄▄▄█▓",
    " ▓ ▀▀  ▀     ▀  ▀▓          ▓      ▓▀▀▓",
  ],
}

export const logoMotto = isHubu ? logoHubu.motto : "美美与共 · 知行合一"
export const logoSchool = isHubu ? logoHubu.school : "MINZU UNIVERSITY OF CHINA"

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
