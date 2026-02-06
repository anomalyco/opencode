export type CommandRegistrar = {
  command: (...args: any[]) => CommandRegistrar
}

export type RegisterForkCommands = (cli: CommandRegistrar) => void

export const registerForkCommands: RegisterForkCommands = () => {
  // Intentionally empty. Fork-specific commands can be registered here.
}

export { registerAuthBrokerCommands } from "./auth-broker"
export { formatForkCliError } from "./error"
export { getForkCliLogo } from "./logo"
export {
  createForkRunState,
  handleForkRunEvent,
  resolveForkRunSessionCreateInput,
  validateForkRunCommand,
} from "./run"
export { formatForkWebMdnsLabel, resolveForkWebUiDir } from "./web"
