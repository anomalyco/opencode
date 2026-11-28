# Glossaire fr (docs V2)

Décisions de traduction pour `src/docs/content/fr/`. Les règles partagées de `src/docs/i18n/glossary.md` (noms de produits, sigles, code, libellés d'interface en gras) s'appliquent ; les choix français, y compris pour `agent`/`subagent`, sont consignés ici.

## Registre

- Vouvoiement, ton direct et concis, comme `src/i18n/fr.ts` et les docs V1 françaises.
- Impératif pour les instructions (« Ouvrez », « Ajoutez », « Définissez ») ; pas de « vous devez ».
- Typographie française : espace insécable (U+00A0) avant `:` `;` `?` `!` et à l'intérieur des « guillemets », apostrophe typographique ’ dans la prose.
- Pas de tiret cadratin isolé en début de phrase ; phrases courtes.

## Termes

| Anglais | Français | Remarques |
| --- | --- | --- |
| agent, subagent | agent, subagent | Jamais « sous-agent » ; `mode: subagent`, noms d'agents et IDs inchangés |
| coding agent | agent de code | « agent de code open source » pour OpenCode, jamais « agent IA » |
| Console (produit) | Console | « OpenCode Console » ; `Console` reste aussi dans les libellés d'interface |
| workspace | espace de travail | |
| team | équipe | Go Teams reste en anglais |
| member | membre | |
| owner / admin | propriétaire / administrateur | Libellés d'interface en gras laissés en anglais |
| provider (de modèles) | fournisseur | provider key → clé de fournisseur |
| model | modèle | ID de modèle inchangés |
| tool | outil | Le nom de l'outil `tool`/`tools` en code inchangé |
| skill | skill | Terme gardé, comme dans les docs V1 |
| prompt | prompt | Nom masculin ; « invite » si le sens est une invite de commande système |
| session | session | |
| snapshot | snapshot | Page « Snapshots » |
| checkpoint | point de contrôle | `checkpoint` en code inchangé |
| compaction | compactage | La commande `/compact` inchangée |
| formatter | formateur | |
| theme | thème | |
| keybind(s) | raccourci(s) clavier | |
| permission(s) | autorisation(s) | |
| command | commande | `/command` inchangé |
| plugin | plugin | |
| harness | harness | Gardé en anglais, comme demandé |
| transcript | transcription | |
| scrollback | historique de défilement | |
| base URL | URL de base | |
| Free (offre) | Free | Nom d'offre gardé |
| credit(s) | crédit(s) | |
| balance | solde | |
| invoice | facture | |
| subscription | abonnement | |
| budget | budget | |
| usage | utilisation | |
| web search | recherche web | |
| request | requête | |
| token | token | |
| rate limit | limite de débit | |
| precedence | ordre de priorité | En prose : « prime sur », « est prioritaire » |
| reasoning effort | intensité du raisonnement | Clés et valeurs comme `effort` et `high` inchangées |
| Diff (visionneuse) | Diff | « Visionneuse Diff » ; « diff » en minuscules pour un résultat de comparaison |
| allowance (Go) | quota | « plafond » pour une limite de dépenses imposée par un budget |
| invoiced billing / credit limit | paiement sur facture / plafond de crédit | Ne pas confondre le plafond de crédit et le solde de crédits prépayés |
| data retention | conservation des données | zero data retention → « aucune conservation des données » ; garder ZDR et les libellés d’interface |
| tag (membre, groupe) | étiquette | Garder les libellés comme **Group tags** |
| Location / location | Location / emplacement | Garder `Location` pour le concept interne d’OpenCode et laisser les propriétés de l’API inchangées. Traduire le nom commun par « emplacement ». |
| handshake | négociation | « négociation TLS » ou « négociation WebSocket » selon le protocole ; identifiants inchangés. |
| toast | notification éphémère | À distinguer d’une notification système ; le réglage `persistent: true` peut la garder à l’écran |
| side region (GUI) | volet latéral | Distinguer le volet qui contient les onglets du panneau fourni par le plugin |
| live (état, données) | réactif / en temps réel | Conserver `Live`, `Ipc`, `Store` et les noms de composants de l’API ; IPC désigne le mécanisme |
| OAuth | OAuth | |
| SSO, SCIM, OIDC, SAML, ZDR | inchangés | |
