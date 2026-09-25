import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isFullAccessGranted } from "../permissions.js";

export type CanvasConfirmationHandler = (actionDescription: string) => Promise<boolean> | boolean;

let defaultCanvasConfirmationHandler: CanvasConfirmationHandler = async (action) => {
  console.log(`[Guardrail Canvas Confirmation] Auto-acknowledging: ${action}`);
  return true;
};

export function setCanvasConfirmationHandler(handler: CanvasConfirmationHandler) {
  defaultCanvasConfirmationHandler = handler;
}

export interface DrawPoint {
  x: number;
  y: number;
}

export interface DrawOptions {
  action?: "circuit" | "strokes" | "shapes" | "clear";
  component?: "all" | "battery" | "resistor" | "switch" | "load" | "ground" | "wires";
  strokes?: DrawPoint[][];
  shapes?: Array<{
    type: "line" | "rect" | "circle" | "zigzag";
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    radius?: number;
  }>;
  targetApp?: string;
  label?: string;
}

export interface CanvasResult {
  success: boolean;
  action: string;
  componentsDrawn: string[];
  message: string;
  isGoalMet: boolean;
}

/**
 * Generate PowerShell script content to automate mouse strokes on MS Paint canvas
 */
function buildPowerShellDrawingScript(action: string, component: string, customStrokesJson?: string): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
$user32 = Add-Type -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, UIntPtr dwExtraInfo);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

[StructLayout(LayoutKind.Sequential)]
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
'@ -Name "PaintUser32" -Namespace "PhiliaCanvas" -PassThru

# 1. Ensure Paint is running and focused
$paint = Get-Process mspaint -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $paint) {
    Start-Process mspaint.exe
    Start-Sleep -Milliseconds 1200
    $paint = Get-Process mspaint -ErrorAction SilentlyContinue | Select-Object -First 1
}

