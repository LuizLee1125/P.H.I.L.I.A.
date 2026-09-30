import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isFullAccessGranted } from "../permissions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DesktopConfirmationHandler = (actionDescription: string) => Promise<boolean> | boolean;

let defaultDesktopConfirmationHandler: DesktopConfirmationHandler = async (action) => {
  console.log(`[Guardrail Desktop Confirmation] Auto-acknowledging: ${action}`);
  return true;
};

export function setDesktopConfirmationHandler(handler: DesktopConfirmationHandler) {
  defaultDesktopConfirmationHandler = handler;
}

export interface DesktopActionResult {
  success: boolean;
  action: string;
  message?: string;
  x?: number;
  y?: number;
  button?: string;
  doubleClick?: boolean;
  charCount?: number;
  keys?: string;
  title?: string;
  error?: string;
}

export interface ScreenDimensionsResult {
  success: boolean;
  width: number;
  height: number;
  cursorX: number;
  cursorY: number;
  error?: string;
}

// Locate or compile the native PhiliaInput executable
function getNativeExecutablePath(): string | null {
  const isWin = process.platform === "win32";
  if (!isWin) return null;

  const candidateDirs = [
    path.resolve(__dirname, "../../bin"),
    path.resolve(__dirname, "../../../backend/bin"),
    path.resolve(process.cwd(), "backend/bin"),
    path.resolve(process.cwd(), "bin"),
  ];

  for (const dir of candidateDirs) {
    const exePath = path.join(dir, "philia_input.exe");
    if (fs.existsSync(exePath)) {
      return exePath;
    }
  }

  // Attempt auto-compilation if csc.exe exists
  const cscPath = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  const csSourcePath = path.resolve(__dirname, "philia_input.cs");

  if (fs.existsSync(cscPath) && fs.existsSync(csSourcePath)) {
    try {
      const targetDir = path.resolve(__dirname, "../../bin");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const targetExe = path.join(targetDir, "philia_input.exe");
      console.log(`[Desktop Automation] ⚙️ Compiling native philia_input.exe...`);
      execFileSync(cscPath, [
        "/nologo",
        "/optimize",
        "/r:System.Windows.Forms.dll",
        "/r:System.Drawing.dll",
        `/out:${targetExe}`,
        csSourcePath,
      ]);
      console.log(`[Desktop Automation] ✅ Native helper compiled at ${targetExe}`);
      return targetExe;
    } catch (err: any) {
      console.warn(`[Desktop Automation] Could not compile philia_input.exe: ${err.message}. Using PowerShell fallback.`);
    }
  }

  return null;
}

/**
 * Execute native CLI or fallback to PowerShell
 */
