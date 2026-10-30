import type { Dict } from "./en"
import { dict as en } from "./en"

export const dict = {
  ...en,
  "go.referral.ended.label": "Avertissement",
  "go.referral.ended":
    "Le programme de parrainage est terminé. Les liens de parrainage ne donnent plus de crédit, ni à vous ni à la personne qui les a partagés.",
  "app.meta.description": "OpenCode - L'agent de code open source.",
  "nav.github": "GitHub",
  "nav.docs": "Documentation",
  "nav.enterprise": "Entreprise",
  "nav.zen": "Zen",
  "nav.login": "Se connecter",
  "nav.free": "Télécharger",
  "nav.home": "Accueil",
  "nav.openMenu": "Ouvrir le menu",
  "nav.getStartedFree": "Commencer gratuitement",
  "nav.logoAlt": "OpenCode",

  "nav.context.copyLogo": "Copier le logo en SVG",
  "nav.context.copyWordmark": "Copier le logotype en SVG",
  "nav.context.brandAssets": "Ressources de marque",

  "footer.github": "GitHub",
  "footer.docs": "Documentation",
  "footer.changelog": "Changelog",
  "footer.discord": "Discord",
  "footer.x": "X",

  "legal.brand": "Marque",
  "legal.privacy": "Confidentialité",
  "legal.terms": "Conditions",
  "legal.status.operational": "Tous les systèmes sont opérationnels",
  "legal.status.degraded": "Performances dégradées",
  "legal.status.outage": "Interruption de service",
  "legal.status.unknown": "État du système",

  "email.title": "Soyez le premier à être informé de nos nouveaux produits",
  "email.subtitle": "Inscrivez-vous à la liste d'attente pour un accès anticipé.",
  "email.placeholder": "Adresse e-mail",
  "email.subscribe": "S'abonner",
  "email.success": "Presque terminé - vérifiez votre boîte de réception et confirmez votre adresse e-mail",
  "email.error": "L'inscription a échoué. Veuillez réessayer.",

  "notFound.title": "Introuvable | OpenCode",
  "notFound.heading": "404 - Page introuvable",
  "notFound.home": "Accueil",
  "notFound.docs": "Documentation",
  "notFound.github": "GitHub",
  "notFound.discord": "Discord",
  "notFound.logoLightAlt": "opencode logo light",
  "notFound.logoDarkAlt": "opencode logo dark",

  "common.cancel": "Annuler",
  "common.contactUs": "Contactez-nous",

  "common.videoUnsupported": "Votre navigateur ne prend pas en charge la balise vidéo.",
  "common.figure": "Fig {{n}}.",
  "common.faq": "FAQ",
  "common.learnMore": "En savoir plus",

  "home.title": "OpenCode | L'agent de code IA open source",

  "home.banner.badge": "Nouveau",

  "home.hero.title": "L'agent de code IA open source",
  "home.hero.subtitle.a":
    "Modèles gratuits inclus ou connectez n'importe quel modèle depuis n'importe quel fournisseur,",
  "home.hero.subtitle.b": "dont Claude, GPT, Gemini et plus.",

  "home.install.ariaLabel": "Options d'installation",

  "home.what.title": "Qu'est-ce que OpenCode ?",
  "home.what.body":
    "OpenCode est un agent open source qui vous aide à écrire du code dans votre terminal, IDE ou desktop.",
  "home.what.multiSession.title": "Multi-session",
  "home.what.multiSession.body": "Lancez plusieurs agents en parallèle sur le même projet",
  "home.what.copilot.title": "GitHub Copilot",
  "home.what.copilot.body": "Connectez-vous avec GitHub pour utiliser votre compte Copilot",
  "home.what.chatgptPlus.title": "ChatGPT Plus/Pro",
  "home.what.chatgptPlus.body": "Connectez-vous avec OpenAI pour utiliser votre compte ChatGPT Plus ou Pro",
  "home.what.anyModel.title": "N'importe quel modèle",
  "home.what.anyModel.body": "75+ fournisseurs de LLM via Models.dev, y compris des modèles locaux",
  "home.what.anyEditor.title": "N'importe quel éditeur",
  "home.what.anyEditor.body": "Disponible en interface terminal, application desktop et extension IDE",
  "home.what.readDocs": "Lire la doc",

  "home.growth.title": "L'agent de code IA open source",
  "home.growth.body":
    "Avec plus de <strong>{{stars}}</strong> étoiles sur GitHub, <strong>{{contributors}}</strong> contributeurs et plus de <strong>{{commits}}</strong> commits, OpenCode est utilisé et approuvé par plus de <strong>{{monthlyUsers}}</strong> développeurs chaque mois.",
  "home.growth.githubStars": "Étoiles GitHub",
  "home.growth.contributors": "Contributeurs",
  "home.growth.monthlyDevs": "Devs mensuels",

  "home.privacy.title": "Conçu pour la confidentialité",
  "home.privacy.body":
    "OpenCode ne stocke ni votre code ni vos données de contexte, afin de pouvoir fonctionner dans des environnements sensibles à la confidentialité.",
  "home.privacy.learnMore": "En savoir plus sur",
  "home.privacy.link": "la confidentialité",

  "home.faq.q1": "Qu'est-ce que OpenCode ?",
  "home.faq.a1":
    "OpenCode est un agent open source qui vous aide à écrire et exécuter du code avec n'importe quel modèle d'IA. Il est disponible en interface terminal, application desktop ou extension IDE.",
  "home.faq.q2": "Comment utiliser OpenCode ?",
  "home.faq.a2.before": "Le moyen le plus simple de commencer est de lire l'",
  "home.faq.a2.link": "intro",
  "home.faq.q3": "Ai-je besoin d'abonnements IA supplémentaires pour utiliser OpenCode ?",
  "home.faq.a3.p1":
    "Pas forcément : OpenCode propose des modèles gratuits que vous pouvez utiliser sans créer de compte.",
  "home.faq.a3.p2.beforeZen": "En plus, vous pouvez utiliser des modèles populaires pour le code en créant un compte",
  "home.faq.a3.p2.afterZen": ".",
  "home.faq.a3.p3":
    "Nous encourageons l'utilisation de Zen, mais OpenCode fonctionne aussi avec les fournisseurs populaires comme OpenAI, Anthropic, xAI, etc.",
  "home.faq.a3.p4.beforeLocal": "Vous pouvez même connecter vos",
  "home.faq.a3.p4.localLink": "modèles locaux",
  "home.faq.q4": "Puis-je utiliser mes abonnements IA existants avec OpenCode ?",
  "home.faq.a4.p1": "Oui, vous pouvez utiliser vos abonnements ChatGPT Plus/Pro ou GitHub Copilot.",
  "home.faq.q5": "Puis-je utiliser OpenCode uniquement dans le terminal ?",
  "home.faq.a5.beforeDesktop": "Plus maintenant ! OpenCode est désormais disponible en application pour",
  "home.faq.a5.desktop": "desktop",
  "home.faq.a5.and": "et",
  "home.faq.a5.web": "web",
  "home.faq.q6": "Combien coûte OpenCode ?",
  "home.faq.a6":
    "OpenCode est 100% gratuit. Il inclut aussi des modèles gratuits. Des coûts supplémentaires peuvent s'appliquer si vous connectez un autre fournisseur.",
  "home.faq.q7": "Qu'en est-il des données et de la confidentialité ?",
  "home.faq.a7.p1": "Vos données ne sont stockées que lorsque vous utilisez nos modèles gratuits.",
  "home.faq.a7.p2.beforeModels": "En savoir plus sur",
  "home.faq.a7.p2.modelsLink": "nos modèles",
  "home.faq.q8": "OpenCode est-il open source ?",
  "home.faq.a8.p1": "Oui, OpenCode est entièrement open source. Le code source est public sur",
  "home.faq.a8.p2": "sous la",
  "home.faq.a8.mitLicense": "Licence MIT",
  "home.faq.a8.p3":
    ", ce qui signifie que tout le monde peut l'utiliser, le modifier ou contribuer à son développement. Toute personne de la communauté peut ouvrir des tickets, soumettre des pull requests et étendre les fonctionnalités.",

  "home.zenCta.title": "Accédez à des modèles fiables et optimisés pour les agents de code",
  "home.zenCta.body":
    "Zen vous donne accès à un ensemble sélectionné de modèles d'IA que OpenCode a testés et benchmarkés spécifiquement pour les agents de code. Plus besoin de vous soucier des variations de performance et de qualité selon les fournisseurs : utilisez des modèles validés qui fonctionnent.",
  "home.zenCta.link": "En savoir plus sur Zen",

  "zen.title": "OpenCode Zen | Un ensemble sélectionné de modèles fiables et optimisés pour les agents de code",
  "zen.hero.title": "Modèles fiables et optimisés pour les agents de code",
  "zen.hero.body":
    "Zen vous donne accès à un ensemble sélectionné de modèles d'IA que OpenCode a testés et benchmarkés spécifiquement pour les agents de code. Plus besoin de vous soucier des variations de performance et de qualité selon les fournisseurs : utilisez des modèles validés qui fonctionnent.",

  "zen.faq.q1": "Qu'est-ce que OpenCode Zen ?",
  "zen.faq.a1":
    "Zen est un ensemble sélectionné de modèles d'IA testés et benchmarkés pour les agents de code, créé par l'équipe derrière OpenCode.",
  "zen.faq.q2": "Qu'est-ce qui rend Zen plus précis ?",
  "zen.faq.a2":
    "Zen ne propose que des modèles testés et benchmarkés spécifiquement pour les agents de code. Vous n'utiliseriez pas un couteau à beurre pour couper un steak ; n'utilisez pas de mauvais modèles pour coder.",
  "zen.faq.q3": "Zen est-il moins cher ?",
  "zen.faq.a3":
    "Zen n'est pas à but lucratif. Zen vous facture au prix coûtant des fournisseurs de modèles. Plus Zen est utilisé, plus OpenCode peut négocier de meilleurs tarifs et vous les répercuter.",
  "zen.faq.q4": "Combien coûte Zen ?",
  "zen.faq.a4.p1.beforePricing": "Zen",
  "zen.faq.a4.p1.pricingLink": "facture par requête",
  "zen.faq.a4.p1.afterPricing": "sans marge, vous payez donc exactement ce que facture le fournisseur du modèle.",
  "zen.faq.a4.p2.beforeAccount":
    "Votre coût total dépend de l'usage, et vous pouvez définir des limites de dépense mensuelles dans votre",
  "zen.faq.a4.p2.accountLink": "compte",
  "zen.faq.a4.p3":
    "Pour couvrir les coûts, OpenCode ajoute uniquement de petits frais de traitement de paiement de 1,23 $ par recharge de 20 $.",
  "zen.faq.q5": "Et pour les données et la confidentialité ?",
  "zen.faq.a5.beforeExceptions":
    "Tous les modèles Zen sont hébergés aux États-Unis et dans l'UE. Les fournisseurs appliquent une politique de rétention zéro et n'utilisent pas vos données pour l'entraînement des modèles, avec les",
  "zen.faq.a5.exceptionsLink": "exceptions suivantes",
  "zen.faq.q6": "Puis-je définir des limites de dépense ?",
  "zen.faq.a6": "Oui, vous pouvez définir des limites de dépense mensuelles dans votre compte.",
  "zen.faq.q7": "Puis-je annuler ?",
  "zen.faq.a7": "Oui, vous pouvez désactiver la facturation à tout moment et utiliser votre solde restant.",
  "zen.faq.q8": "Puis-je utiliser Zen avec d'autres agents de code ?",
  "zen.faq.a8":
    "Zen fonctionne très bien avec OpenCode, mais vous pouvez utiliser Zen avec n'importe quel agent. Suivez les instructions de configuration dans votre agent préféré.",
  "zen.faq.q9": "Puis-je obtenir un remboursement ?",
  "zen.faq.a9":
    "Vous pourriez avoir droit à un remboursement si le paiement a été effectué au cours des 14 derniers jours et que vous n’avez pas utilisé le crédit de cet achat. {{contact}} pour demander un remboursement.",

  "zen.cta.start": "Commencez avec Zen",
  "zen.pricing.title": "Ajoutez 20 $ de solde Pay as you go",
  "zen.pricing.fee": "(+1,23 $ de frais de traitement de carte)",
  "zen.pricing.body":
    "Utilisez avec n'importe quel agent. Fixez des limites de dépenses mensuelles. Annulez à tout moment.",
  "zen.problem.title": "Quel problème Zen résout-il ?",
  "zen.problem.body":
    "Il existe de nombreux modèles disponibles, mais seuls quelques-uns fonctionnent bien avec les agents de code. La plupart des fournisseurs les configurent différemment avec des résultats variables.",
  "zen.problem.subtitle":
    "Nous résolvons ce problème pour tout le monde, pas seulement pour les utilisateurs de OpenCode.",
  "zen.problem.item1": "Test des modèles sélectionnés et consultation de leurs équipes",
  "zen.problem.item2": "Collaboration avec les fournisseurs pour garantir une livraison correcte",
  "zen.problem.item3": "Benchmark de toutes les combinaisons modèle-fournisseur que nous recommandons",
  "zen.how.title": "Comment fonctionne Zen",
  "zen.how.body":
    "Bien que nous vous suggérions d'utiliser Zen avec OpenCode, vous pouvez utiliser Zen avec n'importe quel agent.",
  "zen.how.step1.title": "Inscrivez-vous et ajoutez un solde de 20 $",
  "zen.how.step1.beforeLink": "suivez les",
  "zen.how.step1.link": "instructions de configuration",
  "zen.how.step2.title": "Utilisez Zen avec une tarification transparente",
  "zen.how.step2.link": "payez par requête",
  "zen.how.step2.afterLink": "sans marge",
  "zen.how.step3.title": "Recharge automatique",
  "zen.how.step3.body":
    "activez la recharge automatique facultative et choisissez le seuil de solde et le montant de la recharge",
  "zen.privacy.title": "Votre vie privée est importante pour nous",
  "zen.privacy.beforeExceptions":
    "Tous les modèles Zen sont hébergés aux États-Unis et dans l'UE. Les fournisseurs suivent une politique de rétention zéro et n'utilisent pas vos données pour l'entraînement des modèles, avec les",
  "zen.privacy.exceptionsLink": "exceptions suivantes",

  "go.promo.kimiK31Pro": "Kimi K3.1 Pro est désormais disponible dans Go.",
  "go.title": "OpenCode Go | Modèles de code à faible coût pour tous",
  "go.meta.description":
    "Go coûte 10 $/mois, avec des limites d'utilisation généreuses et un accès fiable aux principaux modèles de codage.",
  "go.hero.title": "Modèles de code à faible coût pour tous",
  "go.hero.tagline": "Utilisable avec n'importe quel agent. Rechargez du crédit si besoin. Résiliez à tout moment.",
  "go.hero.body":
    "Go apporte le codage agentique aux programmeurs du monde entier. Offrant des limites généreuses et un accès fiable aux modèles open source les plus capables, pour que vous puissiez construire avec des agents puissants sans vous soucier du coût ou de la disponibilité.",

  "go.cta.text": "S'abonner à Go",
  "go.plans.audience": "Offres Go pour",
  "go.plans.individuals": "Individuels",
  "go.plans.teams": "Équipes",
  "go.plans.month": "par mois",
  "go.plans.memberMonth": "par membre\net par mois",
  "go.plans.plus.cta": "S'abonner à Go Plus",
  "go.plans.plus.description": "Go Plus coûte 40 $/mois et offre des limites plus élevées.",
  "go.plans.teams.cta": "S'abonner à Go Teams",
  "go.plans.teams.description": "Go Teams coûte 20 $/membre/mois avec des limites pour chaque membre.",
  "go.plans.go.feature1": "Modèles sélectionnés et abordables",
  "go.plans.go.feature2": "Testés pour le codage agentique",
  "go.plans.go.feature3": "Limites généreuses et accès fiable",
  "go.plans.plus.feature1": "Tous les avantages de Go",
  "go.plans.plus.feature2": "Des limites plus élevées pour coder plus longtemps sans perdre le fil",
  "go.plans.plus.feature3": "Pour les projets plus vastes et exigeants",
  "go.plans.teams.feature1": "Chaque membre dispose de ses propres limites Go",
  "go.plans.teams.feature2": "Limites mensuelles généreuses pour chaque modèle",
  "go.plans.teams.feature3": "Une seule facture pour tout l'espace de travail",
  "go.plans.teams.feature4": "Utilisation supplémentaire avec budgets par membre",
  "go.plans.teams.feature5": "Contrôles de confidentialité et de région des modèles",
  "go.plans.limits": "Limites",
  "go.plans.description": "Requêtes estimées par 5 heures et limites mensuelles par modèle",
  "go.plans.legend": "Offres",
  "go.graph.period": "Utilisation",
  "go.graph.model": "Modèle",
  "go.graph.requests": "Requêtes estimées / 5 h",
  "go.graph.allowance": "Utilisation mensuelle",
  "go.graph.new": "Nouveau",
  "go.graph.bonus": "{{count}}× d’utilisation",
  "go.graph.scale": "Échelle non linéaire des requêtes",
  "go.graph.showAll": "Voir les {{count}} modèles",
  "go.graph.showLess": "Afficher moins de modèles",
  "go.graph.limitedRegions": "régions limitées",
  "go.graph.limitedTime": "durée limitée",
  "go.graph.usageLimits": "Limites d’utilisation",

  "go.problem.title": "Quel problème Go résout-il ?",
  "go.problem.body":
    "Nous nous efforçons d'apporter l'expérience OpenCode au plus grand nombre. OpenCode Go est un abonnement à faible coût de 10 $/mois. Il offre des limites généreuses et un accès fiable aux modèles open source les plus performants.",
  "go.problem.item1": "Prix d'abonnement bas",
  "go.problem.item2": "Limites généreuses et accès fiable",
  "go.problem.item3": "Conçu pour autant de programmeurs que possible",
  "go.problem.item4": "Une sélection de modèles testés pour le codage agentique",
  "go.how.title": "Comment fonctionne Go",
  "go.how.body": "Go coûte 10 $/mois. Vous pouvez l'utiliser avec OpenCode ou n'importe quel agent.",
  "go.how.step1.title": "Créez un compte",
  "go.how.step1.beforeLink": "suivez les",
  "go.how.step1.link": "instructions de configuration",
  "go.how.step2.title": "Abonnez-vous à Go",
  "go.how.step2.link": "10 $/mois",
  "go.how.step2.afterLink": "avec des limites généreuses",
  "go.how.step3.title": "Commencez à coder",
  "go.how.step3.body": "avec un accès fiable aux modèles open source",
  "go.faq.q1": "Qu'est-ce que OpenCode Go ?",
  "go.faq.a1":
    "Go est un abonnement à faible coût qui vous donne un accès fiable à des modèles open source performants pour le codage agentique.",
  "go.faq.q2": "Quels modèles Go inclut-il ?",
  "go.faq.a2": "Go inclut les modèles ci-dessous, avec des limites généreuses et un accès fiable.",
  "go.faq.q3": "Est-ce que Go est la même chose que Zen ?",
  "go.faq.a3":
    "Non. Zen est un paiement à l'utilisation, tandis que Go coûte 10 $/mois, avec des limites généreuses et un accès fiable à une sélection de modèles.",
  "go.faq.q4": "Combien coûte Go ?",
  "go.faq.a4.p1.beforePricing": "Go coûte",
  "go.faq.a4.p1.pricingLink": "10 $/mois",
  "go.faq.a4.p1.afterPricing": "avec des limites généreuses.",
  "go.faq.a4.p2.beforeAccount": "Vous pouvez gérer votre abonnement dans votre",
  "go.faq.a4.p2.accountLink": "compte",
  "go.faq.a4.p3": "Annulez à tout moment.",
  "go.faq.q5": "Et pour les données et la confidentialité ?",
  "go.faq.a5.model": "Modèle",
  "go.faq.a5.training": "Entraînement des modèles",
  "go.faq.a5.retention": "Conservation des données",
  "go.faq.a5.retention30": "30 jours",
  "go.faq.a5.retention0": "0 jour",
  "go.faq.a5.used": "Utilisé",
  "go.faq.a5.notUsed": "Non utilisé",
  "go.faq.a5.notZdr": "Pas de ZDR",
  "go.faq.a5.grokRetention":
    "Le ZDR désactive d'importantes fonctionnalités API qui dépendent des données stockées, notamment Responses API avec état, Files and Collections et Batch API.",
  "go.faq.a5.gptRetention":
    "Des journaux de surveillance des abus sont générés pour toute utilisation des fonctionnalités API et conservés pendant un maximum de 30 jours.",
  "go.faq.a5.museRetention":
    "Des tarifs de tokens fortement réduits en échange de l’autorisation d’utiliser vos prompts et vos complétions pour entraîner de futurs modèles Meta.",
  "go.faq.a5.learnMore": "En savoir plus",
  "go.faq.a5.deepseekRetention":
    "L’accord ZDR est renouvelé chaque mois. L’accord actuel est valable jusqu’au 31 octobre 2026.",

  "go.faq.q6": "Puis-je recharger mon crédit ?",
  "go.faq.a6": "Si vous avez besoin de plus d'utilisation, vous pouvez recharger du crédit dans votre compte.",
  "go.faq.q7": "Puis-je annuler ?",
  "go.faq.a7": "Oui, vous pouvez annuler à tout moment.",
  "go.faq.q8": "Puis-je utiliser Go avec d'autres agents de code ?",
  "go.faq.a8":
    "Oui, vous pouvez utiliser Go avec n'importe quel agent. Suivez les instructions de configuration dans votre agent de code préféré.",
  "go.faq.q9": "Quelle est la différence entre les modèles gratuits et Go ?",
  "go.faq.a9":
    "Les modèles gratuits incluent Big Pickle ainsi que les modèles promotionnels disponibles à ce moment-là. Go propose une sélection de modèles avec des quotas de requêtes plus élevés sur des fenêtres glissantes : 20 % du quota mensuel par 5 heures, 50 % par semaine et 100 % par mois. Les quotas propres à chaque modèle peuvent varier (le nombre réel de requêtes varie selon le modèle et l'utilisation).",
  "go.faq.q10": "Puis-je obtenir un remboursement ?",
  "go.faq.a10":
    "Vous pourriez avoir droit à un remboursement si le paiement a été effectué au cours des 14 derniers jours et que vous n’avez pas utilisé votre quota Go pendant cette période de facturation. {{contact}} pour demander un remboursement.",

  "download.title": "OpenCode | Téléchargement",
  "download.meta.description": "Téléchargez OpenCode pour macOS, Windows et Linux",
  "download.section.terminal": "OpenCode Terminal",
  "download.section.desktop": "OpenCode Desktop",
  "download.section.extensions": "Extensions OpenCode",
  "download.section.integrations": "Intégrations OpenCode",
  "download.action.download": "Télécharger",
  "download.action.install": "Installer",

  "download.platform.macosAppleSilicon": "macOS (Apple Silicon)",
  "download.platform.macosIntel": "macOS (Intel)",
  "download.platform.windowsX64": "Windows (x64)",
  "download.platform.windowsArm64": "Windows (ARM64)",
  "download.platform.linuxDeb": "Linux (.deb)",
  "download.platform.linuxRpm": "Linux (.rpm)",

  "download.faq.a3.beforeLocal":
    "Pas forcément, mais probablement. Vous aurez besoin d'un abonnement IA si vous voulez connecter OpenCode à un fournisseur payant, mais vous pouvez travailler avec des",
  "download.faq.a3.localLink": "modèles locaux",
  "download.faq.a3.afterLocal.beforeZen": "gratuitement. Même si nous encourageons les utilisateurs à utiliser",
  "download.faq.a3.afterZen":
    ", OpenCode fonctionne avec tous les fournisseurs populaires comme OpenAI, Anthropic, xAI, etc.",

  "download.faq.a5.p1": "OpenCode est 100% gratuit à utiliser.",
  "download.faq.a5.p2.beforeZen":
    "Les coûts supplémentaires viendront de votre abonnement à un fournisseur de modèle. Même si OpenCode fonctionne avec n'importe quel fournisseur, nous recommandons d'utiliser",
  "download.faq.a5.p2.afterZen": ".",

  "enterprise.title": "OpenCode | Solutions entreprise pour votre organisation",
  "enterprise.meta.description": "Contactez OpenCode pour des solutions entreprise",
  "enterprise.hero.title": "Votre code vous appartient",
  "enterprise.hero.body1":
    "OpenCode fonctionne de manière sécurisée au sein de votre organisation, sans stocker de données ni de contexte, et sans restrictions de licence ni revendications de propriété. Démarrez un essai avec votre équipe, puis déployez-le dans votre organisation en l'intégrant à votre SSO et à votre passerelle IA interne.",
  "enterprise.hero.body2": "Dites-nous comment nous pouvons vous aider.",
  "enterprise.form.name.label": "Nom complet",
  "enterprise.form.name.placeholder": "Jeff Bezos",
  "enterprise.form.role.label": "Poste",
  "enterprise.form.role.placeholder": "Président exécutif",
  "enterprise.form.company.label": "Entreprise",
  "enterprise.form.company.placeholder": "Acme Inc",
  "enterprise.form.email.label": "E-mail professionnel",
  "enterprise.form.email.placeholder": "jeff@amazon.com",
  "enterprise.form.phone.label": "Téléphone",
  "enterprise.form.phone.placeholder": "+1 234 567 8900",
  "enterprise.form.inferenceSpend.label":
    "Quelles sont les dépenses mensuelles actuelles de votre entreprise en inférence (USD) ?",
  "enterprise.form.inferenceSpend.placeholder": "Sélectionnez une tranche (facultatif)",
  "enterprise.form.inferenceSpend.none": "Aucune dépense pour l'instant",
  "enterprise.form.inferenceSpend.under1k": "Moins de $1K",
  "enterprise.form.inferenceSpend.1kTo10k": "$1K–$10K",
  "enterprise.form.inferenceSpend.10kTo50k": "$10K–$50K",
  "enterprise.form.inferenceSpend.50kTo100k": "$50K–$100K",
  "enterprise.form.inferenceSpend.over100k": "$100K ou plus",
  "enterprise.form.message.label": "Quel problème essayez-vous de résoudre ?",
  "enterprise.form.message.placeholder": "Nous avons besoin d'aide pour...",
  "enterprise.form.send": "Envoyer",
  "enterprise.form.sending": "Envoi...",
  "enterprise.form.success": "Message envoyé, nous vous contacterons bientôt.",
  "enterprise.form.success.submitted": "Formulaire soumis avec succès.",
  "enterprise.form.error.allFieldsRequired": "Tous les champs sont requis.",
  "enterprise.form.error.invalidEmailFormat": "Format d'e-mail invalide.",
  "enterprise.form.error.invalidInferenceSpend": "Sélectionnez une tranche de dépenses d'inférence valide.",
  "enterprise.form.error.internalServer": "Erreur interne du serveur.",
  "enterprise.form.error.captcha": "La vérification captcha a échoué. Veuillez réessayer.",
  "enterprise.faq.title": "FAQ",
  "enterprise.faq.q1": "Qu'est-ce que OpenCode Enterprise ?",
  "enterprise.faq.a1":
    "OpenCode Enterprise s'adresse aux organisations qui veulent s'assurer que leur code et leurs données ne quittent jamais leur infrastructure. Cela est possible grâce à une configuration centralisée qui s'intègre à votre SSO et à votre passerelle IA interne.",
  "enterprise.faq.q2": "Comment démarrer avec OpenCode Enterprise ?",
  "enterprise.faq.a2":
    "Commencez simplement par un essai interne avec votre équipe. Par défaut, OpenCode ne stocke pas votre code ni vos données de contexte, ce qui facilite la prise en main. Ensuite, contactez-nous pour discuter des tarifs et des options de mise en œuvre.",
  "enterprise.faq.q3": "Comment fonctionne la tarification entreprise ?",
  "enterprise.faq.a3":
    "Si vous avez votre propre passerelle LLM, nous ne facturons pas les tokens utilisés. Pour plus de détails, contactez-nous pour un devis sur mesure en fonction des besoins de votre organisation.",
  "enterprise.faq.q4": "Mes données sont-elles sécurisées avec OpenCode Enterprise ?",
  "enterprise.faq.a4":
    "Oui. OpenCode ne stocke pas votre code ni vos données de contexte. Tout le traitement se fait localement ou via des appels API directs vers votre fournisseur d'IA. Avec une configuration centralisée et une intégration SSO, vos données restent sécurisées au sein de l'infrastructure de votre organisation.",

  "brand.title": "OpenCode | Marque",
  "brand.meta.description": "Guide de marque OpenCode",
  "brand.heading": "Guide de marque",
  "brand.subtitle": "Ressources et éléments pour vous aider à travailler avec la marque OpenCode.",
  "brand.downloadAll": "Télécharger tous les assets",

  "changelog.title": "OpenCode | Changelog",
  "changelog.meta.description": "Notes de version et changelog d'OpenCode",
  "changelog.hero.title": "Changelog",
  "changelog.hero.subtitle": "Nouvelles mises à jour et améliorations pour OpenCode",
  "changelog.empty": "Aucune entrée de changelog trouvée.",
  "changelog.viewJson": "Voir le JSON",
} satisfies Dict
