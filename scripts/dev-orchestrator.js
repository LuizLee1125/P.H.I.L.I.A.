import { spawn, execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");

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
  process.stdout.write(`[Dev Orchestrator] Waiting for ${name} on port ${port}... `);
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

let backendProcess = null;
let viteProcess = null;
let isShuttingDown = false;

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } catch {}
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
}

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("\n[Dev Orchestrator] Gracefully shutting down Philia dev services...");

  if (backendProcess && backendProcess.pid) {
    killProcessTree(backendProcess.pid);
  }
  if (viteProcess && viteProcess.pid) {
    killProcessTree(viteProcess.pid);
  }

  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", () => {
  if (backendProcess && backendProcess.pid) killProcessTree(backendProcess.pid);
  if (viteProcess && viteProcess.pid) killProcessTree(viteProcess.pid);
});

async function start() {
  console.log("=========================================");
  console.log("  P.H.I.L.I.A. Full-Stack Dev Services  ");
  console.log("=========================================");

  // 1. Backend Daemon
  const isBackendUp = await checkPort(BACKEND_PORT);
  if (!isBackendUp) {
    console.log(`[Dev Orchestrator] Starting Philia Backend daemon on port ${BACKEND_PORT}...`);
    if (process.platform === "win32") {
      backendProcess = spawn("cmd.exe", ["/c", "npm start"], {
        cwd: backendDir,
        stdio: ["ignore", "inherit", "inherit"],
      });
    } else {
      backendProcess = spawn("npm", ["start"], {
        cwd: backendDir,
        stdio: ["ignore", "inherit", "inherit"],
      });
    }

    backendProcess.on("exit", (code) => {
      if (!isShuttingDown && code !== 0 && code !== null) {
        console.error(`[Dev Orchestrator] Backend exited unexpectedly with code ${code}`);
      }
    });

    await waitForServer(BACKEND_PORT, "Backend API");
  } else {
    console.log(`[Dev Orchestrator] Backend is already running on port ${BACKEND_PORT}.`);
  }

  // 2. Frontend Dev Server (Vite)
  const isFrontendUp = await checkPort(FRONTEND_PORT);
  if (!isFrontendUp) {
    console.log(`[Dev Orchestrator] Starting Frontend Vite dev server on port ${FRONTEND_PORT}...`);
    if (process.platform === "win32") {
      viteProcess = spawn("cmd.exe", ["/c", "npm run dev:vite"], {
        cwd: frontendDir,
        stdio: ["ignore", "inherit", "inherit"],
      });
    } else {
      viteProcess = spawn("npm", ["run", "dev:vite"], {
        cwd: frontendDir,
        stdio: ["ignore", "inherit", "inherit"],
      });
    }

    viteProcess.on("exit", (code) => {
      if (!isShuttingDown && code !== 0 && code !== null) {
        console.error(`[Dev Orchestrator] Vite server exited with code ${code}`);
      }
    });

    await waitForServer(FRONTEND_PORT, "Frontend Vite");
  } else {
    console.log(`[Dev Orchestrator] Frontend is already running on port ${FRONTEND_PORT}.`);
  }

  console.log("=========================================");
  console.log("  All Philia Services Active & Ready     ");
  console.log(`  Backend:  http://127.0.0.1:${BACKEND_PORT}`);
  console.log(`  Frontend: http://localhost:${FRONTEND_PORT}`);
  console.log("=========================================\n");

  // Keep dev orchestrator process alive until explicitly terminated
  await new Promise(() => {});
}

start().catch((err) => {
  console.error("[Dev Orchestrator] Fatal error:", err);
  cleanup();
});
