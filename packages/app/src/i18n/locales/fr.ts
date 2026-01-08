export default {
  common: {
    loading: "Chargement...",
    save: "Enregistrer",
    cancel: "Annuler",
    confirm: "Confirmer",
    delete: "Supprimer",
    edit: "Modifier",
    search: "Rechercher",
    back: "Retour",
    next: "Suivant",
    close: "Fermer",
  },
  home: {
    title: "OpenCode AI",
    subtitle: "Outil de développement alimenté par l'IA",
    start: "Commencer à coder",
    recentProjects: "Projets récents",
    noRecentProjects: "Aucun projet récent",
    getStarted: "Ouvrez un projet local pour commencer",
    openProject: "Ouvrir un projet",
  },
  session: {
    new: "Nouvelle session",
    newSession: "Nouvelle session",
    mainBranch: "Branche principale",
    mainBranchWithName: "Branche principale ({branch})",
    createWorktree: "Créer un nouvel arbre de travail",
    lastModified: "Dernière modification",
    backToParent: "Retour à la session parente",
    share: "Partager la session",
    terminate: "Terminer",
    archive: "Archiver la session",
    filesChanged: "{count} fichier{plural} modifié{plural}",
  },
  dialog: {
    selectProvider: {
      title: "Sélectionner un fournisseur",
      description: "Choisir un fournisseur d'IA à utiliser",
    },
    selectModel: {
      title: "Sélectionner un modèle",
      description: "Choisir un modèle à utiliser",
      unpaid: {
        title: "Paiement du modèle requis",
        description: "Ce modèle nécessite un paiement pour être utilisé",
      },
    },
    selectServer: {
      title: "Sélectionner un serveur",
      description: "Choisir un serveur auquel se connecter",
    },
    selectDirectory: {
      title: "Sélectionner un répertoire",
      description: "Choisir un répertoire avec lequel travailler",
      openProject: "Ouvrir un projet",
    },
    selectFile: {
      title: "Sélectionner un fichier",
      description: "Choisir un fichier avec lequel travailler",
    },
    selectMcp: {
      title: "Sélectionner un MCP",
      description: "Choisir un serveur Model Context Protocol",
    },
    connectProvider: {
      title: "Connecter un fournisseur",
      description: "Configurer vos identifiants de fournisseur d'IA",
    },
    editProject: {
      title: "Modifier le projet",
      description: "Modifier les paramètres du projet",
      editProject: "Modifier le projet",
      closeProject: "Fermer le projet",
    },
    manageModels: {
      title: "Gérer les modèles",
      description: "Gérer les modèles disponibles",
    },
  },
  terminal: {
    tabs: {
      session: "Session",
      context: "Contexte",
      lsp: "LSP",
      mcp: "MCP",
    },
  },
  fileTree: {
    empty: "Aucun fichier trouvé",
    refresh: "Actualiser",
  },
  sidebar: {
    toggle: "Afficher/Masquer la barre latérale",
    newSession: "Nouvelle session",
    loadMore: "Charger plus",
    gettingStarted: "Premiers pas",
    gettingStartedDesc1: "OpenCode inclut des modèles gratuits pour que vous puissiez commencer immédiatement.",
    gettingStartedDesc2: "Connectez n'importe quel fournisseur pour utiliser des modèles, y compris Claude, GPT, Gemini, etc.",
    connectProvider: "Connecter un fournisseur",
    shareFeedback: "Partager des commentaires",
    changeLanguage: "Changer de langue",
  },
  layout: {
    editProject: "Modifier le projet",
    closeProject: "Fermer le projet",
  },
} as const
