export default {
  common: {
    loading: "Cargando...",
    save: "Guardar",
    cancel: "Cancelar",
    confirm: "Confirmar",
    delete: "Eliminar",
    edit: "Editar",
    search: "Buscar",
    back: "Atrás",
    next: "Siguiente",
    close: "Cerrar",
  },
  home: {
    title: "OpenCode AI",
    subtitle: "Herramienta de desarrollo impulsada por IA",
    start: "Comenzar a codificar",
    recentProjects: "Proyectos recientes",
    noRecentProjects: "Sin proyectos recientes",
    getStarted: "Abre un proyecto local para comenzar",
    openProject: "Abrir proyecto",
  },
  session: {
    new: "Nueva sesión",
    newSession: "Nueva sesión",
    mainBranch: "Rama principal",
    mainBranchWithName: "Rama principal ({branch})",
    createWorktree: "Crear nuevo árbol de trabajo",
    lastModified: "Última modificación",
    backToParent: "Volver a la sesión principal",
    share: "Compartir sesión",
    terminate: "Terminar",
    archive: "Archivar sesión",
    filesChanged: "{count} archivo{plural} modificado{plural}",
  },
  dialog: {
    selectProvider: {
      title: "Seleccionar proveedor",
      description: "Elige un proveedor de IA para usar",
    },
    selectModel: {
      title: "Seleccionar modelo",
      description: "Elige un modelo para usar",
      unpaid: {
        title: "Pago del modelo requerido",
        description: "Este modelo requiere pago para usarse",
      },
    },
    selectServer: {
      title: "Seleccionar servidor",
      description: "Elige un servidor al cual conectarse",
    },
    selectDirectory: {
      title: "Seleccionar directorio",
      description: "Elige un directorio con el cual trabajar",
      openProject: "Abrir proyecto",
    },
    selectFile: {
      title: "Seleccionar archivo",
      description: "Elige un archivo con el cual trabajar",
    },
    selectMcp: {
      title: "Seleccionar MCP",
      description: "Elige un servidor Model Context Protocol",
    },
    connectProvider: {
      title: "Conectar proveedor",
      description: "Configura tus credenciales de proveedor de IA",
    },
    editProject: {
      title: "Editar proyecto",
      description: "Edita la configuración del proyecto",
      editProject: "Editar proyecto",
      closeProject: "Cerrar proyecto",
    },
    manageModels: {
      title: "Administrar modelos",
      description: "Administra los modelos disponibles",
    },
  },
  terminal: {
    tabs: {
      session: "Sesión",
      context: "Contexto",
      lsp: "LSP",
      mcp: "MCP",
    },
  },
  fileTree: {
    empty: "No se encontraron archivos",
    refresh: "Actualizar",
  },
  sidebar: {
    toggle: "Alternar barra lateral",
    newSession: "Nueva sesión",
    loadMore: "Cargar más",
    gettingStarted: "Comenzando",
    gettingStartedDesc1: "OpenCode incluye modelos gratuitos para que puedas comenzar de inmediato.",
    gettingStartedDesc2: "Conecta cualquier proveedor para usar modelos, incl. Claude, GPT, Gemini, etc.",
    connectProvider: "Conectar proveedor",
    shareFeedback: "Comentar comentarios",
    changeLanguage: "Cambiar idioma",
  },
  layout: {
    editProject: "Editar proyecto",
    closeProject: "Cerrar proyecto",
  },
} as const
