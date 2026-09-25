import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, execSync } from "node:child_process";
import open, { openApp } from "open";

export interface ResolvedApp {
  query: string;
  name: string;
  targetPath: string;
  type: "shortcut" | "executable" | "protocol" | "system";
  arguments?: string;
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

// Built-in native Windows OS tools & special URLs (guaranteed in System32 / Windows Shell)
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
  "command prompt": { target: "cmd.exe", type: "system" },
  terminal: { target: "wt.exe", type: "system" },
  "windows terminal": { target: "wt.exe", type: "system" },
  wt: { target: "wt.exe", type: "system" },
  powershell: { target: "powershell.exe", type: "system" },
  settings: { target: "ms-settings:", type: "protocol" },
  "windows settings": { target: "ms-settings:", type: "protocol" },
  control: { target: "control.exe", type: "system" },
  "control panel": { target: "control.exe", type: "system" },

  // Special Web Services & Sites
  google: { target: "https://www.google.com", type: "protocol" },
  youtube: { target: "https://www.youtube.com", type: "protocol" },
  yt: { target: "https://www.youtube.com", type: "protocol" },
  reddit: { target: "https://www.reddit.com", type: "protocol" },
  github: { target: "https://github.com", type: "protocol" },
  twitter: { target: "https://x.com", type: "protocol" },
  x: { target: "https://x.com", type: "protocol" },
  twitch: { target: "https://www.twitch.tv", type: "protocol" },
  netflix: { target: "https://www.netflix.com", type: "protocol" },
  chatgpt: { target: "https://chatgpt.com", type: "protocol" },
  gemini: { target: "https://gemini.google.com", type: "protocol" },
  claude: { target: "https://claude.ai", type: "protocol" },
  amazon: { target: "https://www.amazon.com", type: "protocol" },
  wikipedia: { target: "https://www.wikipedia.org", type: "protocol" },
  gmail: { target: "https://mail.google.com", type: "protocol" },
  mail: { target: "https://mail.google.com", type: "protocol" },
  email: { target: "https://mail.google.com", type: "protocol" },
  outlook: { target: "https://outlook.live.com", type: "protocol" },
  yahoo: { target: "https://www.yahoo.com", type: "protocol" },
  bing: { target: "https://www.bing.com", type: "protocol" },
  duckduckgo: { target: "https://duckduckgo.com", type: "protocol" },
  facebook: { target: "https://www.facebook.com", type: "protocol" },
  instagram: { target: "https://www.instagram.com", type: "protocol" },
  tiktok: { target: "https://www.tiktok.com", type: "protocol" },
  linkedin: { target: "https://www.linkedin.com", type: "protocol" },
  pinterest: { target: "https://www.pinterest.com", type: "protocol" },
  "spotify web": { target: "https://open.spotify.com", type: "protocol" },
  "discord web": { target: "https://discord.com/app", type: "protocol" },
  whatsapp: { target: "https://web.whatsapp.com", type: "protocol" },
  "whatsapp web": { target: "https://web.whatsapp.com", type: "protocol" },
  messenger: { target: "https://www.messenger.com", type: "protocol" },
  crunchyroll: { target: "https://www.crunchyroll.com", type: "protocol" },
  disney: { target: "https://www.disneyplus.com", type: "protocol" },
  "disney plus": { target: "https://www.disneyplus.com", type: "protocol" },
  "prime video": { target: "https://www.primevideo.com", type: "protocol" },
  stackoverflow: { target: "https://stackoverflow.com", type: "protocol" },
  "stack overflow": { target: "https://stackoverflow.com", type: "protocol" },
  speedtest: { target: "https://www.speedtest.net", type: "protocol" },

  // System Locations
  documents: { target: path.join(os.homedir(), "Documents"), type: "system" },
  downloads: { target: path.join(os.homedir(), "Downloads"), type: "system" },
  desktop: { target: path.join(os.homedir(), "Desktop"), type: "system" },
};

/**
 * Detect the user's default browser executable on Windows (e.g. Opera GX, Chrome, Edge, Brave).
 */
export function getDefaultBrowserExecutable(): string | null {
  if (process.platform === "win32") {
    try {
      const progIdOut = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const progIdMatch = progIdOut.match(/ProgId\s+REG_\w+\s+([^\r\n]+)/);
      if (progIdMatch && progIdMatch[1]) {
        const progId = progIdMatch[1].trim();
        const cmdOut = execSync(
          `reg query "HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command" /ve`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        );
        const match = cmdOut.match(/REG_\w+\s+"?([^"\r\n]+?\.exe)"?/i);
        if (match && match[1] && fs.existsSync(match[1])) {
          return match[1];
        }
      }
    } catch {}
  }
  return null;
}

