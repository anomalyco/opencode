import en from "./en"

type Keys = keyof typeof en

export const dict = {
  "desktop.menu.minimize": "Minimise",
  "desktop.menu.maximize": "Maximise",
  "command.session.compact.description": "Summarise the session to reduce context size",
  "dialog.provider.opencode.tagline": "Reliable optimised models",
  "dialog.model.manage.description": "Customise which models appear in the model selector.",
  "provider.connect.console.statusFailed": "Couldn't check authorisation. Check your server connection and try again.",
  "provider.connect.models.description": "Choose a model to start with. You can switch models at any time.",
  "provider.connect.status.inProgress": "Authorisation in progress…",
  "provider.connect.status.waiting": "Waiting for authorisation…",
  "provider.connect.status.failed": "Authorisation failed: {{error}}",
  "provider.connect.oauth.code.label": "{{method}} authorisation code",
  "provider.connect.oauth.code.placeholder": "Authorisation code",
  "provider.connect.oauth.code.required": "Authorisation code is required",
  "provider.connect.oauth.code.invalid": "Invalid authorisation code",
  "provider.connect.oauth.auto.confirmationCode.description":
    "Check that your browser shows the same code before you authorise.",
  "provider.connect.oauth.code.description":
    "Your browser opens so you can sign in to {{provider}}. Paste the authorisation code it gives you below.",
  "provider.connect.oauth.expired": "Authorisation expired",
  "error.chain.providerInitFailed":
    'Failed to initialise provider "{{provider}}". Check credentials and configuration.',
  "common.color.gray": "grey",
  "dialog.project.edit.color": "Colour",
  "dialog.project.edit.color.select": "Select {{color}} colour",
  "session.question.minimize": "Minimise question",
  "settings.preferences.description": "Customise preferences and theme and default behaviour",
  "settings.appearance.description": "Customise theme and fonts",
  "settings.shortcuts.description": "Customise shortcuts for common actions",
  "settings.general.row.colorScheme.title": "Colour scheme",
  "settings.general.row.theme.description": "Customise how OpenCode is themed.",
  "settings.general.row.font.description": "Customise the font used in code blocks",
  "settings.general.row.terminalFont.description": "Customise the font used in the terminal",
  "settings.general.row.uiFont.description": "Customise the font used throughout the interface",
  "settings.general.row.followUpBehavior.title": "Follow-up behaviour",
} satisfies Partial<Record<Keys, string>>
