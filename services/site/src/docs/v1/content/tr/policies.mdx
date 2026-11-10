---
title: Politikalar
description: OpenCode'un hangi yapılandırılmış kaynakları kullanabileceğini kontrol edin.
---

:::caution[OpenCode 2 gerektirir]
Politikalar OpenCode 1'de uygulanmaz. Bu sayfadaki örnekler OpenCode 2 gerektirir. OpenCode 1'de sağlayıcıların kullanılabilirliğini kontrol etmek için [`disabled_providers`](/docs/config#disabled-providers) veya [`enabled_providers`](/docs/config#enabled-providers) kullanın. Güncel kullanım için [OpenCode 2 politikalar belgelerine](https://opencode.ai/docs/policies/) bakın.
:::

Politikalar, OpenCode'un adlandırılmış bir kaynak üzerinde bir eylem gerçekleştirip gerçekleştiremeyeceğini kontrol eder. Bu OpenCode 2 özelliği deneyseldir ve `opencode.json` içindeki `experimental.policies` dizisiyle yapılandırılır.

Politikalar [izinlerden](/docs/permissions) ayrıdır. İzinler, araçların bir oturum sırasında neler yapabileceğini kontrol ederken politikalar, OpenCode'un LLM sağlayıcısı gibi bir kaynağı kullanıp kullanamayacağını kontrol eder.

---

## Yapılandırma

Her politika ifadesinin üç alanı vardır:

- `effect` - `"allow"` ya da `"deny"`.
- `action` - Kontrol edilen işlem.
- `resource` - İfadenin uygulandığı kaynak kimliği veya joker karakter kalıbı.

Örneğin, `openai` sağlayıcısının kullanımını engelleyin:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "openai"
      }
    ]
  }
}
```

Politikayla engellenen bir sağlayıcı, kimlik bilgileri olsa veya başka açılardan doğru yapılandırılmış olsa bile model seçimi ya da model kullanımı için kullanılamaz.

---

## Kullanılabilir Politikalar

OpenCode şu anda tek bir politika eylemini destekler:

| Eylem          | Kaynak                              | Açıklama                                                       |
| -------------- | ----------------------------------- | -------------------------------------------------------------- |
| `provider.use` | Sağlayıcı kimliği, örneğin `openai` | Bir LLM sağlayıcısının kullanımına izin verin veya engelleyin. |

Gelecekte daha fazla politika eylemi eklenebilir.

---

## Eşleştirme

`resource` alanı joker karakter eşleştirmesini destekler. Sıfır veya daha fazla karakterle eşleşmek için `*`, tek bir karakterle eşleşmek için `?` kullanın.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "company-*"
      }
    ]
  }
}
```

Bu, `company-us` ve `company-eu` gibi sağlayıcıları engeller.

---

## Kural Sırası

Birden fazla ifade eşleştiğinde son eşleşen ifade geçerli olur. Önce genel kuralları, ardından daha spesifik istisnaları yazın.

Örneğin, yalnızca Anthropic'e izin verin:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "*"
      },
      {
        "effect": "allow",
        "action": "provider.use",
        "resource": "anthropic"
      }
    ]
  }
}
```

Bir sağlayıcıyla eşleşen hiçbir politika yoksa sağlayıcı kullanımına varsayılan olarak izin verilir.

Politikalar hem global yapılandırmanızda hem de proje yapılandırmanızda ayarlanabilir. Her iki konumdaki politikalar aynı sağlayıcıyla eşleşirse global politikanız proje politikasına göre önceliklidir. Bu, bir deponun global olarak engellediğiniz bir sağlayıcıyı yeniden etkinleştirmesini önler.

---

## Sağlayıcı Listeleri

OpenCode 2'de sağlayıcı erişimini kontrol ederken eski `disabled_providers` ve `enabled_providers` ayarları yerine politikaları kullanın. OpenCode 1'de bu sağlayıcı listelerini kullanmaya devam edin.

`disabled_providers` yerine:

```json title="opencode.json"
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "deny", "action": "provider.use", "resource": "google" }
    ]
  }
}
```

`enabled_providers` yerine önce tüm sağlayıcıları engelleyin, ardından seçtiğiniz sağlayıcılara izin verin:

```json title="opencode.json"
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "openai" }
    ]
  }
}
```
