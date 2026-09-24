import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import open, { openApp } from "open";

export interface ResolvedApp {
  query: string;
  name: string;
  targetPath: string;
  type: "shortcut" | "executable" | "protocol" | "system";
  workingDirectory?: string;
  score: number;
}

export interface ShortcutItem {
  name: string;
  baseName: string;
  cleanBaseName: string;
  fullPath: string;
  isUninstaller: boolean;
}

// Built-in system aliases for instant 0ms resolution
const KNOWN_SYSTEM_ALIASES: Record<string, { target: string; type: "executable" | "protocol" | "system"; workingDir?: string }> = {
  // Calculators & Utilities
  calc: { target: "calc.exe", type: "system" },
  calculator: { target: "calc.exe", type: "system" },
  notepad: { target: "notepad.exe", type: "system" },
  paint: { target: "mspaint.exe", type: "system" },
  mspaint: { target: "mspaint.exe", type: "system" },
  explorer: { target: "explorer.exe", type: "system" },
  "file explorer": { target: "explorer.exe", type: "system" },
  files: { target: "explorer.exe", type: "system" },
  taskmgr: { target: "taskmgr.exe", type: "system" },
  "task manager": { target: "taskmgr.exe", type: "system" },
  cmd: { target: "cmd.exe", type: "system" },
  terminal: { target: "wt.exe", type: "system" },
  "windows terminal": { target: "wt.exe", type: "system" },
  wt: { target: "wt.exe", type: "system" },
  powershell: { target: "powershell.exe", type: "system" },
  settings: { target: "ms-settings:", type: "protocol" },
  control: { target: "control.exe", type: "system" },
  "control panel": { target: "control.exe", type: "system" },

  // Browsers
  chrome: { target: "chrome.exe", type: "system" },
  "google chrome": { target: "chrome.exe", type: "system" },
  edge: { target: "msedge.exe", type: "system" },
  "microsoft edge": { target: "msedge.exe", type: "system" },
  firefox: { target: "firefox.exe", type: "system" },
  opera: { target: "opera.exe", type: "system" },
  brave: { target: "brave.exe", type: "system" },

  // Development
  code: { target: "code.cmd", type: "system" },
  vscode: { target: "code.cmd", type: "system" },
  "visual studio code": { target: "code.cmd", type: "system" },

  // Gaming & Launchers
  hoyoplay: { target: "C:\\Program Files\\HoYoPlay\\launcher.exe", type: "executable", workingDir: "C:\\Program Files\\HoYoPlay" },
  hoyo: { target: "C:\\Program Files\\HoYoPlay\\launcher.exe", type: "executable", workingDir: "C:\\Program Files\\HoYoPlay" },
  hyp: { target: "C:\\Program Files\\HoYoPlay\\launcher.exe", type: "executable", workingDir: "C:\\Program Files\\HoYoPlay" },
  steam: { target: "steam.exe", type: "system" },
  spotify: { target: "spotify.exe", type: "system" },
  discord: { target: "discord.exe", type: "system" },
};

let cachedShortcuts: ShortcutItem[] = [];
let lastShortcutScanTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds cache

/**
 * Scan Desktop and Start Menu directories for shortcuts (*.lnk, *.url).
 */
function getShortcutDirectories(): string[] {
  if (process.platform !== "win32") return [];
  const home = os.homedir();
  return [
    path.join(home, "Desktop"),
    "C:\\Users\\Public\\Desktop",
    path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs"),
    "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
  ];
}

/**
 * Refresh indexed shortcuts list.
 */
