import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

console.log("=========================================");
console.log("    Launching P.H.I.L.I.A. Desktop App   ");
console.log("=========================================\n");

const BACKEND_PORT = 4172;
const FRONTEND_PORT = 5173;

function checkPort(port) {
  return new Promise((resolve) => {
    let resolved = false;

    const s1 = net.createConnection({ port, host: "127.0.0.1" }, () => {
      if (!resolved) {
        resolved = true;
        s1.destroy();
        resolve(true);
      }
    });

    s1.on("error", () => {
      const s2 = net.createConnection({ port, host: "::1" }, () => {
        if (!resolved) {
          resolved = true;
          s2.destroy();
          resolve(true);
        }
      });
      s2.on("error", () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
      s2.setTimeout(500, () => {
        s2.destroy();
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });
    });

    s1.setTimeout(500, () => {
      s1.destroy();
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
  });
}

async function waitForServer(port, name, timeoutMs = 25000) {
  process.stdout.write(`Waiting for ${name} on port ${port}... `);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPort(port)) {
      console.log("Ready!");
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("Timed out.");
  return false;
}

// 1. Spawn backend if not already active
const isBackendUp = await checkPort(BACKEND_PORT);
let backendProcess = null;

if (!isBackendUp) {
  console.log("[Launcher] Starting Philia Backend daemon...");
  if (process.platform === "win32") {
    backendProcess = spawn("cmd.exe", ["/c", "npm start"], {
      cwd: path.resolve(process.cwd(), "backend"),
      stdio: ["ignore", "inherit", "inherit"],
    });
  } else {
    backendProcess = spawn("npm", ["start"], {
      cwd: path.resolve(process.cwd(), "backend"),
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
} else {
  console.log("[Launcher] Backend is already running on port " + BACKEND_PORT);
}

// 2. Spawn frontend dev server if not already active
const isFrontendUp = await checkPort(FRONTEND_PORT);
let frontendProcess = null;

if (!isFrontendUp) {
  console.log("[Launcher] Starting Frontend UI server...");
  if (process.platform === "win32") {
    frontendProcess = spawn("cmd.exe", ["/c", "npm run dev:vite"], {
      cwd: path.resolve(process.cwd(), "frontend"),
      stdio: ["ignore", "inherit", "inherit"],
    });
  } else {
    frontendProcess = spawn("npm", ["run", "dev:vite"], {
      cwd: path.resolve(process.cwd(), "frontend"),
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
} else {
  console.log("[Launcher] Frontend is already running on port " + FRONTEND_PORT);
}

await waitForServer(BACKEND_PORT, "Backend API");
await waitForServer(FRONTEND_PORT, "Frontend UI");

// 3. Launch Desktop Window in dedicated standalone mode
console.log("[Launcher] Opening compact P.H.I.L.I.A. desktop application window...");

const targetUrl = `http://127.0.0.1:${FRONTEND_PORT}`;
let launched = false;

if (process.platform === "win32") {
  // Launch in clean app-window mode using Edge or Chrome with custom size (380x580)
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  const browserExe = fs.existsSync(edgePath) ? edgePath : (fs.existsSync(chromePath) ? chromePath : null);

  if (browserExe) {
    const appWindow = spawn(browserExe, [
      `--app=${targetUrl}`,
      "--window-size=390,600",
      "--window-position=1200,200",
    ], { detached: true, stdio: "ignore" });
    appWindow.unref();
    launched = true;
  }
}

if (!launched) {
  // Fallback to default browser
  import("open").then(({ default: open }) => {
    open(targetUrl);
  });
}

console.log("\n=========================================");
console.log("   P.H.I.L.I.A. Desktop Assistant Online ");
console.log(`   UI: http://127.0.0.1:${FRONTEND_PORT}`);
console.log(`   API: http://127.0.0.1:${BACKEND_PORT}`);
console.log("=========================================\n");

process.on("SIGINT", () => {
  if (backendProcess) backendProcess.kill();
  if (frontendProcess) frontendProcess.kill();
  process.exit(0);
});
