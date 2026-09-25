import http from "node:http";
import readline from "node:readline";
import { Porcupine, BuiltinKeyword } from "@picovoice/porcupine-node";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { config } from "./config.js";
import { PhiliaBrain, type StatusEvent } from "./brain.js";
import { speak, synthesizeWav } from "./tts.js";
import { transcribeAudio } from "./stt.js";
import { browserClose } from "./tools/browser.js";
import { setAppConfirmationHandler } from "./tools/apps.js";
import { setBrowserConfirmationHandler } from "./tools/browser.js";
import { setFileWriteConfirmationHandler } from "./tools/filesWrite.js";
import { setCommandConfirmationHandler } from "./tools/system.js";
import { setCanvasConfirmationHandler } from "./tools/canvas.js";
import {
  isFullAccessGranted,
  grantFullAccess,
  revokeFullAccess,
  hasAskedFullAccess,
  recordAskedFullAccess,
  getPermissionsState,
  onPermissionsChanged,
} from "./permissions.js";

// Global readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Guardrail confirmation handler with "ask first, never again" logic
async function promptConfirmation(actionDescription: string): Promise<boolean> {
  // If Full Access is already granted, NEVER ask again!
  if (isFullAccessGranted()) {
    console.log(`[Full Access] 🔓 Auto-permitting action: ${actionDescription}`);
    return true;
  }

  console.log(`\n⚠️  [COMPUTER ACCESS PERMISSION REQUESTED]`);
  console.log(`Action: ${actionDescription}`);
  broadcastSse({
    type: "confirmation_required",
    message: actionDescription,
    fullAccessRequired: true,
  });

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      unsubscribe();
    };

    const unsubscribe = onPermissionsChanged((granted) => {
      if (granted && !settled) {
        cleanup();
        console.log(`[Permissions] Full access granted via UI/API. Proceeding with action...`);
        resolve(true);
      }
    });

    if (process.stdin.isTTY) {
      askQuestion(`Grant Philia Full Access to proceed? (y/N/always): `)
        .then((answer) => {
          if (settled) return;
          cleanup();
          const trimmed = answer.trim().toLowerCase();
          if (trimmed === "always" || trimmed === "full" || trimmed === "all" || trimmed === "y" || trimmed === "yes") {
            grantFullAccess();
            resolve(true);
          } else {
            resolve(false);
          }
        })
        .catch(() => {
          if (!settled) {
            cleanup();
            resolve(false);
          }
        });
    } else {
      // In non-interactive environment (daemon / background), wait up to 45s for UI grant
      setTimeout(() => {
        if (!settled) {
          cleanup();
          console.warn(`[Permissions] Timed out waiting for UI permission grant on: "${actionDescription}".`);
          resolve(false);
        }
      }, 45000);
    }
  });
}

setAppConfirmationHandler(promptConfirmation);
setBrowserConfirmationHandler(promptConfirmation);
setFileWriteConfirmationHandler(promptConfirmation);
setCommandConfirmationHandler(promptConfirmation);
setCanvasConfirmationHandler(promptConfirmation);

onPermissionsChanged((granted) => {
  broadcastSse({ type: "permissions_updated", fullAccessGranted: granted });
});

// Initialize Brain
const brain = new PhiliaBrain(config.geminiModel);

let isProcessing = false;
let isShuttingDown = false;
let porcupineInstance: Porcupine | null = null;
let recorderInstance: PvRecorder | null = null;
const sseClients: Set<http.ServerResponse> = new Set();

/**
 * Broadcast real-time SSE events to connected frontend clients
 */
export function broadcastSse(data: any) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Handle user command: process with brain, broadcast status, and speak
 */
export async function executeUserCommand(
  command: string,
  playVoiceOutLoud: boolean = true
): Promise<{ reply: string; toolsUsed: any[]; audioBase64?: string }> {
  if (!command || command.trim().length === 0) {
    return { reply: "", toolsUsed: [] };
  }

  isProcessing = true;
  broadcastSse({ type: "user_command", message: command });

  try {
    const result = await brain.process(command.trim(), (event: StatusEvent) => {
      broadcastSse(event);
    });

    let audioBase64: string | undefined;

    if (playVoiceOutLoud) {
      speak(result.reply).catch(() => {});
    } else {
      const wav = await synthesizeWav(result.reply);
      if (wav) audioBase64 = wav.toString("base64");
    }

    return {
      reply: result.reply,
      toolsUsed: result.toolsUsed,
      audioBase64,
    };
  } catch (err: any) {
    const errorMsg = "I encountered an error processing that request.";
    console.error(`[Philia Error] ❌`, err.message || err);
    broadcastSse({ type: "error", message: err.message || errorMsg });
    if (playVoiceOutLoud) speak(errorMsg).catch(() => {});
    return { reply: errorMsg, toolsUsed: [] };
  } finally {
    isProcessing = false;
  }
}

