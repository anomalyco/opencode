/** Platform-specific security operations interface */

export interface UserCreationResult {
  success: boolean
  userCreated: boolean // false if already existed
  error?: string
}

export interface PlatformSecurity {
  userExists(username: string): Promise<boolean>

  /** Create a restricted system user with appropriate UID and group */
  createUser(username: string): Promise<UserCreationResult>

  deleteUser(username: string): Promise<void>

  /** Update user's primary group membership */
  updateUserGroup(username: string): Promise<void>
}

export type SudoCommand = (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
