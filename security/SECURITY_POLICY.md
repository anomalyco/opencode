# بىخەتەرلىك سىياسىتى

ئۇيغۇرچە ئەسكەرتىش: بۇ سىياسەت [MUHLISCODE.md](../MUHLISCODE.md) دىكى قائىدىلەرگە ئاساسلىنىدۇ.

## تور چەكلىمىلىرى

- ئۇيغۇرچە: سۈكۈتتە ئىشلىتىش ستاتىستىكىسى (telemetry) يوللانمايدۇ.
- ئۇيغۇرچە: ئاپتوماتىك يېڭىلاش تەكشۈرۈشى تاقالغان. ئۇنى `MUHLISCODE_ENABLE_AUTOUPDATE=1` بىلەن قولدا ئاچقىلى بولىدۇ.
- ئۇيغۇرچە: OTLP ۋە Sentry پەقەت ئىشلەتكۈچى مۇھىت ئۆزگەرگۈچىسى بېكىتكەندىلا ئىشلەيدۇ.
- ئۇيغۇرچە: ھەربىر يېڭى سىرتقى ئادرېس قوشۇلغاندا `security/audits/` غا خاتىرە يېزىلىدۇ.

## مەخپىيەتلىك

- ئۇيغۇرچە: `.env`، API ئاچقۇچى ۋە SSH ئاچقۇچى git غا قوشۇلمايدۇ.
- ئۇيغۇرچە: ھەرقانداق ئاچقۇچ ئاشكارا بولۇپ قالسا دەرھال ئالماشتۇرۇلىدۇ.

## ئوچۇق مەسىلىلەر

- ئۇيغۇرچە: ئەڭ يېڭى تەكشۈرۈش نەتىجىسى ۋە تېخى ھەل قىلىنمىغان ئادرېسلار [audits/2026-11-15-telemetry.md](./audits/2026-11-15-telemetry.md) دا.

## خىتاي تەمىنلىگۈچىلىرىنى چەكلەش

- ئۇيغۇرچە: [bin/muhliscode-policy.json](../bin/muhliscode-policy.json) ئامبارنىڭ ئىچكى `policies` مېخانىزمى بىلەن `provider.use` نى `deny` قىلىدۇ. `bin/muhliscode.cmd` ئۇنى `OPENCODE_CONFIG` ئارقىلىق ھەر قېتىم يۈكلەيدۇ.
- ئۇيغۇرچە: چەكلەنگەنلەر: `opencode` (ئەسلى OpenCode نىڭ ھەقسىز تىزىملىكى، ئىچىدە DeepSeek، GLM، MiniMax، Xiaomi MiMo، Meituan LongCat بار)، `opencode-go`، Alibaba / Qwen، Moonshot / Kimi، Zhipu / Z.ai، MiniMax، DeepSeek، BytePlus، Volcengine، SiliconFlow، StepFun، Xiaomi، Baidu، Tencent / Hunyuan، Huawei، iFlytek ۋە `*-cn` بىلەن ئاخىرلىشىدىغانلار.
- ئۇيغۇرچە چەكلىمە: بۇ چەكلەش تەمىنلىگۈچى ID سى بويىچە. ئەگەر ئىشلەتكۈچى OpenRouter غا ئوخشاش ئارىلىق مۇلازىمەت ئارقىلىق خىتاي مودېلىنى تاللىسا، چەكلەش ئۇنى توسمايدۇ.
- ئۇيغۇرچە چەكلىمە: `packages/ai/src/providers/` ئىچىدە ئىسپاتلانغان كود (alibaba، minimax، moonshot، deepseek، zai، volcengine، byteplus) تېخى ئۆچۈرۈلمىدى. ئۇلار پەقەت چەكلەنگەن.
- ئۇيغۇرچە: ئىسپاتلاش: `muhliscode models` تىزىملىكىدە پەقەت `claude-agent` ۋە `google` قالدى.