/**
 * Record speech frames until silence is detected
 */
async function recordCommandClip(recorder: PvRecorder): Promise<Buffer | null> {
  const recordedFrames: Int16Array[] = [];
  const maxSilenceFrames = 40;
  const maxTotalFrames = 300;
  const energyThreshold = 350;

  let silenceCount = 0;
  let hasVoiceStarted = false;

  for (let i = 0; i < maxTotalFrames && !isShuttingDown; i++) {
    const frame = await recorder.read();
    recordedFrames.push(frame);

    let sum = 0;
    for (let j = 0; j < frame.length; j++) {
      sum += frame[j] * frame[j];
    }
    const rms = Math.sqrt(sum / frame.length);

    if (rms > energyThreshold) {
      hasVoiceStarted = true;
      silenceCount = 0;
    } else if (hasVoiceStarted) {
      silenceCount++;
      if (silenceCount >= maxSilenceFrames) {
        break;
      }
    }
  }

  if (recordedFrames.length === 0) return null;

  const totalSamples = recordedFrames.reduce((acc, f) => acc + f.length, 0);
  const buffer = Buffer.alloc(totalSamples * 2);
  let offset = 0;

  for (const frame of recordedFrames) {
    for (let i = 0; i < frame.length; i++) {
      buffer.writeInt16LE(frame[i], offset);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Wake word background listener
 */
async function startVoiceListener() {
  if (!config.picovoiceAccessKey || config.picovoiceAccessKey.trim() === "") {
    console.log(`[Voice Wake-Word] PICOVOICE_ACCESS_KEY is empty in .env. Voice wake word offline.`);
    return;
  }

  try {
    porcupineInstance = new Porcupine(
      config.picovoiceAccessKey.trim(),
      [BuiltinKeyword.JARVIS],
      [0.65]
    );

    const devices = PvRecorder.getAvailableDevices();
    if (devices.length === 0) {
      console.warn(`[Voice Wake-Word] No microphone detected.`);
      return;
    }

    recorderInstance = new PvRecorder(porcupineInstance.frameLength, 0);
    recorderInstance.start();
    console.log(`[Voice Wake-Word] 🎙️ Always-listening active: "${recorderInstance.getSelectedDevice()}"`);

    while (!isShuttingDown) {
      try {
        if (isProcessing) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }

        const pcmFrame = await recorderInstance.read();
        const keywordIndex = porcupineInstance.process(pcmFrame);

        if (keywordIndex === 0) {
          console.log(`\n⚡ [Wake Word] "PHILIA" detected!`);
          broadcastSse({ type: "wake_word", message: "PHILIA detected" });
          await speak("Yes? How can I assist you?");

          broadcastSse({ type: "listening", message: "Listening..." });
          const commandAudio = await recordCommandClip(recorderInstance);

          if (commandAudio && commandAudio.length > 0) {
            broadcastSse({ type: "transcribing", message: "Transcribing speech..." });
            const transcribed = await transcribeAudio(commandAudio, true);
            if (transcribed && transcribed.length > 0) {
              console.log(`[User Spoke] 🗣️ "${transcribed}"`);
              await executeUserCommand(transcribed, true);
            } else {
              broadcastSse({ type: "idle", message: "Didn't catch that" });
              await speak("I didn't catch that.");
            }
          }
        }
      } catch {
        if (!isShuttingDown) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  } catch (err: any) {
    console.error(`[Voice Wake-Word] Initialization error:`, err.message || err);
  }
}

/**
 * Lightweight HTTP API Server for the Frontend and Desktop App
 */
function startApiServer() {
  const server = http.createServer(async (req, res) => {
    // CORS headers for local frontend
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || `127.0.0.1:${config.port}`;
    const url = new URL(req.url || "/", `http://${host}`);

    // SSE endpoint for live streaming events to UI
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("data: {\"type\":\"connected\"}\n\n");
      sseClients.add(res);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    // Helper to read JSON request body
    const readJsonBody = (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(e);
          }
        });
      });
    };

    try {
      if ((url.pathname === "/" || url.pathname === "") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "online",
          name: "Philia Desktop Assistant API",
          version: "1.0.0",
          model: config.geminiModel,
          platform: process.platform,
          fullAccessGranted: isFullAccessGranted(),
          askedFullAccess: hasAskedFullAccess(),
        }));
        return;
      }

      if (url.pathname === "/api/status" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "online",
          name: "Philia Desktop Assistant API",
          model: config.geminiModel,
          voiceName: config.geminiVoice,
          voiceWakeWordActive: Boolean(recorderInstance),
          platform: process.platform,
          fullAccessGranted: isFullAccessGranted(),
          askedFullAccess: hasAskedFullAccess(),
        }));
        return;
      }

      if (url.pathname === "/api/permissions" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          fullAccessGranted: isFullAccessGranted(),
          asked: hasAskedFullAccess(),
          state: getPermissionsState(),
        }));
        return;
      }

      if (url.pathname === "/api/permissions/grant" && req.method === "POST") {
        const resObj = grantFullAccess();
        broadcastSse({ type: "permissions_updated", fullAccessGranted: true });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resObj));
        return;
      }

      if (url.pathname === "/api/permissions/revoke" && req.method === "POST") {
        const resObj = revokeFullAccess();
        broadcastSse({ type: "permissions_updated", fullAccessGranted: false });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resObj));
        return;
      }

      if (url.pathname === "/api/permissions/asked" && req.method === "POST") {
        recordAskedFullAccess();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }


      if (url.pathname === "/api/chat" && req.method === "POST") {
        const body = await readJsonBody();
        const prompt = body.prompt || "";
        const playVoice = body.playVoice !== false;

        const result = await executeUserCommand(prompt, playVoice);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }

      if (url.pathname === "/api/voice/listen" && req.method === "POST") {
        // Record one clip from mic on demand and transcribe
        let mic = recorderInstance;
        let createdMic = false;

        if (!mic) {
          try {
            mic = new PvRecorder(512, 0);
            mic.start();
            createdMic = true;
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Mic error: ${err.message}` }));
            return;
          }
        }

        broadcastSse({ type: "listening", message: "Listening..." });
        const audio = await recordCommandClip(mic);

        if (createdMic) {
          mic.stop();
          mic.release();
        }

        if (!audio) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ transcript: "", reply: "No audio captured." }));
          return;
        }

        broadcastSse({ type: "transcribing", message: "Transcribing..." });
        const transcript = await transcribeAudio(audio, true);

        if (!transcript) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ transcript: "", reply: "Didn't catch that, sir." }));
          return;
        }

        const brainResult = await executeUserCommand(transcript, true);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          transcript,
          reply: brainResult.reply,
          toolsUsed: brainResult.toolsUsed,
        }));
        return;
      }

      if (url.pathname === "/api/voice/speak" && req.method === "POST") {
        const body = await readJsonBody();
        await speak(body.text || "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (url.pathname === "/api/reset" && req.method === "POST") {
        brain.reset();
        broadcastSse({ type: "reset", message: "Context reset" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Philia context cleared." }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Endpoint not found" }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Internal server error" }));
    }
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[API Server] 🚀 Philia HTTP & SSE service active at http://127.0.0.1:${config.port}`);
  });

  return server;
}