export function scanShortcuts(force: boolean = false): ShortcutItem[] {
  const now = Date.now();
  if (!force && cachedShortcuts.length > 0 && now - lastShortcutScanTime < CACHE_TTL_MS) {
    return cachedShortcuts;
  }

  const items: ShortcutItem[] = [];
  const dirs = getShortcutDirectories();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const walk = (currentDir: string, depth: number = 0) => {
        if (depth > 5) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (entry.name.endsWith(".lnk") || entry.name.endsWith(".url")) {
            const baseName = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
            const cleanBaseName = baseName.replace(/[^a-z0-9]/g, "");
            const isUninstaller =
              baseName.includes("uninstall") ||
              baseName.includes("remove") ||
              baseName.includes("setup") ||
              baseName.includes("unins000");

            items.push({
              name: entry.name,
              baseName,
              cleanBaseName,
              fullPath,
              isUninstaller,
            });
          }
        }
      };

      walk(dir, 0);
    } catch {}
  }

  cachedShortcuts = items;
  lastShortcutScanTime = now;
  return cachedShortcuts;
}

/**
 * Clean user query: remove common prefix words ("open", "launch", "start", "run", "the").
 */
function cleanQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/^(open|launch|start|run|play)\s+(the\s+)?/i, "")
    .replace(/\.exe$/i, "")
    .replace(/\.lnk$/i, "")
    .trim();
}

/**
 * Resolve an application request to a concrete executable or shortcut.
 */
