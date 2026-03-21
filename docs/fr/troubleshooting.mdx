---
title: Dépannage
description: Problèmes courants et comment les résoudre.
---

Pour déboguer les problèmes avec OpenCode, commencez par vérifier les journaux et les données locales qu'il stocke sur le disque.

---

## Journaux

Les fichiers journaux sont écrits dans :

- **macOS/Linux** : `~/.local/share/opencode/log/`
- **Windows** : appuyez sur `WIN+R` et collez `%USERPROFILE%\.local\share\opencode\log`

Les fichiers journaux sont nommés avec des horodatages (par exemple, `2025-01-09T123456.log`) et les 10 fichiers journaux les plus récents sont conservés.

Vous pouvez définir le niveau de journalisation avec l'option de ligne de commande `--log-level` pour obtenir des informations de débogage plus détaillées. Par exemple, `opencode --log-level DEBUG`.

---

## Stockage

opencode stocke les données de session et autres données d'application sur le disque à l'emplacement :

- **macOS/Linux** : `~/.local/share/opencode/`
- **Windows** : appuyez sur `WIN+R` et collez `%USERPROFILE%\.local\share\opencode`

Ce répertoire contient :

- `auth.json` - Données d'authentification telles que les clés API, les jetons OAuth
- `log/` - Journaux d'applications
- `project/` - Données spécifiques au projet telles que les données de session et de message
  - Si le projet se trouve dans un dépôt Git, il est stocké dans `./<project-slug>/storage/`
  - S'il ne s'agit pas d'un dépôt Git, il est stocké dans `./global/storage/`

---

## Application de bureau

OpenCode Desktop exécute un serveur OpenCode local (le side-car `opencode-cli`) en arrière-plan. La plupart des problèmes sont causés par un plugin qui se comporte mal, un cache corrompu ou un mauvais paramètre du serveur.

### Vérifications rapides

