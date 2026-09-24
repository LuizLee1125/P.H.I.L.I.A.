import readline from "node:readline";
import { Porcupine, BuiltinKeyword } from "@picovoice/porcupine-node";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { config } from "./config.js";
import { PhiliaBrain } from "./brain.js";
import { speak } from "./tts.js";
import { transcribeAudio } from "./stt.js";
import { browserClose } from "./tools/browser.js";
import { setAppConfirmationHandler } from "./tools/apps.js";
import { setBrowserConfirmationHandler } from "./tools/browser.js";
import { setFileWriteConfirmationHandler } from "./tools/filesWrite.js";
import { setCommandConfirmationHandler } from "./tools/system.js";
import { isFullAccessGranted, grantFullAccess } from "./permissions.js";

// Global readline interface for CLI commands & guardrail confirmations
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Wire guardrail confirmation prompts to interactive terminal
async function promptConfirmation(actionDescription: string): Promise<boolean> {
  if (isFullAccessGranted()) {
    console.log(`[Full Access] 🔓 Auto-permitting action: ${actionDescription}`);
    return true;
  }

  console.log(`\n⚠️  [COMPUTER ACCESS PERMISSION REQUESTED]`);
  console.log(`Action: ${actionDescription}`);
  const answer = await askQuestion(`Grant Philia Full Access to proceed? (y/N/always): `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "always" || trimmed === "full") {
    grantFullAccess();
    return true;
  }
  const confirmed = trimmed === "y" || trimmed === "yes";
  if (confirmed) {
    grantFullAccess();
  }
  return confirmed;
}

setAppConfirmationHandler(promptConfirmation);
setBrowserConfirmationHandler(promptConfirmation);
setFileWriteConfirmationHandler(promptConfirmation);
setCommandConfirmationHandler(promptConfirmation);


// Initialize Brain
const brain = new PhiliaBrain(config.geminiModel);

let isProcessing = false;
let isShuttingDown = false;
let porcupineInstance: Porcupine | null = null;
let recorderInstance: PvRecorder | null = null;

/**
 * Handle a user prompt: process with brain and speak response.
 */
async function handleUserCommand(command: string) {
  if (!command || command.trim().length === 0) return;
  isProcessing = true;

  try {
    const reply = await brain.process(command.trim());
    await speak(reply);
  } catch (err: any) {
    console.error(`[Philia Error] ❌`, err.message || err);
    await speak("I encountered an error processing that request.");
  } finally {
    isProcessing = false;
  }
}

/**
 * Start background voice listener with Porcupine wake-word and PvRecorder.
 */
async function startVoiceListener() {
  if (!config.picovoiceAccessKey || config.picovoiceAccessKey.trim() === "") {
    console.log(`\nℹ️  [Voice Wake-Word] PICOVOICE_ACCESS_KEY is empty in .env.`);
    console.log(`   You can interact fully via typed text in the console right now.`);
    console.log(`   To enable hands-free "PHILIA" wake-word listening:`);
    console.log(`   1. Grab a free key at https://console.picovoice.ai/`);
    console.log(`   2. Set PICOVOICE_ACCESS_KEY in your .env file.\n`);
    return;
  }

  try {
    console.log(`[Voice Wake-Word] Initializing Porcupine wake word engine...`);
    porcupineInstance = new Porcupine(
      config.picovoiceAccessKey.trim(),
      [BuiltinKeyword.JARVIS],
      [0.65] // Sensitivity
    );

    const devices = PvRecorder.getAvailableDevices();
    console.log(`[Voice Wake-Word] Available Microphones:`, devices);
    if (devices.length === 0) {
      console.warn(`[Voice Wake-Word] ⚠️ No microphone devices detected. Running in text-only mode.`);
      return;
    }

    recorderInstance = new PvRecorder(porcupineInstance.frameLength, 0);
    recorderInstance.start();
    console.log(`[Voice Wake-Word] 🎙️ Always-listening active using device: "${recorderInstance.getSelectedDevice()}"`);
    console.log(`   Say "PHILIA" to activate voice control.\n`);

    listenLoop();
  } catch (err: any) {
    console.error(`[Voice Wake-Word] ⚠️ Failed to initialize wake word engine:`, err.message || err);
    console.log(`Continuing in interactive CLI mode.\n`);
  }
}

/**
 * Main wake-word and voice command recording loop
 */
async function listenLoop() {
  if (!porcupineInstance || !recorderInstance) return;

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
        await speak("Yes? How may I assist you?");

        console.log(`[Mic] 🔴 Recording command clip (speak now)...`);
        const commandAudio = await recordCommandClip(recorderInstance);

        if (commandAudio && commandAudio.length > 0) {
          const transcribed = await transcribeAudio(commandAudio, true);
          if (transcribed && transcribed.length > 0) {
            console.log(`[User Spoke] 🗣️ "${transcribed}"`);
            await handleUserCommand(transcribed);
          } else {
            console.log(`[Philia] Didn't catch that.`);
            await speak("I didn't catch that.");
          }
        }
      }
    } catch (err: any) {
      if (!isShuttingDown) {
        console.error(`[Voice Loop Error]:`, err.message || err);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}

/**
 * Record speech frames until silence is detected (VAD: Voice Activity Detection)
 */
async function recordCommandClip(recorder: PvRecorder): Promise<Buffer | null> {
  const recordedFrames: Int16Array[] = [];
  const maxSilenceFrames = 45; // ~1.5s of silence at 32ms/frame
  const maxTotalFrames = 300;   // ~10s maximum recording time
  const energyThreshold = 350;  // RMS amplitude threshold for voice activity

  let silenceCount = 0;
  let hasVoiceStarted = false;

  for (let i = 0; i < maxTotalFrames && !isShuttingDown; i++) {
    const frame = await recorder.read();
    recordedFrames.push(frame);

    // Compute Root-Mean-Square (RMS) frame energy
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
        console.log(`[Mic] ⏹️ End of speech detected (${recordedFrames.length} frames).`);
        break;
      }
    }
  }

  if (recordedFrames.length === 0) return null;

  // Combine Int16Array frames into a single Buffer
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
 * Text-based interactive command prompt
 */
function runInteractivePrompt() {
  const promptUser = () => {
    if (isShuttingDown) return;

    rl.question("Philia ❯ ", async (input) => {
      const command = input.trim();

      if (command.toLowerCase() === "exit" || command.toLowerCase() === "quit") {
        await shutdown();
        return;
      }

      if (command.length > 0) {
        await handleUserCommand(command);
      }

      promptUser();
    });
  };

  promptUser();
}

/**
 * Graceful application shutdown
 */
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Philia] Shutting down services...`);

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

/**
 * Main entry point
 */
async function main() {
  console.log("=================================================");
  console.log("       P.H.I.L.I.A. Desktop Voice Assistant      ");
  console.log("  Precise Holographic Intelligence & Logical Interface Assistant");
  console.log("=================================================");
  console.log(`Platform: ${process.platform} | Node: ${process.version}`);
  console.log(`Gemini Model: ${config.geminiModel}`);
  console.log(`System Deny-List: ${config.denyList.length} rules loaded`);
  console.log(`Browser: Playwright Headless=${config.browserHeadless}`);
  console.log("-------------------------------------------------");

  // Welcome chime/speech
  speak("Philia is online and ready.").catch(() => {});

  // Start background wake-word listener (if key provided)
  startVoiceListener().catch((err) => {
    console.error("[Voice Listener Error]:", err);
  });

  // Start interactive terminal prompt
  runInteractivePrompt();
}

main().catch((err) => {
  console.error("Fatal initialization error:", err);
  process.exit(1);
});
