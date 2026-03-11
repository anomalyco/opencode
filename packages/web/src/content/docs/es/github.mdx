---
title: GitHub
description: Utilice OpenCode en problemas y solicitudes de extracción de GitHub.
---

OpenCode se integra con su flujo de trabajo GitHub. Mencione `/opencode` o `/oc` en su comentario y OpenCode ejecutará tareas dentro de su corredor de acciones GitHub.

---

## Características

- **Clasificación de problemas**: Pídele a OpenCode que investigue un problema y te lo explique.
- **Reparar e implementar**: pídale a OpenCode que solucione un problema o implemente una función. Y funcionará en una nueva sucursal y enviará un PR con todos los cambios.
- **Seguro**: OpenCode se ejecuta dentro de los corredores de tu GitHub.

---

## Instalación

Ejecute el siguiente comando en un proyecto que se encuentra en un repositorio GitHub:

```bash
opencode github install
```

Esto lo guiará a través de la instalación de la aplicación GitHub, la creación del flujo de trabajo y la configuración de secretos.

---

### Configuración manual

O puede configurarlo manualmente.

1. **Instale la aplicación GitHub**

   Dirígete a [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Asegúrese de que esté instalado en el repositorio de destino.

2. **Agregar el flujo de trabajo**

   Agregue el siguiente archivo de flujo de trabajo a `.github/workflows/opencode.yml` en su repositorio. Asegúrese de configurar las claves `model` apropiadas y API requeridas en `env`.

   ```yml title=".github/workflows/opencode.yml" {24,26}
   name: opencode

   on:
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]

   jobs:
     opencode:
       if: |
         contains(github.event.comment.body, '/oc') ||
         contains(github.event.comment.body, '/opencode')
       runs-on: ubuntu-latest
       permissions:
         id-token: write
       steps:
          - name: Checkout repository
            uses: actions/checkout@v6
            with:
              fetch-depth: 1
              persist-credentials: false

          - name: Run OpenCode
           uses: anomalyco/opencode/github@latest
           env:
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
           with:
             model: anthropic/claude-sonnet-4-20250514
             # share: true
             # github_token: xxxx
   ```

3. **Guarda las claves API en secretos**

   En la **configuración** de tu organización o proyecto, expande **Secretos y variables** a la izquierda y selecciona **Acciones**. Y agregue las claves API requeridas.

---

## Configuración

- `model`: El modelo a usar con OpenCode. Toma el formato de `provider/model`. Esto es **obligatorio**.
- `agent`: El agente a utilizar. Debe ser un agente primario. Vuelve a `default_agent` desde la configuración o `"build"` si no se encuentra.
- `share`: si se comparte la sesión OpenCode. El valor predeterminado es **verdadero** para repositorios públicos.
- `prompt`: mensaje personalizado opcional para anular el comportamiento predeterminado. Utilice esto para personalizar cómo OpenCode procesa las solicitudes.
- `token`: token de acceso GitHub opcional para realizar operaciones como crear comentarios, confirmar cambios y abrir solicitudes de extracción. De forma predeterminada, OpenCode usa el token de acceso a la instalación de la aplicación OpenCode GitHub, por lo que las confirmaciones, los comentarios y las solicitudes de extracción aparecen como provenientes de la aplicación.

  Alternativamente, puede usar el GitHub Action Runner [`GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) incorporado sin instalar la aplicación OpenCode GitHub. Solo asegúrese de otorgar los permisos necesarios en su flujo de trabajo:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  También puede utilizar [tokens de acceso personal](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) si lo prefiere.

---

## Eventos admitidos

OpenCode puede desencadenarse por los siguientes eventos GitHub:

| Tipo de evento                | Activado por                                  | Detalles                                                                                                                                        |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Comentar sobre un tema o PR                   | Mencione `/opencode` o `/oc` en su comentario. OpenCode lee el contexto y puede crear ramas, abrir relaciones públicas o responder.             |
| `pull_request_review_comment` | Comente líneas de código específicas en un PR | Mencione `/opencode` o `/oc` mientras revisa el código. OpenCode recibe la ruta del archivo, los números de línea y el contexto de diferencias. |
| `issues`                      | Número abierto o editado                      | Activa automáticamente OpenCode cuando se crean o modifican problemas. Requiere entrada `prompt`.                                               |
| `pull_request`                | PR abierto o actualizado                      | Activa automáticamente OpenCode cuando los PR se abren, sincronizan o vuelven a abrir. Útil para revisiones automatizadas.                      |
| `schedule`                    | Programación basada en cron                   | Ejecute OpenCode según una programación. Requiere entrada `prompt`. La salida va a registros y relaciones públicas (no hay temas que comentar). |
| `workflow_dispatch`           | Activador manual desde GitHub UI              | Active OpenCode a pedido a través de la pestaña Acciones. Requiere entrada `prompt`. La salida va a registros y relaciones públicas.            |

### Ejemplo de programación

Ejecute OpenCode según una programación para realizar tareas automatizadas:

```yaml title=".github/workflows/opencode-scheduled.yml"
name: Scheduled OpenCode Task

on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9am UTC

jobs:
  opencode:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run OpenCode
        uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review the codebase for any TODO comments and create a summary.
            If you find issues worth addressing, open an issue to track them.
```

Para eventos programados, la entrada `prompt` es **obligatoria** ya que no hay comentarios del que extraer instrucciones. Los flujos de trabajo programados se ejecutan sin un contexto de usuario para verificar los permisos, por lo que el flujo de trabajo debe otorgar `contents: write` y `pull-requests: write` si espera que OpenCode cree ramas o PR.

---

### Ejemplo de solicitud de extracción

Revisar automáticamente los PR cuando se abren o actualizan:

```yaml title=".github/workflows/opencode-review.yml"
name: opencode-review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          use_github_token: true
          prompt: |
            Review this pull request:
            - Check for code quality issues
            - Look for potential bugs
            - Suggest improvements
```

Para los eventos `pull_request`, si no se proporciona `prompt`, OpenCode revisa de forma predeterminada la solicitud de extracción.

---

### Ejemplo de clasificación de problemas

Clasifique automáticamente nuevos problemas. Este ejemplo filtra cuentas con más de 30 días para reducir el spam:

```yaml title=".github/workflows/opencode-triage.yml"
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Check account age
        id: check
        uses: actions/github-script@v7
        with:
          script: |
            const user = await github.rest.users.getByUsername({
              username: context.payload.issue.user.login
            });
            const created = new Date(user.data.created_at);
            const days = (Date.now() - created) / (1000 * 60 * 60 * 24);
            return days >= 30;
          result-encoding: string

      - uses: actions/checkout@v6
        if: steps.check.outputs.result == 'true'
        with:
          persist-credentials: false

      - uses: anomalyco/opencode/github@latest
        if: steps.check.outputs.result == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review this issue. If there's a clear fix or relevant docs:
            - Provide documentation links
            - Add error handling guidance for code examples
            Otherwise, do not comment.
```

Para eventos `issues`, la entrada `prompt` es **obligatoria** ya que no hay ningún comentario del que extraer instrucciones.

---

## Indicaciones personalizadas

Anule el mensaje predeterminado para personalizar el comportamiento de OpenCode para su flujo de trabajo.

```yaml title=".github/workflows/opencode.yml"
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-5
    prompt: |
      Review this pull request:
      - Check for code quality issues
      - Look for potential bugs
      - Suggest improvements
```

Esto es útil para hacer cumplir criterios de revisión específicos, estándares de codificación o áreas de enfoque relevantes para su proyecto.

---

## Ejemplos

A continuación se muestran algunos ejemplos de cómo puede utilizar OpenCode en GitHub.

- **Explica un problema**

  Agregue este comentario en una edición GitHub.

  ```
  /opencode explain this issue
  ```

  OpenCode leerá el hilo completo, incluidos todos los comentarios, y responderá con una explicación clara.

- **Solucionar un problema**

  En un problema GitHub, diga:

  ```
  /opencode fix this
  ```

  Y OpenCode creará una nueva rama, implementará los cambios y abrirá un PR con los cambios.

- **Revisar relaciones públicas y realizar cambios**

  Deja el siguiente comentario en un GitHub PR.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode implementará el cambio solicitado y lo comprometerá con el mismo PR.

- **Revisar líneas de código específicas**

  Deje un comentario directamente en las líneas de código en la pestaña "Archivos" del PR. OpenCode detecta automáticamente el archivo, los números de línea y el contexto de diferencias para proporcionar respuestas precisas.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  Al comentar líneas específicas, OpenCode recibe:
  - El archivo exacto que se está revisando.
  - Las líneas de código específicas.
  - El contexto diferencial circundante.
  - Información del número de línea

  Esto permite solicitudes más específicas sin necesidad de especificar rutas de archivo o números de línea manualmente.
