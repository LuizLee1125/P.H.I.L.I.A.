import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Search for .env in current directory, parent directory, and workspace root
const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", ".env"),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
dotenv.config(); // fallback default

/**
 * Base deny-list by platform as specified in the implementation plan.
 */
function getPlatformDenyList(): string[] {
  const platform = process.platform;

  if (platform === "win32") {
    return [
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      ...(process.env.SystemRoot ? [process.env.SystemRoot] : []),
      ...(process.env["ProgramFiles"] ? [process.env["ProgramFiles"]] : []),
      ...(process.env["ProgramFiles(x86)"] ? [process.env["ProgramFiles(x86)"]] : []),
    ];
  } else if (platform === "darwin") {
    return [
      "/System",
      "/Library",
      "/usr",
      "/bin",
      "/sbin",
      "/private",
    ];
  } else {
    // Linux and other POSIX
    return [
      "/etc",
      "/bin",
      "/sbin",
      "/usr",
      "/boot",
      "/lib",
      "/lib64",
      "/proc",
      "/sys",
      "/dev",
    ];
  }
}

/**
 * Parse any additional deny paths provided by the user via EXTRA_DENY_LIST
 */
function getExtraDenyList(): string[] {
  const extra = process.env.EXTRA_DENY_LIST;
  if (!extra) return [];
  return extra
    .split(/[;:,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

import { isFullAccessGranted } from "./permissions.js";

// Combine and deduplicate deny-list
const rawDenyList = Array.from(new Set([...getPlatformDenyList(), ...getExtraDenyList()]));

export const denyList = rawDenyList.map((dir) => path.resolve(dir));

/**
 * Check whether a target path falls inside any directory in the deny-list.
 * If user has granted Full Access, restrictions are bypassed.
 */
export function isPathDenied(targetPath: string, bypassFullAccessCheck: boolean = false): { denied: boolean; matchedPattern?: string; resolvedPath: string } {
  const resolved = path.resolve(targetPath);
  let canonicalPath = resolved;

  try {
    if (fs.existsSync(resolved)) {
      canonicalPath = fs.realpathSync(resolved);
    }
  } catch {
    canonicalPath = resolved;
  }

  // When Full Access is granted, allow unrestricted system access
  if (!bypassFullAccessCheck && isFullAccessGranted()) {
    return {
      denied: false,
      resolvedPath: canonicalPath,
    };
  }

  const isWin = process.platform === "win32";
  const normalizedCanonical = isWin ? canonicalPath.toLowerCase() : canonicalPath;

  for (const deniedDir of denyList) {
    const normalizedDenied = isWin ? deniedDir.toLowerCase() : deniedDir;

    if (
      normalizedCanonical === normalizedDenied ||
      normalizedCanonical.startsWith(normalizedDenied + path.sep.toLowerCase())
    ) {
      return {
        denied: true,
        matchedPattern: deniedDir,
        resolvedPath: canonicalPath,
      };
    }
  }

  return {
    denied: false,
    resolvedPath: canonicalPath,
  };
}

/**
 * Throws a descriptive error if the path is in the deny-list.
 */
export function assertPathNotDenied(targetPath: string, bypassFullAccessCheck: boolean = false): string {
  const check = isPathDenied(targetPath, bypassFullAccessCheck);
  if (check.denied) {
    const errorMsg = `Access Denied: Path "${targetPath}" is protected under system deny-list rule (${check.matchedPattern}). Refusing operation.`;
    console.error(`[Guardrail] ❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
  return check.resolvedPath;
}

export const config = {
  port: parseInt(process.env.PORT || "4172", 10),
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  geminiVoice: process.env.GEMINI_VOICE || "Fenrir",
  picovoiceAccessKey: process.env.PICOVOICE_ACCESS_KEY || "",
  browserHeadless: process.env.BROWSER_HEADLESS === "true",
  homeDir: os.homedir(),
  denyList,
  isPathDenied,
  assertPathNotDenied,
};