- Quittez complètement et relancez l'application.
- Si l'application affiche un écran d'erreur, cliquez sur **Redémarrer** et copiez les détails de l'erreur.
- macOS uniquement : menu `OpenCode` -> **Recharger la vue Web** (aide si l'interface utilisateur est vide/gelée).

---

### Désactiver les plugins

Si l'application de bureau plante au lancement, se bloque ou se comporte étrangement, commencez par désactiver les plugins.

#### Vérifiez la configuration globale

Ouvrez votre fichier de configuration global et recherchez une clé `plugin`.

- **macOS/Linux** : `~/.config/opencode/opencode.jsonc` (ou `~/.config/opencode/opencode.json`)
- **macOS/Linux** (anciennes installations) : `~/.local/share/opencode/opencode.jsonc`
- **Windows** : appuyez sur `WIN+R` et collez `%USERPROFILE%\.config\opencode\opencode.jsonc`

Si vous avez configuré des plugins, désactivez-les temporairement en supprimant la clé ou en la définissant sur un tableau vide :

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Vérifiez les répertoires des plugins

OpenCode peut également charger des plugins locaux à partir du disque. Écartez-les temporairement (ou renommez le dossier) et redémarrez l'application de bureau :

- **Plugins mondiaux**
  - **macOS/Linux** : `~/.config/opencode/plugins/`
  - **Windows** : appuyez sur `WIN+R` et collez `%USERPROFILE%\.config\opencode\plugins`
- **Plugins de projet** (uniquement si vous utilisez une configuration par projet)
  - `<your-project>/.opencode/plugins/`

Si l'application recommence à fonctionner, réactivez les plugins un par un pour trouver celui à l'origine du problème.

---

### Vider le cache

Si la désactivation des plugins ne résout pas le problème (ou si l'installation d'un plugin est bloquée), videz le cache afin que OpenCode puisse le reconstruire.

1. Quittez complètement OpenCode Desktop.
2. Supprimez le répertoire cache :

- **macOS** : Finder -> `Cmd+Shift+G` -> coller `~/.cache/opencode`
- **Linux** : supprimez `~/.cache/opencode` (ou exécutez `rm -rf ~/.cache/opencode`)
- **Windows** : appuyez sur `WIN+R` et collez `%USERPROFILE%\.cache\opencode`

3. Redémarrez le bureau OpenCode.

---

### Résoudre les problèmes de connexion au serveur

OpenCode Desktop peut soit démarrer son propre serveur local (par défaut), soit se connecter à un serveur URL que vous avez configuré.

Si vous voyez une boîte de dialogue **« Échec de la connexion »** (ou si l'application ne dépasse jamais l'écran de démarrage), recherchez un serveur personnalisé URL.

#### Effacer le serveur par défaut du bureau URL

Depuis l'écran d'accueil, cliquez sur le nom du serveur (avec le point d'état) pour ouvrir le sélecteur de serveur. Dans la section **Serveur par défaut**, cliquez sur **Effacer**.

#### Supprimez `server.port` / `server.hostname` de votre configuration

Si votre `opencode.json(c)` contient une section `server`, supprimez-la temporairement et redémarrez l'application de bureau.

#### Vérifier les variables d'environnement

Si `OPENCODE_PORT` est défini dans votre environnement, l'application de bureau tentera d'utiliser ce port pour le serveur local.

- Désactivez `OPENCODE_PORT` (ou choisissez un port libre) et redémarrez.

---

### Linux : Problèmes Wayland / X11

Sur Linux, certaines configurations Wayland peuvent provoquer des fenêtres vides ou des erreurs de composition.

- Si vous êtes sur Wayland et que l'application est vide/plante, essayez de la lancer avec `OC_ALLOW_WAYLAND=1`.
- Si cela aggrave les choses, supprimez-le et essayez plutôt de le lancer sous une session X11.

---

### Windows : exécution WebView2

Sur Windows, OpenCode Desktop nécessite Microsoft Edge **WebView2 Runtime**. Si l'application s'ouvre sur une fenêtre vide ou ne démarre pas, installez/mettez à jour WebView2 et réessayez.

---

### Windows : problèmes de performances généraux

Si vous rencontrez des performances lentes, des problèmes d'accès aux fichiers ou des problèmes de terminal sur Windows, essayez d'utiliser [WSL (Windows Sous-système pour Linux)](/docs/windows-wsl). WSL fournit un environnement Linux qui fonctionne de manière plus transparente avec les fonctionnalités de OpenCode.

---

### Les notifications ne s'affichent pas

OpenCode Desktop affiche uniquement les notifications système lorsque :

- les notifications sont activées pour OpenCode dans les paramètres de votre système d'exploitation, et
- la fenêtre de l'application n'est pas ciblée.

---

### Réinitialiser le stockage des applications de bureau (dernier recours)

Si l'application ne démarre pas et que vous ne pouvez pas effacer les paramètres depuis l'interface utilisateur, réinitialisez l'état enregistré de l'application de bureau.

1. Quittez le bureau OpenCode.
2. Recherchez et supprimez ces fichiers (ils se trouvent dans le répertoire de données de l'application OpenCode Desktop) :

- `opencode.settings.dat` (serveur de bureau par défaut URL)
- `opencode.global.dat` et `opencode.workspace.*.dat` (état de l'interface utilisateur comme les serveurs/projets récents)

Pour trouver rapidement le répertoire :

- **macOS** : Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (puis recherchez les noms de fichiers ci-dessus)
- **Linux** : recherchez sous `~/.local/share` les noms de fichiers ci-dessus
- **Windows** : appuyez sur `WIN+R` -> `%APPDATA%` (puis recherchez les noms de fichiers ci-dessus)

---

## Obtenir de l'aide

Si vous rencontrez des problèmes avec OpenCode :

1. **Signaler les problèmes le GitHub**

La meilleure façon de signaler des bogues ou de demander des fonctionnalités consiste à utiliser notre référentiel GitHub :

[**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

Avant de créer un nouveau problème, recherchez les problèmes existants pour voir si votre problème a déjà été signalé.

2. **Rejoignez notre Discord**

Pour obtenir de l'aide en temps réel et une discussion communautaire, rejoignez notre serveur Discord :

[**opencode.ai/discord**](https://opencode.ai/discord)

---

## Problèmes courants

Voici quelques problèmes courants et comment les résoudre.

---

### OpenCode ne démarre pas

1. Vérifiez les journaux pour les messages d'erreur
2. Essayez d'exécuter avec `--print-logs` pour voir la sortie dans le terminal
3. Assurez-vous d'avoir la dernière version avec `opencode upgrade`

---

### Problèmes d'authentification

1. Essayez de vous réauthentifier avec la commande `/connect` dans le TUI
2. Vérifiez que vos clés API sont valides
3. Assurez-vous que votre réseau autorise les connexions au API du fournisseur.

---

### Modèle non disponible

1. Vérifiez que vous êtes authentifié auprès du fournisseur
2. Vérifiez que le nom du modèle dans votre configuration est correct
3. Certains modèles peuvent nécessiter un accès ou des abonnements spécifiques

Si vous rencontrez `ProviderModelNotFoundError`, vous avez probablement tort
faire référence à un modèle quelque part.
Les modèles doivent être référencés comme suit : `<providerId>/<modelId>`

Exemples :

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Pour déterminer à quels modèles vous avez accès, exécutez `opencode models`

---

### ErreurInit du fournisseur

Si vous rencontrez une ProviderInitError, vous avez probablement une configuration non valide ou corrompue.

Pour résoudre ce problème :

1. Tout d'abord, vérifiez que votre fournisseur est correctement configuré en suivant le [guide du fournisseur](/docs/providers)
2. Si le problème persiste, essayez d'effacer votre configuration stockée :

   ```bash
   rm -rf ~/.local/share/opencode
   ```

Sur Windows, appuyez sur `WIN+R` et supprimez : `%USERPROFILE%\.local\share\opencode`

3. Ré-authentifiez-vous auprès de votre fournisseur à l'aide de la commande `/connect` dans le TUI.

---

### Problèmes liés à AI_APICallError et au package du fournisseur

Si vous rencontrez des erreurs d’appel API, cela peut être dû à des packages de fournisseurs obsolètes. opencode installe dynamiquement les packages du fournisseur (OpenAI, Anthropic, Google, etc.) selon les besoins et les met en cache localement.

Pour résoudre les problèmes liés au package du fournisseur :

1. Videz le cache du package du fournisseur :

   ```bash
   rm -rf ~/.cache/opencode
   ```

Sur Windows, appuyez sur `WIN+R` et supprimez : `%USERPROFILE%\.cache\opencode`

2. Redémarrez opencode pour réinstaller les derniers packages du fournisseur

Cela forcera opencode à télécharger les versions les plus récentes des packages du fournisseur, ce qui résout souvent les problèmes de compatibilité avec les paramètres du modèle et les modifications de API.

---

### Le copier/coller ne fonctionne pas sur Linux

Les utilisateurs de Linux doivent disposer de l'un des utilitaires de presse-papiers suivants installés pour que la fonctionnalité copier/coller fonctionne :

**Pour les systèmes X11 :**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Pour les systèmes Wayland :**

```bash
apt install -y wl-clipboard
```

**Pour les environnements sans tête :**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode détectera si vous utilisez Wayland et préférez `wl-clipboard`, sinon il essaiera de trouver les outils du presse-papiers dans l'ordre : `xclip` et `xsel`.
