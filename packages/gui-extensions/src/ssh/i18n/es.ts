export default {
  label: "SSH",
  placeholder: "ssh user@example.com",
  add: "Agregar servidor SSH",
  "server.menu.label": "Servidor SSH",
  target: "Comando host o SSH",
  connect: "Conectar",
  connectTo: "Conéctese a {{host}}",
  authenticate: "Autenticación SSH",
  "session.disconnected": "Conexión SSH inactiva",
  "session.connecting": "Conexión al servidor SSH",
  "session.reconnectDescription":
    "Vuelva a conectarse para ver esta sesión y continuar trabajando. Su sesión remota se conserva.",
  "session.reconnect": "Reconectar",
  trust: "Confía y conecta",
  continue: "Continuar",
  update: "Actualizar y volver a conectar",
  project: "Abrir proyecto en {{host}}",
  "stage.incompatible": "Se requiere actualización del servidor",
  "error.input":
    "Ingrese un comando de conexión de host o SSH. No se permiten comandos remotos ni opciones de SSH no compatibles.",
  "error.connection": "No se pudo establecer la conexión SSH. Verifique su red y la configuración de SSH.",
  "error.platform":
    "Esta plataforma remota no es compatible. La configuración automática actualmente requiere Linux o macOS en x64 o arm64.",
  "error.version": "El servicio remoto debe coincidir con esta versión de escritorio antes de conectarse.",
  "error.install":
    "No se pudo instalar el servidor remoto. Verifique la conectividad, el espacio en disco y que tar esté instalado.",
  "error.unpublished":
    "Esta versión de escritorio no tiene ningún servidor remoto publicado. Para compilaciones de desarrollo, instale e inicie V2 en el host y luego vuelva a intentarlo.",
  "error.service": "SSH se conectó, pero el servidor OpenCode no estuvo listo.",
  "error.host-key":
    "No se pudo verificar la identidad del anfitrión. Verifique su huella digital antes de actualizar sus hosts conocidos SSH.",
  "error.ssh-missing":
    "No se encontró OpenSSH. Instale un cliente OpenSSH y asegúrese de que ssh esté disponible en PATH.",
  "action.authenticate": "autenticar",
  "stage.connecting": "Conectando a través de SSH…",
  "stage.authentication": "Se requiere autenticación",
  "form.name": "Nombre del servidor (opcional)",
  "form.namePlaceholder": "Localhost",
  "form.add": "Añadir servidor",
  "server.default": "Predeterminado",
  "menu.default": "Establecer como predeterminado",
  "menu.defaultRemove": "Quitar como predeterminado",
  "menu.delete": "Eliminar",
}
