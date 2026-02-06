import { Config } from "../../opencode/src/config/config"

export function formatForkCliError(input: unknown): string | undefined {
  if (Config.PamServiceNotFoundError.isInstance(input)) {
    return [
      `PAM service file not found: ${input.data.path}`,
      "",
      "To create the PAM service file, run as root:",
      "",
      `  sudo tee /etc/pam.d/${input.data.service} << 'EOF'`,
      "  #%PAM-1.0",
      "  auth       required     pam_unix.so",
      "  account    required     pam_unix.so",
      "  EOF",
      "",
      "Or use an existing PAM service by setting auth.pam.service in opencode.json",
    ].join("\n")
  }
}