export async function resolveApplication(rawQuery: string): Promise<ResolvedApp | null> {
  const query = cleanQuery(rawQuery);
  const cleanQ = query.replace(/[^a-z0-9]/g, "");

  if (!query) return null;

  // 1. Check known system aliases (0ms instant match)
  if (KNOWN_SYSTEM_ALIASES[query]) {
    const alias = KNOWN_SYSTEM_ALIASES[query];
    // If it's a fixed path (like HoYoPlay), check if it exists on disk
    if (alias.type === "executable" && alias.target.includes("\\")) {
      if (fs.existsSync(alias.target)) {
        return {
          query: rawQuery,
          name: query,
          targetPath: alias.target,
          type: "executable",
          workingDirectory: alias.workingDir || path.dirname(alias.target),
          score: 100,
        };
      }
    } else {
      return {
        query: rawQuery,
        name: query,
        targetPath: alias.target,
        type: alias.type,
        workingDirectory: alias.workingDir,
        score: 100,
      };
    }
  }

  // 2. Scan Desktop and Start Menu shortcuts
  const shortcuts = scanShortcuts();
  const candidates: Array<{ item: ShortcutItem; score: number }> = [];

  for (const item of shortcuts) {
    if (item.isUninstaller && !query.includes("uninstall")) {
      continue;
    }

    let score = 0;
    if (item.cleanBaseName === cleanQ) {
      score = 100;
    } else if (item.baseName === query) {
      score = 98;
    } else if (item.cleanBaseName.startsWith(cleanQ)) {
      score = 85;
    } else if (item.cleanBaseName.includes(cleanQ)) {
      score = 70;
    } else if (item.baseName.includes(query)) {
      score = 60;
    }

    if (score > 0) {
      candidates.push({ item, score });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return {
      query: rawQuery,
      name: best.item.name,
      targetPath: best.item.fullPath,
      type: "shortcut",
      workingDirectory: path.dirname(best.item.fullPath),
      score: best.score,
    };
  }

  // 3. Check Common Program Files directories on Windows
  if (process.platform === "win32") {
    const commonDirs = [
      path.join(process.env.LOCALAPPDATA || "", "Programs"),
      "C:\\Program Files",
      "C:\\Program Files (x86)",
    ];

    for (const parent of commonDirs) {
      if (!fs.existsSync(parent)) continue;

      // Check direct folder match: e.g. "C:\Program Files\HoYoPlay"
      try {
        const subdirs = fs.readdirSync(parent);
        for (const sub of subdirs) {
          const cleanSub = sub.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (cleanSub === cleanQ || cleanSub.includes(cleanQ)) {
            const fullDir = path.join(parent, sub);
            // Look for launcher.exe or <subName>.exe
            const possibleExes = [
              path.join(fullDir, "launcher.exe"),
              path.join(fullDir, `${sub}.exe`),
              path.join(fullDir, `${query}.exe`),
            ];
            for (const exe of possibleExes) {
              if (fs.existsSync(exe)) {
                return {
                  query: rawQuery,
                  name: sub,
                  targetPath: exe,
                  type: "executable",
                  workingDirectory: fullDir,
                  score: 90,
                };
              }
            }
          }
        }
      } catch {}
    }
  }

  // 4. Fallback to generic system command / executable
  return {
    query: rawQuery,
    name: query,
    targetPath: query,
    type: "system",
    score: 40,
  };
}

/**
 * Launch an application with optimal execution strategy and zero latency.
 */
export async function launchApplication(app: ResolvedApp): Promise<{
  success: boolean;
  message: string;
  target: string;
  pid?: number;
}> {
  console.log(`[AppResolver] 🚀 Launching application "${app.name}" (Type: ${app.type}, Target: "${app.targetPath}")`);

  // Strategy 1: Shortcut (*.lnk, *.url)
  if (app.type === "shortcut") {
    try {
      const subprocess = await open(app.targetPath);
      if (subprocess && typeof subprocess.unref === "function") {
        subprocess.unref();
      }
      return {
        success: true,
        message: `Application "${app.name}" launched successfully via shortcut.`,
        target: app.targetPath,
        pid: subprocess?.pid,
      };
    } catch (err: any) {
      console.warn(`[AppResolver] open(shortcut) failed (${err.message}), falling back to Windows Shell...`);
      // Windows Shell fallback: cmd.exe /c start "" "<path>"
      const child = spawn("cmd.exe", ["/c", "start", '""', app.targetPath], {
        windowsVerbatimArguments: true,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return {
        success: true,
        message: `Application "${app.name}" launched via Windows Shell.`,
        target: app.targetPath,
        pid: child.pid,
      };
    }
  }

  // Strategy 2: Protocol handler (e.g. ms-settings:, steam:)
  if (app.type === "protocol") {
    const subprocess = await open(app.targetPath);
    if (subprocess && typeof subprocess.unref === "function") {
      subprocess.unref();
    }
    return {
      success: true,
      message: `Protocol "${app.targetPath}" invoked successfully.`,
      target: app.targetPath,
      pid: subprocess?.pid,
    };
  }

  // Strategy 3: Concrete Executable (*.exe)
  if (app.type === "executable" && fs.existsSync(app.targetPath)) {
    const cwd = app.workingDirectory || path.dirname(app.targetPath);
    try {
      const child = spawn(app.targetPath, [], {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });

      child.on("error", (err) => {
        console.warn(`[AppResolver] Spawn error on ${app.targetPath}:`, err);
      });

      child.unref();

      return {
        success: true,
        message: `Executable "${path.basename(app.targetPath)}" started with working directory "${cwd}".`,
        target: app.targetPath,
        pid: child.pid,
      };
    } catch (err: any) {
      console.warn(`[AppResolver] Direct spawn failed (${err.message}), attempting PowerShell Start-Process...`);
      // PowerShell fallback with proper WorkingDirectory
      const psCommand = `Start-Process -FilePath '${app.targetPath.replace(/'/g, "''")}' -WorkingDirectory '${cwd.replace(/'/g, "''")}'`;
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      return {
        success: true,
        message: `Executable "${path.basename(app.targetPath)}" launched via PowerShell.`,
        target: app.targetPath,
        pid: child.pid,
      };
    }
  }

  // Strategy 4: System application / PATH name fallback
  try {
    const subprocess = await openApp(app.targetPath);
    if (subprocess && typeof subprocess.unref === "function") {
      subprocess.unref();
    }
    return {
      success: true,
      message: `Application "${app.name}" launched successfully.`,
      target: app.targetPath,
      pid: subprocess?.pid,
    };
  } catch (err: any) {
    console.warn(`[AppResolver] openApp failed (${err.message}), trying direct open...`);
    try {
      const subprocess = await open(app.targetPath);
      if (subprocess && typeof subprocess.unref === "function") {
        subprocess.unref();
      }
      return {
        success: true,
        message: `Application "${app.name}" opened.`,
        target: app.targetPath,
        pid: subprocess?.pid,
      };
    } catch (innerErr: any) {
      throw new Error(`Failed to launch "${app.name}": ${innerErr.message || innerErr}`);
    }
  }
}
