---
title: Solución de problemas
description: Problemas comunes y cómo resolverlos.
---

Para depurar problemas con OpenCode, comience verificando los registros y los datos locales que almacena en el disco.

---

## Registros

Los archivos de registro se escriben en:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Presione `WIN+R` y pegue `%USERPROFILE%\.local\share\opencode\log`

Los archivos de registro reciben nombres con marcas de tiempo (por ejemplo, `2025-01-09T123456.log`) y se conservan los 10 archivos de registro más recientes.

Puede configurar el nivel de registro con la opción de línea de comandos `--log-level` para obtener información de depuración más detallada. Por ejemplo, `opencode --log-level DEBUG`.

---

## Almacenamiento

opencode almacena datos de sesión y otros datos de aplicaciones en el disco en:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Presione `WIN+R` y pegue `%USERPROFILE%\.local\share\opencode`

Este directorio contiene:

- `auth.json` - Datos de autenticación como API claves, OAuth tokens
- `log/` - Registros de aplicaciones
- `project/` - Datos específicos del proyecto, como datos de sesión y mensajes.
  - Si el proyecto está dentro de un repositorio de Git, se almacena en `./<project-slug>/storage/`
  - Si no es un repositorio de Git, se almacena en `./global/storage/`

---

## Aplicación de escritorio

OpenCode Desktop ejecuta un servidor OpenCode local (el sidecar `opencode-cli`) en segundo plano. La mayoría de los problemas se deben a un complemento que no funciona correctamente, una memoria caché dañada o una mala configuración del servidor.

### Comprobaciones rápidas

- Salga por completo y reinicie la aplicación.
- Si la aplicación muestra una pantalla de error, haga clic en **Reiniciar** y copie los detalles del error.
- Solo macOS: menú `OpenCode` -> **Recargar vista web** (ayuda si la interfaz de usuario está en blanco/congelada).

---

### Deshabilitar complementos

Si la aplicación de escritorio falla al iniciarse, se bloquea o se comporta de manera extraña, comience por deshabilitar los complementos.

#### Verifique la configuración global

Abra su archivo de configuración global y busque una clave `plugin`.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (o `~/.config/opencode/opencode.json`)
- **macOS/Linux** (instalaciones anteriores): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Presione `WIN+R` y pegue `%USERPROFILE%\.config\opencode\opencode.jsonc`

Si tiene complementos configurados, desactívelos temporalmente eliminando la clave o configurándola en una matriz vacía:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Verificar directorios de complementos

OpenCode también puede cargar complementos locales desde el disco. Quítelos temporalmente del camino (o cambie el nombre de la carpeta) y reinicie la aplicación de escritorio:

- **Complementos globales**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Presione `WIN+R` y pegue `%USERPROFILE%\.config\opencode\plugins`
- **Complementos de proyecto** (solo si usas la configuración por proyecto)
  - `<your-project>/.opencode/plugins/`

Si la aplicación comienza a funcionar nuevamente, vuelva a habilitar los complementos uno a la vez para encontrar cuál está causando el problema.

---

### Borrar el caché

Si deshabilitar los complementos no ayuda (o la instalación de un complemento está bloqueada), borre el caché para que OpenCode pueda reconstruirlo.

1. Salga de OpenCode Desktop por completo.
2. Elimine el directorio de caché:

- **macOS**: Buscador -> `Cmd+Shift+G` -> pegar `~/.cache/opencode`
- **Linux**: eliminar `~/.cache/opencode` (o ejecutar `rm -rf ~/.cache/opencode`)
- **Windows**: Presione `WIN+R` y pegue `%USERPROFILE%\.cache\opencode`

3. Reinicie el escritorio OpenCode.

---

### Solucionar problemas de conexión del servidor

OpenCode Desktop puede iniciar su propio servidor local (predeterminado) o conectarse a la URL de un servidor que haya configurado.

Si ve un cuadro de diálogo **"Error de conexión"** (o la aplicación nunca pasa de la pantalla de inicio), busque una URL de servidor personalizada.

#### Borrar la URL del servidor predeterminado del escritorio

Desde la pantalla de inicio, haga clic en el nombre del servidor (con el punto de estado) para abrir el selector de servidor. En la sección **Servidor predeterminado**, haga clic en **Borrar**.

#### Elimina `server.port` / `server.hostname` de tu configuración

Si su `opencode.json(c)` contiene una sección `server`, elimínela temporalmente y reinicie la aplicación de escritorio.

#### Verificar variables de entorno

Si tiene `OPENCODE_PORT` configurado en su entorno, la aplicación de escritorio intentará usar ese puerto para el servidor local.

- Desarme `OPENCODE_PORT` (o elija un puerto libre) y reinicie.

---

### Linux: Problemas con Wayland/X11

En Linux, algunas configuraciones de Wayland pueden causar ventanas en blanco o errores de compositor.

- Si estás en Wayland y la aplicación está en blanco o falla, intenta iniciarla con `OC_ALLOW_WAYLAND=1`.
- Si eso empeora las cosas, elimínelo e intente iniciarlo en una sesión X11.