function runInteractiveCli() {
  if (!process.stdin.isTTY) {
    return;
  }

  const promptUser = () => {
    if (isShuttingDown) return;

    rl.question("Philia ❯ ", async (input) => {
      const command = input.trim();

      if (command.toLowerCase() === "exit" || command.toLowerCase() === "quit") {
        await shutdown();
        return;
      }

      if (command.length > 0) {
        const brainResult = await executeUserCommand(command, true);
        if (brainResult && brainResult.reply) {
          console.log(`\nPhilia ❯ ${brainResult.reply}\n`);
        }
      }

      promptUser();
    });
  };

  promptUser();
}

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Philia] Shutting down backend...`);

  if (recorderInstance) {
    try {
      recorderInstance.stop();
      recorderInstance.release();
    } catch {}
  }

  if (porcupineInstance) {
    try {
      porcupineInstance.release();
    } catch {}
  }

  await browserClose();
  rl.close();
  console.log(`[Philia] Offline. Goodbye.\n`);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  console.log("=================================================");
  console.log("     P.H.I.L.I.A. Desktop Assistant Backend      ");
  console.log("  Precise Holographic Intelligence & Logical Interface Assistant");
  console.log("=================================================");
  console.log(`Platform: ${process.platform} | Node: ${process.version}`);
  console.log(`Model: ${config.geminiModel} | Port: ${config.port}`);
  console.log(`Deny-List: ${config.denyList.length} rules active`);
  console.log("-------------------------------------------------");

  startApiServer();
  startVoiceListener().catch((err) => console.error("[Voice Listener Error]:", err));
  runInteractiveCli();
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