// Common aliases mapping casual names to expected shortcut terms
const ALIAS_NORMALIZATION: Record<string, string[]> = {
  vscode: ["visualstudiocode", "code"],
  "vs code": ["visualstudiocode", "code"],
  code: ["visualstudiocode", "code"],
  opera: ["operagxbrowser", "operagx", "opera"],
  "opera gx": ["operagxbrowser", "operagx"],
  operagx: ["operagxbrowser", "operagx"],
  hoyoplay: ["hoyoplay", "launcher"],
  hoyo: ["hoyoplay"],
  hyp: ["hoyoplay"],
  genshin: ["genshinimpactcloud", "genshinimpact"],
  "genshin impact": ["genshinimpactcloud", "genshinimpact"],
  hsr: ["honkaistarrail"],
  "star rail": ["honkaistarrail"],
  "honkai star rail": ["honkaistarrail"],
  spotify: ["spotify"],
  discord: ["discord"],
  steam: ["steam"],
  valorant: ["valorant", "riotclient"],
  obs: ["obsstudio", "obs64"],
  "obs studio": ["obsstudio", "obs64"],
  autocad: ["autocad2025english", "autocad"],
  "packet tracer": ["ciscopackettracer", "packettracer"],
  cisco: ["ciscopackettracer"],
  tlauncher: ["tlauncher"],
  minecraft: ["tlauncher", "minecraft"],
};

/**
 * Common app installation paths on Windows for instant, 0ms fallback detection.
 */