---

### Windows: tiempo de ejecución de WebView2

En Windows, el escritorio OpenCode requiere Microsoft Edge **WebView2 Runtime**. Si la aplicación se abre en una ventana en blanco o no se inicia, instale/actualice WebView2 e inténtelo nuevamente.

---

### Windows: Problemas generales de rendimiento

Si tiene un rendimiento lento, problemas de acceso a archivos o problemas de terminal en Windows, intente usar [WSL (Windows Subsistema para Linux)](/docs/windows-wsl). WSL proporciona un entorno Linux que funciona de manera más fluida con las funciones de OpenCode.

---

### Notificaciones que no se muestran

OpenCode Desktop solo muestra notificaciones del sistema cuando:

- las notificaciones están habilitadas para OpenCode en la configuración de su sistema operativo, y
- la ventana de la aplicación no está enfocada.

---

### Restablecer el almacenamiento de la aplicación de escritorio (último recurso)

Si la aplicación no se inicia y no puede borrar la configuración desde la interfaz de usuario, restablezca el estado guardado de la aplicación de escritorio.

1. Salga del escritorio OpenCode.
2. Busque y elimine estos archivos (se encuentran en el directorio de datos de la aplicación de escritorio OpenCode):

- `opencode.settings.dat` (URL del servidor predeterminado de escritorio)
- `opencode.global.dat` y `opencode.workspace.*.dat` (estado de la interfaz de usuario como servidores/proyectos recientes)

Para encontrar el directorio rápidamente:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (luego busque los nombres de archivo arriba)
- **Linux**: busque en `~/.local/share` los nombres de archivo anteriores
- **Windows**: Presione `WIN+R` -> `%APPDATA%` (luego busque los nombres de archivo arriba)

---

## Obtener ayuda

Si tiene problemas con OpenCode:

1. **Informar problemas el GitHub**

   La mejor manera de informar errores o solicitar funciones es a través de nuestro repositorio GitHub:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Antes de crear un nuevo problema, busque los problemas existentes para ver si su problema ya ha sido informado.

2. **Únete a nuestro Discord**

   Para obtener ayuda en tiempo real y debates comunitarios, únase a nuestro servidor de Discord:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Problemas comunes

A continuación se detallan algunos problemas comunes y cómo resolverlos.

---

### OpenCode no se inicia

1. Verifique los registros en busca de mensajes de error.
2. Intente ejecutar con `--print-logs` para ver el resultado en la terminal.
3. Asegúrese de tener la última versión con `opencode upgrade`

---

### Problemas de autenticación

1. Intente volver a autenticarse con el comando `/connect` en TUI
2. Verifique que sus claves API sean válidas
3. Asegúrese de que su red permita conexiones al API del proveedor.

---

### Modelo no disponible

1. Comprueba que te has autenticado con el proveedor.
2. Verifique que el nombre del modelo en su configuración sea correcto
3. Algunos modelos pueden requerir acceso o suscripciones específicas

Si encuentra `ProviderModelNotFoundError`, lo más probable es que esté equivocado.
haciendo referencia a un modelo en alguna parte.
Se debe hacer referencia a los modelos así: `<providerId>/<modelId>`

Ejemplos:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Para saber a qué modelos tiene acceso, ejecute `opencode models`

---

### Error de inicio del proveedor

Si encuentra un ProviderInitError, es probable que tenga una configuración no válida o dañada.

Para resolver esto:

1. Primero, verifique que su proveedor esté configurado correctamente siguiendo la [guía de proveedores](/docs/providers)
2. Si el problema persiste, intente borrar la configuración almacenada:

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   En Windows, presione `WIN+R` y elimine: `%USERPROFILE%\.local\share\opencode`

3. Vuelva a autenticarse con su proveedor utilizando el comando `/connect` en TUI.

---

### AI_APICallError y problemas con el paquete del proveedor

Si encuentra errores de llamada API, esto puede deberse a paquetes de proveedores obsoletos. opencode instala dinámicamente paquetes de proveedores (OpenAI, Anthropic, Google, etc.) según sea necesario y los almacena en caché localmente.

Para resolver problemas con el paquete del proveedor:

1. Borre la caché del paquete del proveedor:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   En Windows, presione `WIN+R` y elimine: `%USERPROFILE%\.cache\opencode`

2. Reinicie opencode para reinstalar los paquetes del proveedor más recientes.

Esto obligará a opencode a descargar las versiones más recientes de los paquetes del proveedor, lo que a menudo resuelve problemas de compatibilidad con los parámetros del modelo y los cambios de API.

---

### Copiar/pegar no funciona en Linux

Los usuarios de Linux deben tener instalada una de las siguientes utilidades del portapapeles para que funcione la función copiar/pegar:

**Para sistemas X11:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Para sistemas Wayland:**

```bash
apt install -y wl-clipboard
```

**Para entornos sin cabeza:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode detectará si estás usando Wayland y prefieres `wl-clipboard`; de lo contrario, intentará encontrar herramientas del portapapeles en el orden de: `xclip` y `xsel`.
