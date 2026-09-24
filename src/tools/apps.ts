import open from "open";
import fs from "node:fs";
import path from "node:path";
import { assertPathNotDenied, config } from "../config.js";
import { isFullAccessGranted } from "../permissions.js";
import { resolveApplication, launchApplication } from "./appResolver.js";
import { searchFiles } from "./files.js";

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
 * Automatically resolves filenames in Desktop, Downloads, Documents, or through smart search.
 */
export async function openFile(filePath: string): Promise<OpenResult> {
  console.log(`[Apps] 📂 openFile requested: "${filePath}"`);

  let resolvedTarget = filePath;

  if (!fs.existsSync(resolvedTarget)) {
    // Check common user directories: Desktop, Downloads, Documents, Home
    const candidateDirs = [
      path.join(config.homeDir, "Desktop"),
      path.join(config.homeDir, "Downloads"),
      path.join(config.homeDir, "Documents"),
      config.homeDir,
    ];

    let foundCandidate: string | null = null;
    for (const dir of candidateDirs) {
      const candidate = path.join(dir, filePath);
      if (fs.existsSync(candidate)) {
        foundCandidate = candidate;
        break;
      }
    }

    // If still not found, search files matching the query
    if (!foundCandidate) {
      const searchRes = await searchFiles(path.basename(filePath));
      if (searchRes.matches && searchRes.matches.length > 0) {
        foundCandidate = searchRes.matches[0];
        console.log(`[Apps] 🔍 Found matching file via search: "${foundCandidate}"`);
      }
    }

    if (foundCandidate) {
      resolvedTarget = foundCandidate;
    }
  }

  const safePath = assertPathNotDenied(resolvedTarget);

  if (!fs.existsSync(safePath)) {
    throw new Error(`Cannot open file: "${filePath}" was not found.`);
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

    // Direct fallback if resolver couldn't locate it
    const directRes = await launchApplication({
      query: appName,
      name: appName,
      targetPath: appName,
      type: "system",
      score: 40,
    });

    return {
      success: directRes.success,
      target: directRes.target,
      message: directRes.message,
    };
  } catch (err: any) {
    console.error(`[Apps] Failed to launch application "${appName}":`, err.message || err);
    return {
      success: false,
      target: appName,
      message: `Failed to open "${appName}": ${err.message || err}. Please verify the application is installed.`,
    };
  }
}

