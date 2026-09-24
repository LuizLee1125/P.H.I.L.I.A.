import open, { openApp } from "open";
import fs from "node:fs";
import path from "node:path";
import { assertPathNotDenied } from "../config.js";
import { isFullAccessGranted } from "../permissions.js";
import { resolveApplication, launchApplication } from "./appResolver.js";

export interface OpenResult {
  success: boolean;
  target: string;
  message: string;
}

export type ConfirmationHandler = (actionDescription: string) => Promise<boolean> | boolean;

let defaultConfirmationHandler: ConfirmationHandler = async (action) => {
  console.log(`[Guardrail Confirmation] Auto-acknowledging: ${action}`);
  return true;
};

export function setAppConfirmationHandler(handler: ConfirmationHandler) {
  defaultConfirmationHandler = handler;
}

/**
 * Open local file with default OS application.
 */
export async function openFile(filePath: string): Promise<OpenResult> {
  console.log(`[Apps] 📂 openFile requested: "${filePath}"`);
  const safePath = assertPathNotDenied(filePath);

  if (!fs.existsSync(safePath)) {
    throw new Error(`Cannot open file: "${safePath}" does not exist.`);
  }

  console.log(`[Apps] 🚀 Launching default system handler for: ${safePath}`);
  const subprocess = await open(safePath);

  if (subprocess && typeof subprocess.unref === "function") {
    subprocess.unref();
  }

  return {
    success: true,
    target: safePath,
    message: `Opened "${path.basename(safePath)}" with default application.`,
  };
}

/**
 * Open desktop application by name or shortcut.
 * Fast resolution via AppResolver with zero latency and fallback support.
 */
export async function openApplication(appName: string): Promise<OpenResult> {
  const actionSummary = `Open desktop application "${appName}"`;
  console.log(`[Apps] 🖥️ Request to launch application: "${appName}"`);

  // If Full Access is NOT granted, prompt for permission
  if (!isFullAccessGranted()) {
    const confirmed = await defaultConfirmationHandler(actionSummary);
    if (!confirmed) {
      return {
        success: false,
        target: appName,
        message: `Action cancelled: User declined permission to open application "${appName}".`,
      };
    }
  }

  console.log(`[Apps] 🚀 Resolving and executing application launch for: "${appName}"`);

  try {
    const resolved = await resolveApplication(appName);
    if (resolved) {
      const launchRes = await launchApplication(resolved);
      return {
        success: launchRes.success,
        target: launchRes.target,
        message: launchRes.message,
      };
    }

    // Direct fallback
    const subprocess = await openApp(appName);
    if (subprocess && typeof subprocess.unref === "function") {
      subprocess.unref();
    }
    return {
      success: true,
      target: appName,
      message: `Application "${appName}" launched.`,
    };
  } catch (err: any) {
    console.warn(`[Apps] Standard launch failed for "${appName}", trying direct open... (${err.message || err})`);
    try {
      const subprocess = await open(appName);
      if (subprocess && typeof subprocess.unref === "function") {
        subprocess.unref();
      }
      return {
        success: true,
        target: appName,
        message: `Application "${appName}" opened.`,
      };
    } catch (innerErr: any) {
      throw new Error(`Failed to launch application "${appName}": ${innerErr.message || innerErr}`);
    }
  }
}
