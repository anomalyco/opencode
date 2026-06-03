import { Command } from "commander";
import { login } from "./login";
import { logout } from "./logout";
import { status } from "./status";
export declare function createMcpOAuthCommand(): Command;
export { login, logout, status };
