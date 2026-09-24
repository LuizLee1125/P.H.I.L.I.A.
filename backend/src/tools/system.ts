import { exec } from "node:child_process";
import { isFullAccessGranted } from "../permissions.js";

export interface CommandResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | string | null;
  message: string;
}

export type CommandConfirmationHandler = (actionDescription: string) => Promise<boolean> | boolean;

let defaultCommandConfirmationHandler: CommandConfirmationHandler = async (action) => {
  console.log(`[Guardrail Command Confirmation] Auto-acknowledging: ${action}`);
  return true;
};

export function setCommandConfirmationHandler(handler: CommandConfirmationHandler) {
  defaultCommandConfirmationHandler = handler;
}

/**
 * Execute a shell or terminal command on the user's computer with full system access.
 */
export async function executeCommand(commandStr: string, timeoutMs: number = 20000): Promise<CommandResult> {
  console.log(`[System] ⚡ executeCommand: "${commandStr}"`);

  if (!isFullAccessGranted()) {
    const actionDescription = `Execute system command "${commandStr}"`;
    const confirmed = await defaultCommandConfirmationHandler(actionDescription);
    if (!confirmed) {
      return {
        success: false,
        command: commandStr,
        stdout: "",
        stderr: "Permission denied: Full computer access is required to run system commands.",
        exitCode: 1,
        message: "Action cancelled: Full computer access has not been granted by user.",
      };
    }
  }

  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/bash";

    exec(
      commandStr,
      {
        shell,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024, // 2MB
      },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(`[System] Command finished with error: ${error.message}`);
          resolve({
            success: false,
            command: commandStr,
            stdout: stdout.trim(),
            stderr: (stderr || error.message).trim(),
            exitCode: error.code || 1,
            message: `Command exited with code ${error.code || 1}: ${error.message}`,
          });
        } else {
          console.log(`[System] ✅ Command executed successfully (${stdout.length} chars output).`);
          resolve({
            success: true,
            command: commandStr,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: 0,
            message: `Command completed successfully.`,
          });
        }
      }
    );
  });
}