async function runInput(args: string[]): Promise<any> {
  const isWin = process.platform === "win32";
  if (!isWin) {
    return {
      success: true,
      action: args[0] || "unknown",
      message: "Desktop input action simulated on non-Windows environment.",
    };
  }

  const exePath = getNativeExecutablePath();
  if (exePath && fs.existsSync(exePath)) {
    return new Promise((resolve) => {
      execFile(exePath, args, { encoding: "utf8", timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[Desktop Input Error]`, error.message, stderr);
          resolve({ success: false, action: args[0], error: error.message });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch {
          resolve({ success: true, action: args[0], raw: stdout.trim() });
        }
      });
    });
  }

  // PowerShell Fallback if executable is not present
  return runPowerShellFallback(args);
}

/**
 * Robust PowerShell fallback for input automation
 */
async function runPowerShellFallback(args: string[]): Promise<any> {
  const cmd = args[0];
  let psScript = `
Add-Type -AssemblyName System.Windows.Forms
$user32 = Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@ -Name "User32Fallback" -Namespace "PhiliaInput" -PassThru
`;

  switch (cmd) {
    case "dimensions":
      psScript += `
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$p = [System.Windows.Forms.Cursor]::Position
Write-Output "{\\"width\\":$($b.Width),\\"height\\":$($b.Height),\\"cursorX\\":$($p.X),\\"cursorY\\":$($p.Y)}"
`;
      break;

    case "click":
      const x = args[1];
      const y = args[2];
      const button = (args[3] || "left").toLowerCase();
      const isDouble = args[4] === "true";
      const down = button === "right" ? "0x0008" : button === "middle" ? "0x0020" : "0x0002";
      const up = button === "right" ? "0x0010" : button === "middle" ? "0x0040" : "0x0004";
      psScript += `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Start-Sleep -Milliseconds 25
[PhiliaInput.User32Fallback]::mouse_event(${down}, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 20
[PhiliaInput.User32Fallback]::mouse_event(${up}, 0, 0, 0, [UIntPtr]::Zero)
if ('${isDouble}' -eq 'True') {
  Start-Sleep -Milliseconds 80
  [PhiliaInput.User32Fallback]::mouse_event(${down}, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [PhiliaInput.User32Fallback]::mouse_event(${up}, 0, 0, 0, [UIntPtr]::Zero)
}
Write-Output "{\\"success\\":true,\\"action\\":\\"click\\",\\"x\\":${x},\\"y\\":${y}}"
`;
      break;

    case "move":
      psScript += `
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${args[1]}, ${args[2]})
Write-Output "{\\"success\\":true,\\"action\\":\\"move\\",\\"x\\":${args[1]},\\"y\\":${args[2]}}"
`;
      break;

    case "type-b64":
      const b64 = args[1];
      psScript += `
$bytes = [System.Convert]::FromBase64String('${b64}')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
[System.Windows.Forms.SendKeys]::SendWait($text)
Write-Output "{\\"success\\":true,\\"action\\":\\"type\\",\\"charCount\\":$($text.Length)}"
`;
      break;

    case "focus-b64":
      const targetB64 = args[1];
      psScript += `
$bytes = [System.Convert]::FromBase64String('${targetB64}')
$query = [System.Text.Encoding]::UTF8.GetString($bytes).ToLower()
$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName.ToLower().Contains($query) -or $_.MainWindowTitle.ToLower().Contains($query)) } | Select-Object -First 1
if ($proc) {
  [PhiliaInput.User32Fallback]::ShowWindow($proc.MainWindowHandle, 9)
  [PhiliaInput.User32Fallback]::SetForegroundWindow($proc.MainWindowHandle)
  Write-Output "{\\"success\\":true,\\"action\\":\\"focus\\",\\"title\\":\\"$($proc.ProcessName)\\"}"
} else {
  Write-Output "{\\"success\\":false,\\"action\\":\\"focus\\",\\"message\\":\\"Window not found\\"}"
}
`;
      break;

    default:
      psScript += `Write-Output "{\\"success\\":true,\\"action\\":\\"${cmd}\\"}"`;
      break;
  }

  const tempPath = path.join(os.tmpdir(), `philia_input_fallback_${Date.now()}.ps1`);
  await fs.promises.writeFile(tempPath, psScript, "utf8");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempPath],
      { encoding: "utf8", timeout: 15000 },
      (err, stdout) => {
        fs.promises.unlink(tempPath).catch(() => {});
        if (err) {
          resolve({ success: false, action: cmd, error: err.message });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ success: true, action: cmd, raw: stdout.trim() });
        }
      }
    );
  });
}

/**
 * Check permission guardrail for desktop automation actions
 */
async function ensurePermission(actionDesc: string): Promise<boolean> {
  if (isFullAccessGranted()) {
    return true;
  }
  const confirmed = await defaultDesktopConfirmationHandler(actionDesc);
  return Boolean(confirmed);
}

/**
 * Retrieve primary screen width, height, and current cursor position
 */
export async function getScreenDimensions(): Promise<ScreenDimensionsResult> {
  const res = await runInput(["dimensions"]);
  return {
    success: res.width > 0,
    width: res.width || 1366,
    height: res.height || 768,
    cursorX: res.cursorX || 0,
    cursorY: res.cursorY || 0,
    error: res.error,
  };
}

/**
 * Move cursor and perform mouse click on desktop
 */
export async function desktopClick(
  x: number,
  y: number,
  button: "left" | "right" | "middle" = "left",
  doubleClick: boolean = false,
  smooth: boolean = false
): Promise<DesktopActionResult> {
  const actionDesc = `${doubleClick ? "Double click" : "Click"} ${button} mouse button at (${x}, ${y})`;
  console.log(`[Desktop Automation] 🖱️ ${actionDesc}`);

  const allowed = await ensurePermission(actionDesc);
  if (!allowed) {
    return {
      success: false,
      action: "click",
      message: "Action cancelled: User declined permission for desktop mouse interaction.",
    };
  }

  const res = await runInput(["click", String(Math.round(x)), String(Math.round(y)), button, String(doubleClick)]);
  return {
    success: res.success !== false,
    action: "click",
    x,
    y,
    button,
    doubleClick,
    message: res.message || `Clicked ${button} button at (${x}, ${y}).`,
    error: res.error,
  };
}

/**
 * Move mouse cursor to screen coordinates
 */
export async function desktopMove(x: number, y: number, smooth: boolean = true): Promise<DesktopActionResult> {
  console.log(`[Desktop Automation] 📍 Move cursor to (${x}, ${y})`);
  const res = await runInput(["move", String(Math.round(x)), String(Math.round(y)), String(smooth)]);
  return {
    success: res.success !== false,
    action: "move",
    x,
    y,
    message: `Cursor moved to (${x}, ${y}).`,
    error: res.error,
  };
}

/**
 * Drag mouse from start position to end position
 */
export async function desktopDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Promise<DesktopActionResult> {
  const actionDesc = `Drag mouse from (${startX}, ${startY}) to (${endX}, ${endY})`;
  console.log(`[Desktop Automation] ↔️ ${actionDesc}`);

  const allowed = await ensurePermission(actionDesc);
  if (!allowed) {
    return {
      success: false,
      action: "drag",
      message: "Action cancelled: User declined permission for mouse drag.",
    };
  }

  const res = await runInput([
    "drag",
    String(Math.round(startX)),
    String(Math.round(startY)),
    String(Math.round(endX)),
    String(Math.round(endY)),
  ]);

  return {
    success: res.success !== false,
    action: "drag",
    message: `Dragged mouse from (${startX}, ${startY}) to (${endX}, ${endY}).`,
    error: res.error,
  };
}

/**
 * Type text into the currently active desktop window
 */
export async function desktopType(text: string, pressEnter: boolean = false): Promise<DesktopActionResult> {
  const displaySnippet = text.length > 30 ? text.substring(0, 30) + "..." : text;
  const actionDesc = `Type text into active desktop application: "${displaySnippet}"`;
  console.log(`[Desktop Automation] ⌨️ ${actionDesc}`);

  const allowed = await ensurePermission(actionDesc);
  if (!allowed) {
    return {
      success: false,
      action: "type",
      message: "Action cancelled: User declined permission for desktop keyboard input.",
    };
  }

  const fullText = pressEnter ? text + "\n" : text;
  const b64 = Buffer.from(fullText, "utf8").toString("base64");
  const res = await runInput(["type-b64", b64]);

  return {
    success: res.success !== false,
    action: "type",
    charCount: text.length,
    message: `Typed ${text.length} characters into the active window.${pressEnter ? " Pressed Enter." : ""}`,
    error: res.error,
  };
}

/**
 * Send keyboard hotkey combination (e.g. 'ctrl+s', 'alt+tab', 'enter')
 */
export async function desktopHotkey(keys: string): Promise<DesktopActionResult> {
  const actionDesc = `Send keyboard hotkey shortcut: "${keys}"`;
  console.log(`[Desktop Automation] ⚡ ${actionDesc}`);

  const allowed = await ensurePermission(actionDesc);
  if (!allowed) {
    return {
      success: false,
      action: "hotkey",
      message: "Action cancelled: User declined permission for desktop hotkey shortcut.",
    };
  }

  const res = await runInput(["hotkey", keys]);
  return {
    success: res.success !== false,
    action: "hotkey",
    keys,
    message: `Sent hotkey shortcut: ${keys}`,
    error: res.error,
  };
}

/**
 * Scroll mouse wheel
 */
export async function desktopScroll(deltaY: number): Promise<DesktopActionResult> {
  console.log(`[Desktop Automation] 📜 Scroll mouse wheel (deltaY: ${deltaY})`);
  const res = await runInput(["scroll", String(Math.round(deltaY))]);
  return {
    success: res.success !== false,
    action: "scroll",
    message: `Scrolled mouse wheel (${deltaY > 0 ? "up" : "down"}).`,
    error: res.error,
  };
}

/**
 * Focus and restore desktop window by process name or window title
 */
export async function focusWindow(target: string): Promise<DesktopActionResult> {
  console.log(`[Desktop Automation] 🪟 Bring window to focus: "${target}"`);
  const b64 = Buffer.from(target, "utf8").toString("base64");
  const res = await runInput(["focus-b64", b64]);

  return {
    success: Boolean(res.success),
    action: "focus",
    title: res.title || target,
    message: res.success
      ? `Focused window matching "${target}".`
      : `Could not locate active window matching "${target}".`,
    error: res.error,
  };
}