function getCommonAppFallbacks(): Record<string, { path: string; args?: string; workingDir?: string }[]> {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");

  return {
    spotify: [
      { path: path.join(appData, "Spotify", "Spotify.exe"), workingDir: path.join(appData, "Spotify") },
    ],
    discord: [
      { path: path.join(localAppData, "Discord", "Update.exe"), args: "--processStart Discord.exe", workingDir: path.join(localAppData, "Discord") },
    ],
    steam: [
      { path: "C:\\Program Files (x86)\\Steam\\steam.exe", workingDir: "C:\\Program Files (x86)\\Steam" },
      { path: "C:\\Program Files\\Steam\\steam.exe", workingDir: "C:\\Program Files\\Steam" },
      { path: "steam://open/main", args: "" },
    ],
    vscode: [
      { path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"), workingDir: path.join(localAppData, "Programs", "Microsoft VS Code") },
      { path: "C:\\Program Files\\Microsoft VS Code\\Code.exe", workingDir: "C:\\Program Files\\Microsoft VS Code" },
    ],
    code: [
      { path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"), workingDir: path.join(localAppData, "Programs", "Microsoft VS Code") },
      { path: "C:\\Program Files\\Microsoft VS Code\\Code.exe", workingDir: "C:\\Program Files\\Microsoft VS Code" },
    ],
    "visual studio code": [
      { path: path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"), workingDir: path.join(localAppData, "Programs", "Microsoft VS Code") },
      { path: "C:\\Program Files\\Microsoft VS Code\\Code.exe", workingDir: "C:\\Program Files\\Microsoft VS Code" },
    ],
    hoyoplay: [
      { path: "C:\\Program Files\\HoYoPlay\\launcher.exe", workingDir: "C:\\Program Files\\HoYoPlay" },
    ],
    hoyo: [
      { path: "C:\\Program Files\\HoYoPlay\\launcher.exe", workingDir: "C:\\Program Files\\HoYoPlay" },
    ],
    opera: [
      { path: path.join(localAppData, "Programs", "Opera GX", "opera.exe"), workingDir: path.join(localAppData, "Programs", "Opera GX") },
      { path: path.join(localAppData, "Programs", "Opera", "launcher.exe"), workingDir: path.join(localAppData, "Programs", "Opera") },
    ],
    "opera gx": [
      { path: path.join(localAppData, "Programs", "Opera GX", "opera.exe"), workingDir: path.join(localAppData, "Programs", "Opera GX") },
    ],
    operagx: [
      { path: path.join(localAppData, "Programs", "Opera GX", "opera.exe"), workingDir: path.join(localAppData, "Programs", "Opera GX") },
    ],
    chrome: [
      { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", workingDir: "C:\\Program Files\\Google\\Chrome\\Application" },
      { path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", workingDir: "C:\\Program Files (x86)\\Google\\Chrome\\Application" },
    ],
    "google chrome": [
      { path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", workingDir: "C:\\Program Files\\Google\\Chrome\\Application" },
      { path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", workingDir: "C:\\Program Files (x86)\\Google\\Chrome\\Application" },
    ],
    edge: [
      { path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", workingDir: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application" },
    ],
    "microsoft edge": [
      { path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", workingDir: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application" },
    ],
    firefox: [
      { path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe", workingDir: "C:\\Program Files\\Mozilla Firefox" },
    ],
    brave: [
      { path: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", workingDir: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application" },
    ],
    obs: [
      { path: "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe", workingDir: "C:\\Program Files\\obs-studio\\bin\\64bit" },
    ],
    "obs studio": [
      { path: "C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe", workingDir: "C:\\Program Files\\obs-studio\\bin\\64bit" },
    ],
  };
}

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
    path.join(home, "AppData", "Roaming", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
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
              baseName.includes("unins000") ||
              baseName.includes("卸载");

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
 * Clean user query: remove conversational prefixes and file extensions.
 */
export function cleanQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/^(can you |could you |please )+/i, "")
    .replace(/^(open|launch|start|run|play|execute)\s+(the\s+|my\s+)?/i, "")
    .replace(/( please| thanks| thank you)+$/i, "")
    .replace(/\.exe$/i, "")
    .replace(/\.lnk$/i, "")
    .trim();
}

/**
 * Resolve an application request to a concrete executable, shortcut, or protocol.
 */
export async function resolveApplication(rawQuery: string): Promise<ResolvedApp | null> {
  const query = cleanQuery(rawQuery);
  const cleanQ = query.replace(/[^a-z0-9]/g, "");

  if (!query) return null;

  // 1. Check if query is an explicit web URL (http:// or https://)
  if (/^https?:\/\//i.test(rawQuery.trim()) || /^https?:\/\//i.test(query)) {
    const targetUrl = /^https?:\/\//i.test(rawQuery.trim()) ? rawQuery.trim() : query;
    return {
      query: rawQuery,
      name: rawQuery,
      targetPath: targetUrl,
      type: "protocol",
      score: 100,
    };
  }

  // 2. Check if query is a web domain (e.g. 'youtube.com', 'reddit.com', 'github.com', 'news.ycombinator.com')
  const domainPattern = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|dev|ai|co|app|edu|gov|ph|tv|gg|me|info|xyz|tech|online|store|site)(\/.*)?$/i;
  if (domainPattern.test(query) || domainPattern.test(rawQuery.trim())) {
    const matched = domainPattern.test(query) ? query : rawQuery.trim();
    const fullUrl = matched.startsWith("http") ? matched : `https://${matched}`;
    return {
      query: rawQuery,
      name: rawQuery,
      targetPath: fullUrl,
      type: "protocol",
      score: 100,
    };
  }

  // 3. Check if query is a web search request (e.g. 'search youtube for lo-fi', 'search google for cats', 'search for weather')
  const ytSearchMatch = query.match(/^search\s+youtube\s+for\s+(.+)/i);
  if (ytSearchMatch && ytSearchMatch[1]) {
    return {
      query: rawQuery,
      name: `Search YouTube: "${ytSearchMatch[1]}"`,
      targetPath: `https://www.youtube.com/results?search_query=${encodeURIComponent(ytSearchMatch[1].trim())}`,
      type: "protocol",
      score: 95,
    };
  }

  const googleSearchMatch = query.match(/^(search(\s+(google|the\s+web|the\s+internet))?\s+for|google)\s+(.+)/i);
  if (googleSearchMatch && googleSearchMatch[4]) {
    return {
      query: rawQuery,
      name: `Search: "${googleSearchMatch[4]}"`,
      targetPath: `https://www.google.com/search?q=${encodeURIComponent(googleSearchMatch[4].trim())}`,
      type: "protocol",
      score: 95,
    };
  }

  // 4. Check if user is asking to open their default web browser
  const isBrowserQuery = [
    "browser",
    "my browser",
    "the browser",
    "web browser",
    "default browser",
    "internet browser",
    "internet",
    "web",
    "opera",
    "opera gx",
    "operagx",
  ].includes(query);

  if (isBrowserQuery) {
    const defaultBrowser = getDefaultBrowserExecutable();
    if (defaultBrowser && fs.existsSync(defaultBrowser)) {
      const browserBaseName = path.basename(defaultBrowser, ".exe");
      return {
        query: rawQuery,
        name: browserBaseName.toLowerCase() === "opera" ? "Opera GX" : browserBaseName,
        targetPath: defaultBrowser,
        type: "executable",
        workingDirectory: path.dirname(defaultBrowser),
        score: 100,
      };
    }
  }

  // 5. Check known system aliases for OS built-ins and web services
  if (KNOWN_SYSTEM_ALIASES[query]) {
    const alias = KNOWN_SYSTEM_ALIASES[query];
    return {
      query: rawQuery,
      name: query,
      targetPath: alias.target,
      type: alias.type,
      workingDirectory: alias.workingDir,
      score: 100,
    };
  }

  // 2. Scan Desktop and Start Menu shortcuts
  const shortcuts = scanShortcuts();
  const candidates: Array<{ item: ShortcutItem; score: number }> = [];
  const normalizedTargets = ALIAS_NORMALIZATION[query] || [];

  for (const item of shortcuts) {
    if (item.isUninstaller && !query.includes("uninstall")) {
      continue;
    }

    let score = 0;
    if (item.cleanBaseName === cleanQ) {
      score = 100;
    } else if (normalizedTargets.includes(item.cleanBaseName)) {
      score = 95;
    } else if (item.baseName === query) {
      score = 90;
    } else if (item.cleanBaseName.startsWith(cleanQ) || cleanQ.startsWith(item.cleanBaseName)) {
      score = 85;
    } else if (item.cleanBaseName.includes(cleanQ)) {
      score = 75;
    } else if (item.baseName.includes(query)) {
      score = 65;
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

  // 3. Check Common Application Install Paths on Disk (Spotify, Discord, HoYoPlay, VS Code, Steam, Browsers)
  const fallbacks = getCommonAppFallbacks();
  const targetFallbacks = fallbacks[query] || fallbacks[cleanQ];
  if (targetFallbacks) {
    for (const fb of targetFallbacks) {
      if (fb.path.includes("://")) {
        return {
          query: rawQuery,
          name: query,
          targetPath: fb.path,
          type: "protocol",
          score: 85,
        };
      }
      if (fs.existsSync(fb.path)) {
        return {
          query: rawQuery,
          name: query,
          targetPath: fb.path,
          arguments: fb.args,
          workingDirectory: fb.workingDir || path.dirname(fb.path),
          type: "executable",
          score: 90,
        };
      }
    }
  }

  // 4. Check Common Program Files and LocalAppData directories on Windows
  if (process.platform === "win32") {
    const commonDirs = [
      path.join(process.env.LOCALAPPDATA || "", "Programs"),
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps"),
    ];

    for (const parent of commonDirs) {
      if (!fs.existsSync(parent)) continue;

      try {
        const subdirs = fs.readdirSync(parent);
        for (const sub of subdirs) {
          const cleanSub = sub.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (cleanSub === cleanQ || cleanSub.includes(cleanQ)) {
            const fullDir = path.join(parent, sub);
            const stat = fs.statSync(fullDir);
            if (stat.isDirectory()) {
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
                    score: 80,
                  };
                }
              }
            } else if (sub.toLowerCase().endsWith(".exe")) {
              return {
                query: rawQuery,
                name: sub,
                targetPath: fullDir,
                type: "executable",
                workingDirectory: parent,
                score: 85,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 5. Fallback: treat as general system command or protocol
  return {
    query: rawQuery,
    name: query,
    targetPath: query,
    type: "system",
    score: 40,
  };
}

/**
 * Launch an application using the official Windows ShellExecuteEx engine.
 * Completely handles:
 * - Shortcuts (.lnk) by resolving target, arguments, and working directory
 * - Direct executables (.exe) with proper working directory
 * - Protocols (ms-settings:, steam://, https://)
 * - UWP apps (shell:AppsFolder\...)
 * - System binaries (calc, notepad, cmd)
 */
function launchWindowsTarget(opts: {
  target: string;
  arguments?: string;
  workingDirectory?: string;
}): Promise<{ success: boolean; pid?: number; resolvedTarget: string }> {
  return new Promise((resolve, reject) => {
    const escapedTarget = (opts.target || "").replace(/'/g, "''");
    const escapedArgs = (opts.arguments || "").replace(/'/g, "''");
    const escapedWorkDir = (opts.workingDirectory || "").replace(/'/g, "''");

    const script = `
$target = '${escapedTarget}'
$argsToPass = '${escapedArgs}'
$workDir = '${escapedWorkDir}'

# If target is a shortcut (.lnk), resolve its actual TargetPath, Arguments, and WorkingDirectory
if ($target.ToLower().EndsWith('.lnk')) {
    try {
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut($target)
        if ($sc.TargetPath -and (Test-Path $sc.TargetPath)) {
            $target = $sc.TargetPath
            if (-not $argsToPass -and $sc.Arguments) { $argsToPass = $sc.Arguments }
            if (-not $workDir -and $sc.WorkingDirectory) { $workDir = $sc.WorkingDirectory }
        }
    } catch {}
}

# Ensure working directory points to target's folder if still unset
if (-not $workDir -and $target -and (Test-Path $target) -and -not (Test-Path $target -PathType Container)) {
    $workDir = Split-Path $target
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $target
if ($argsToPass) { $psi.Arguments = $argsToPass }
if ($workDir) { $psi.WorkingDirectory = $workDir }
$psi.UseShellExecute = $true

try {
    $p = [System.Diagnostics.Process]::Start($psi)
    $pidNum = if ($p) { $p.Id } else { 0 }
    Write-Output ("SUCCESS:" + $pidNum + ":" + $target)
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const errMsg = (stderr || stdout || err.message).trim();
          return reject(new Error(errMsg));
        }

        const out = stdout.trim();
        if (out.includes("SUCCESS:")) {
          const match = out.match(/SUCCESS:(\d+):(.*)/);
          const pid = match ? parseInt(match[1], 10) : undefined;
          const resolvedTarget = match ? match[2] : opts.target;
          return resolve({ success: true, pid, resolvedTarget });
        }

        resolve({ success: true, resolvedTarget: opts.target });
      }
    );
  });
}

/**
 * Launch an application with verified execution and 0ms latency.
 */
export async function launchApplication(app: ResolvedApp): Promise<{
  success: boolean;
  message: string;
  target: string;
  pid?: number;
}> {
  console.log(`[AppResolver] 🚀 Launching application "${app.name}" (Type: ${app.type}, Target: "${app.targetPath}")`);

  // Protocol or Web URL: open directly with user's default browser and account
  if (app.type === "protocol" || app.targetPath.includes("://") || app.targetPath.startsWith("mailto:") || app.targetPath.startsWith("ms-settings:")) {
    console.log(`[AppResolver] 🌐 Opening URL/protocol in user's default browser: "${app.targetPath}"`);
    try {
      const subprocess = await open(app.targetPath);
      if (subprocess && typeof subprocess.unref === "function") {
        subprocess.unref();
      }
      return {
        success: true,
        message: `Opened "${app.name}" in your default browser with your active account.`,
        target: app.targetPath,
        pid: subprocess?.pid,
      };
    } catch (err: unknown) {
      if (process.platform === "win32") {
        try {
          const escaped = app.targetPath.replace(/'/g, "''");
          execSync(`powershell.exe -NoProfile -Command "Start-Process '${escaped}'"`, { stdio: "ignore" });
          return {
            success: true,
            message: `Opened "${app.name}" in your default browser with your active account.`,
            target: app.targetPath,
          };
        } catch {}
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to open "${app.name}": ${errMsg}`);
    }
  }

  if (process.platform === "win32") {
    try {
      const res = await launchWindowsTarget({
        target: app.targetPath,
        arguments: app.arguments,
        workingDirectory: app.workingDirectory,
      });

      return {
        success: true,
        message: `Application "${app.name}" launched successfully.`,
        target: res.resolvedTarget,
        pid: res.pid,
      };
    } catch (err: any) {
      // Only attempt fallback open if the target actually exists on disk or is a URL/protocol
      const isUrlOrProtocol = app.targetPath.includes("://") || app.targetPath.startsWith("mailto:") || app.targetPath.startsWith("ms-settings:");
      if (fs.existsSync(app.targetPath) || isUrlOrProtocol) {
        console.warn(`[AppResolver] Shell launch failed for "${app.name}", trying fallback open...`);
        try {
          const subprocess = await open(app.targetPath);
          if (subprocess && typeof subprocess.unref === "function") {
            subprocess.unref();
          }
          return {
            success: true,
            message: `Application "${app.name}" opened via system fallback.`,
            target: app.targetPath,
            pid: subprocess?.pid,
          };
        } catch {}
      }

      // Extract human-readable error from PowerShell CLIXML or standard message
      let cleanErr = err.message || String(err);
      const match = cleanErr.match(/Exception calling "Start"[^:]*:\s*"([^"]+)"/);
      if (match) {
        cleanErr = match[1];
      } else if (cleanErr.includes("The system cannot find the file specified")) {
        cleanErr = "The system cannot find the file specified";
      }

      throw new Error(`Failed to launch "${app.name}": ${cleanErr}`);
    }
  }

  // Non-Windows (macOS / Linux)
  if (app.type === "shortcut") {
    const subprocess = await open(app.targetPath);
    if (subprocess && typeof subprocess.unref === "function") {
      subprocess.unref();
    }
    return {
      success: true,
      message: `Application "${app.name}" launched.`,
      target: app.targetPath,
      pid: subprocess?.pid,
    };
  }

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
  } catch (_err: any) {
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
  }
}
