---
title: Introduction
description: Commencez avec OpenCode.
---

import { Tabs, TabItem } from "@astrojs/starlight/components"
import config from "../../../../config.mjs"
export const console = config.console

[**OpenCode**](/) est un agent de codage d'IA open source. Il est disponible sous forme d'interface basée sur un terminal, d'application de bureau ou d'extension IDE.

![OpenCode TUI avec le thème opencode](../../../assets/lander/screenshot.png)

Commençons.

---

#### Prérequis

Pour utiliser OpenCode dans votre terminal, vous aurez besoin de :

1. Un émulateur de terminal moderne comme :
   - [WezTerm](https://wezterm.org), multiplateforme
   - [Alacritty](https://alacritty.org), multiplateforme
   - [Ghostty](https://ghostty.org), Linux et macOS
   - [Kitty](https://sw.kovidgoyal.net/kitty/), Linux et macOS

2. Clés API pour les fournisseurs de LLM que vous souhaitez utiliser.

---

## Installation

Le moyen le plus simple d'installer OpenCode est d'utiliser le script d'installation.

```bash
curl -fsSL https://opencode.ai/install | bash
```

Vous pouvez également l'installer avec les commandes suivantes :

- **Node.js**

    <Tabs>

      <TabItem label="npm">
      ```bash
      npm install -g opencode-ai
      ```

      </TabItem>

      <TabItem label="Bun">
      ```bash
      bun install -g opencode-ai
      ```

      </TabItem>

      <TabItem label="pnpm">
      ```bash
      pnpm install -g opencode-ai
      ```

      </TabItem>

      <TabItem label="Yarn">
      ```bash
      yarn global add opencode-ai
      ```

      </TabItem>

  </Tabs>

- **Via Homebrew sur macOS et Linux**

  ```bash
  brew install anomalyco/tap/opencode
  ```

  > Nous vous recommandons d'utiliser le tap OpenCode pour les versions les plus récentes. La formule officielle `brew install opencode` est maintenue par l'équipe Homebrew et est mise à jour moins fréquemment.

- **Via Paru sur Arch Linux**

  ```bash
  sudo pacman -S opencode           # Arch Linux (Stable)
  paru -S opencode-bin              # Arch Linux (Latest from AUR)
  ```

#### Windows

:::tip[Recommandé : utilisez WSL]
Pour une expérience optimale sur Windows, nous vous recommandons d'utiliser le [Windows Subsystem for Linux (WSL)](/docs/windows-wsl). Il offre de meilleures performances et une compatibilité totale avec les fonctionnalités de OpenCode.
:::

- **Via Chocolatey**

  ```bash
  choco install opencode
  ```

- **Via Scoop**

  ```bash
  scoop install opencode
  ```

- **Via NPM**

  ```bash
  npm install -g opencode-ai
  ```

- **Via Mise**

  ```bash
  mise use -g github:anomalyco/opencode
  ```

- **Via Docker**

  ```bash
  docker run -it --rm ghcr.io/anomalyco/opencode
  ```

Le support de l'installation de OpenCode sur Windows à l'aide de Bun est actuellement en cours de développement.

Vous pouvez également récupérer le binaire dans les [Releases](https://github.com/anomalyco/opencode/releases).

---

## Configuration

Avec OpenCode, vous pouvez utiliser n'importe quel fournisseur de LLM en configurant ses clés API.

Si vous débutez avec les fournisseurs de LLM, nous vous recommandons d'utiliser [OpenCode Zen](/docs/zen).
C'est une liste curée de modèles qui ont été testés et vérifiés par l'équipe OpenCode.

1. Exécutez la commande `/connect` dans le TUI, sélectionnez opencode et allez sur [opencode.ai/auth](https://opencode.ai/auth).

   ```txt
   /connect
   ```

2. Connectez-vous, ajoutez vos informations de facturation et copiez votre clé API.

3. Collez votre clé API.

   ```txt
   ┌ API key
   │
   │
   └ enter
   ```

Vous pouvez également sélectionner l'un des autres fournisseurs. [En savoir plus](/docs/providers#directory).

---

## Initialisation

Maintenant que vous avez configuré un fournisseur, vous pouvez accéder à un projet sur lequel vous voulez travailler.

```bash
cd /path/to/project
```

Et exécutez OpenCode.

```bash
opencode
```

Ensuite, initialisez OpenCode pour le projet en exécutant la commande suivante.

```bash frame="none"
/init
```

Cela permettra à OpenCode d'analyser votre projet et de créer un fichier `AGENTS.md` à la racine du projet.

:::tip
Vous devez valider le fichier `AGENTS.md` de votre projet dans Git.
:::

Cela aide OpenCode à comprendre la structure du projet et les modèles de codage utilisés.

---

## Utilisation

Vous êtes maintenant prêt à utiliser OpenCode pour travailler sur votre projet. N'hésitez pas à lui demander n'importe quoi !

Si vous débutez dans l'utilisation d'un agent de codage IA, voici quelques exemples qui pourraient aider.

---

### Poser des questions

Vous pouvez demander à OpenCode de vous expliquer la base de code.

:::tip
Utilisez la touche `@` pour effectuer une recherche floue de fichiers dans le projet.
:::

```txt frame="none" "@packages/functions/src/api/index.ts"
How is authentication handled in @packages/functions/src/api/index.ts
```

Ceci est utile s'il y a une partie de la base de code sur laquelle vous n'avez pas travaillé.

---

### Ajouter des fonctionnalités

Vous pouvez demander à OpenCode d'ajouter de nouvelles fonctionnalités à votre projet. Cependant, nous recommandons d’abord de lui demander de créer un plan.

1. **Créer un plan**

OpenCode dispose d'un _Mode Plan_ qui désactive sa capacité à apporter des modifications et suggère plutôt _comment_ il implémentera la fonctionnalité.

Accédez-y à l'aide de la touche **Tab**. Vous verrez un indicateur à cet effet dans le coin inférieur droit.

```bash frame="none" title="Switch to Plan mode"
   <TAB>
```

Décrivons maintenant ce que nous voulons qu'il fasse.

```txt frame="none"
   When a user deletes a note, we'd like to flag it as deleted in the database.
   Then create a screen that shows all the recently deleted notes.
   From this screen, the user can undelete a note or permanently delete it.
```

Vous souhaitez donner à OpenCode suffisamment de détails pour comprendre ce que vous voulez. Ça aide pour lui parler comme si vous parliez à un développeur junior de votre équipe.

:::tip
Donnez à OpenCode beaucoup de contexte et d'exemples pour l'aider à comprendre ce que vous voulez.
:::

2. **Itérer sur le plan**

Une fois qu'il vous donne un plan, vous pouvez lui faire part de vos commentaires ou ajouter plus de détails.

```txt frame="none"
   We'd like to design this new screen using a design I've used before.
   [Image #1] Take a look at this image and use it as a reference.
```

:::tip
Glissez-déposez des images dans le terminal pour les ajouter à l'invite.
:::

OpenCode peut scanner toutes les images que vous lui donnez et les ajouter à l'invite. Vous pouvez le faire en glissant et en déposant une image dans le terminal.

3. **Créez la fonctionnalité**

Une fois que vous vous sentez à l'aise avec le plan, revenez au _Mode Build_ en appuyant à nouveau sur la touche **Tab**.

```bash frame="none"
   <TAB>
```

Et demandez-lui d'apporter les modifications.

```bash frame="none"
   Sounds good! Go ahead and make the changes.
```

---

### Apporter des modifications

Pour des modifications plus simples, vous pouvez demander à OpenCode de construire directement sans avoir à revoir le plan au préalable.

```txt frame="none" "@packages/functions/src/settings.ts" "@packages/functions/src/notes.ts"
We need to add authentication to the /settings route. Take a look at how this is
handled in the /notes route in @packages/functions/src/notes.ts and implement
the same logic in @packages/functions/src/settings.ts
```

Vous devez fournir suffisamment de détails pour qu'OpenCode effectue les bonnes modifications.

---

### Annuler les modifications

Disons que vous demandez à OpenCode d'apporter quelques modifications.

```txt frame="none" "@packages/functions/src/api/index.ts"
Can you refactor the function in @packages/functions/src/api/index.ts?
```

Mais vous réalisez que ce n’est pas ce que vous vouliez. Vous **pouvez annuler** les modifications à l'aide de la commande `/undo`.

```bash frame="none"
/undo
```

OpenCode annulera désormais les modifications que vous avez apportées et affichera votre message d'origine encore.

```txt frame="none" "@packages/functions/src/api/index.ts"
Can you refactor the function in @packages/functions/src/api/index.ts?
```

À partir de là, vous pouvez modifier l'invite et demander à OpenCode de réessayer.

:::tip
Vous pouvez exécuter `/undo` plusieurs fois pour annuler plusieurs modifications.
:::

Ou vous **pouvez refaire** les modifications à l'aide de la commande `/redo`.

```bash frame="none"
/redo
```

---

## Partager

Les conversations que vous avez avec OpenCode peuvent être [partagées avec votre équipe](/docs/share).

```bash frame="none"
/share
```

Cela créera un lien vers la conversation en cours et le copiera dans votre presse-papiers.

:::note
Les conversations ne sont pas partagées par défaut.
:::

Voici un [exemple de conversation](https://opencode.ai/s/4XP1fce5) avec OpenCode.

---

## Personnaliser

Et c'est tout ! Vous êtes désormais un pro de l'utilisation de OpenCode.

Pour vous l'approprier, nous vous recommandons de [choisir un thème](/docs/themes), [de personnaliser les raccourcis clavier](/docs/keybinds), de [configurer les formateurs de code](/docs/formatters), de [créer des commandes personnalisées](/docs/commands) ou de jouer avec la [OpenCode Config](/docs/config).