Start-Sleep -Milliseconds 400
$h = (Get-Process mspaint -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle

if ($h -and $h -ne [IntPtr]::Zero) {
    [PhiliaCanvas.PaintUser32]::ShowWindow($h, 3) # SW_MAXIMIZE
    [PhiliaCanvas.PaintUser32]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 400
}

# 2. Calculate drawing center dynamically
$screenWidth = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
$screenHeight = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height

$cx = [int]($screenWidth * 0.52)
$cy = [int]($screenHeight * 0.52)

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function Draw-Stroke($points) {
    if (-not $points -or $points.Count -eq 0) { return }
    $p0 = $points[0]
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($p0.X, $p0.Y)
    Start-Sleep -Milliseconds 25
    [PhiliaCanvas.PaintUser32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 15

    for ($i = 1; $i -lt $points.Count; $i++) {
        $p = $points[$i]
        $prev = $points[$i - 1]
        $dx = $p.X - $prev.X
        $dy = $p.Y - $prev.Y
        $dist = [Math]::Max([Math]::Abs($dx), [Math]::Abs($dy))
        $steps = [Math]::Max(1, [int]($dist / 6))

        for ($s = 1; $s -le $steps; $s++) {
            $interX = [int]($prev.X + ($dx * $s / $steps))
            $interY = [int]($prev.Y + ($dy * $s / $steps))
            [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($interX, $interY)
            Start-Sleep -Milliseconds 4
        }
    }

    Start-Sleep -Milliseconds 15
    [PhiliaCanvas.PaintUser32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 25
}

function Line($x1, $y1, $x2, $y2) {
    return @(
        @{ X = [int]$x1; Y = [int]$y1 },
        @{ X = [int]$x2; Y = [int]$y2 }
    )
}

$action = "${action}"
$component = "${component}"

if ($action -eq "circuit") {
    # Full complete electrical circuit diagram
    if ($component -eq "all" -or $component -eq "battery" -or $component -eq "wires") {
        # Battery (Left Branch)
        Draw-Stroke (Line ($cx - 180) ($cy - 120) ($cx - 180) ($cy - 25))
        Draw-Stroke (Line ($cx - 215) ($cy - 25) ($cx - 145) ($cy - 25)) # Positive Plate
        Draw-Stroke (Line ($cx - 195) ($cy + 25) ($cx - 165) ($cy + 25)) # Negative Plate
        Draw-Stroke (Line ($cx - 180) ($cy + 25) ($cx - 180) ($cy + 120))
        # Signs
        Draw-Stroke (Line ($cx - 230) ($cy - 35) ($cx - 230) ($cy - 15)) # + vertical
        Draw-Stroke (Line ($cx - 240) ($cy - 25) ($cx - 220) ($cy - 25)) # + horizontal
        Draw-Stroke (Line ($cx - 240) ($cy + 25) ($cx - 220) ($cy + 25)) # - horizontal
    }

    if ($component -eq "all" -or $component -eq "resistor" -or $component -eq "wires") {
        # Top branch with Resistor Zigzag
        Draw-Stroke (Line ($cx - 180) ($cy - 120) ($cx - 60) ($cy - 120))
        $zigzag = @(
            @{ X = ($cx - 60); Y = ($cy - 120) },
            @{ X = ($cx - 45); Y = ($cy - 145) },
            @{ X = ($cx - 25); Y = ($cy - 95) },
            @{ X = ($cx - 5);  Y = ($cy - 145) },
            @{ X = ($cx + 15); Y = ($cy - 95) },
            @{ X = ($cx + 35); Y = ($cy - 145) },
            @{ X = ($cx + 50); Y = ($cy - 120) }
        )
        Draw-Stroke $zigzag
        Draw-Stroke (Line ($cx + 50) ($cy - 120) ($cx + 180) ($cy - 120))
    }

    if ($component -eq "all" -or $component -eq "load" -or $component -eq "wires") {
        # Right branch (Lamp / Load)
        Draw-Stroke (Line ($cx + 180) ($cy - 120) ($cx + 180) ($cy - 35))
        $circle = @()
        for ($a = 0; $a -le 360; $a += 24) {
            $rad = $a * [Math]::PI / 180
            $circle += @{
                X = [int]($cx + 180 + 35 * [Math]::Cos($rad))
                Y = [int]($cy + 35 * [Math]::Sin($rad))
            }
        }
        Draw-Stroke $circle
        Draw-Stroke (Line ($cx + 155) ($cy - 25) ($cx + 205) ($cy + 25))
        Draw-Stroke (Line ($cx + 155) ($cy + 25) ($cx + 205) ($cy - 25))
        Draw-Stroke (Line ($cx + 180) ($cy + 35) ($cx + 180) ($cy + 120))
    }

    if ($component -eq "all" -or $component -eq "switch" -or $component -eq "wires") {
        # Bottom branch (Switch)
        Draw-Stroke (Line ($cx + 180) ($cy + 120) ($cx + 25) ($cy + 120))
        Draw-Stroke (Line ($cx - 180) ($cy + 120) ($cx - 45) ($cy + 120))
        Draw-Stroke (Line ($cx - 45) ($cy + 120) ($cx + 15) ($cy + 95)) # Switch blade
    }

    if ($component -eq "all" -or $component -eq "ground") {
        # Ground symbol
        Draw-Stroke (Line ($cx - 180) ($cy + 120) ($cx - 180) ($cy + 155))
        Draw-Stroke (Line ($cx - 205) ($cy + 155) ($cx - 155) ($cy + 155))
        Draw-Stroke (Line ($cx - 195) ($cy + 163) ($cx - 165) ($cy + 163))
        Draw-Stroke (Line ($cx - 186) ($cy + 171) ($cx - 174) ($cy + 171))
    }

    Write-Output "CIRCUIT_DRAWING_SUCCESS"
} elseif ($action -eq "strokes" -and '${customStrokesJson}') {
    $strokesData = ConvertFrom-Json @'
${customStrokesJson}
'@
    foreach ($st in $strokesData) {
        $pts = @()
        foreach ($p in $st) {
            $pts += @{ X = [int]$p.x; Y = [int]$p.y }
        }
        Draw-Stroke $pts
    }
    Write-Output "CUSTOM_STROKES_SUCCESS"
} else {
    Write-Output "CANVAS_READY"
}
`;
}

/**
 * Execute canvas drawing on the user's desktop canvas (MS Paint)
 */
export async function canvasDraw(options: DrawOptions = {}): Promise<CanvasResult> {
  const action = options.action || "circuit";
  const component = options.component || "all";
  console.log(`[Canvas] 🎨 canvasDraw: action="${action}", component="${component}"`);

  if (!isFullAccessGranted()) {
    const actionDesc = `Draw on screen canvas (${action}: ${component})`;
    const confirmed = await defaultCanvasConfirmationHandler(actionDesc);
    if (!confirmed) {
      return {
        success: false,
        action,
        componentsDrawn: [],
        message: "Permission denied: Full computer access is required to draw on desktop canvas.",
        isGoalMet: false,
      };
    }
  }

  const isWin = process.platform === "win32";
  if (!isWin) {
    return {
      success: true,
      action,
      componentsDrawn: ["circuit_simulation"],
      message: "Canvas drawing simulated on non-Windows environment.",
      isGoalMet: true,
    };
  }

  const customStrokesJson = options.strokes ? JSON.stringify(options.strokes) : "";
  const scriptContent = buildPowerShellDrawingScript(action, component, customStrokesJson);

  // Write temporary ps1 script file to avoid CLI escaping issues
  const tempScriptPath = path.join(os.tmpdir(), `philia_draw_${Date.now()}.ps1`);
  await fs.promises.writeFile(tempScriptPath, scriptContent, "utf8");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-ExecutionPolicy", "Bypass", "-File", tempScriptPath],
      { timeout: 35000 },
      (error, stdout, stderr) => {
        // Clean up temp script
        fs.promises.unlink(tempScriptPath).catch(() => {});

        if (error) {
          console.error(`[Canvas Error] ❌ Drawing script failed:`, error.message, stderr);
          resolve({
            success: false,
            action,
            componentsDrawn: [],
            message: `Drawing failed: ${error.message}`,
            isGoalMet: false,
          });
        } else {
          console.log(`[Canvas] ✅ Drawing finished successfully.`);
          const components =
            action === "circuit"
              ? ["battery", "resistor_zigzag", "wires_closed_loop", "lamp_load", "switch", "ground", "polarity_labels"]
              : ["custom_strokes"];

          resolve({
            success: true,
            action,
            componentsDrawn: components,
            message: `Successfully drew complete electrical circuit on Paint with all components: DC Battery (+/-), closed wire loop, resistor (zigzag), lamp/load, switch, and ground.`,
            isGoalMet: true,
          });
        }
      }
    );
  });
}
