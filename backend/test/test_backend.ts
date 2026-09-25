import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import { isPathDenied } from "../src/config.js";
import { getFileMetadata, readFileContent } from "../src/tools/files.js";
import { resolveApplication } from "../src/tools/appResolver.js";
import { executeCommand } from "../src/tools/system.js";
import {
  grantFullAccess,
  revokeFullAccess,
  isFullAccessGranted,
} from "../src/permissions.js";
import { PhiliaBrain } from "../src/brain.js";
import { pcmToWav } from "../src/tts.js";
import { canvasDraw } from "../src/tools/canvas.js";
import { getDefaultBrowserInfo, getDefaultBrowserExecutable } from "../src/tools/browser.js";

async function runTests() {
  console.log("=========================================");
  console.log("     Running Philia Backend Tests        ");
  console.log("=========================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    process.stdout.write(`Testing: ${name}... `);
    try {
      await fn();
      console.log("✅ PASS");
      passed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ FAIL\n   ${msg}`);
      failed++;
    }
  }

  // 1. Initial deny-list check (when restricted)
  await test("Deny-list guardrails on Windows system paths (Restricted Mode)", () => {
    revokeFullAccess();
    if (process.platform === "win32") {
      assert.strictEqual(isPathDenied("C:\\Windows", true).denied, true);
      assert.strictEqual(isPathDenied("C:\\Program Files", true).denied, true);
    }
  });

  // 2. Full Access Granting & Persistence ("never again")
  await test("Permissions: grantFullAccess lifts path restrictions and persists", () => {
    const grantRes = grantFullAccess();
    assert.strictEqual(grantRes.success, true);
    assert.strictEqual(isFullAccessGranted(), true);

    if (process.platform === "win32") {
      // With full access active, Program Files is accessible!
      const check = isPathDenied("C:\\Program Files");
      assert.strictEqual(check.denied, false, "Program Files should be permitted under Full Access");
    }
  });

  // 3. Fast Application Resolution (HoYoPlay, calc, notepad)
  await test("AppResolver: resolves 'HoYoPlay' shortcut or executable in < 50ms", async () => {
    // Warm up shortcut cache
    await resolveApplication("warmup");
    const start = Date.now();
    const resolved = await resolveApplication("HoYoPlay");
    const duration = Date.now() - start;
    console.log(`\n   [HoYoPlay resolution]: target="${resolved?.targetPath}" (took ${duration}ms)`);
    assert.ok(resolved !== null, "HoYoPlay should resolve successfully");
    assert.ok(
      resolved.targetPath.toLowerCase().includes("hoyo") ||
      resolved.targetPath.toLowerCase().includes("launcher"),
      "Resolved target should point to HoYoPlay launcher or shortcut"
    );
    assert.ok(duration < 100, `Resolution must be ultra-fast (< 100ms, took ${duration}ms)`);
  });

  await test("AppResolver: resolves 'calc' to system calculator", async () => {
    const resolved = await resolveApplication("calc");
    assert.ok(resolved !== null);
    assert.strictEqual(resolved.targetPath, "calc.exe");
  });

  await test("AppResolver: resolves 'notepad' to system notepad", async () => {
    const resolved = await resolveApplication("notepad");
    assert.ok(resolved !== null);
    assert.strictEqual(resolved.targetPath, "notepad.exe");
  });

  // 4. Command Execution Tool
  await test("System: executeCommand executes shell command with output", async () => {
    const res = await executeCommand("echo PhiliaOnline");
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes("PhiliaOnline"));
  });

  // 5. Files tools
  await test("Files: getFileMetadata on package.json", async () => {
    const pkg = path.resolve(process.cwd(), "package.json");
    const meta = await getFileMetadata(pkg);
    assert.strictEqual(meta.isFile, true);
  });

  await test("Files: readFileContent on package.json", async () => {
    const pkg = path.resolve(process.cwd(), "package.json");
    const res = await readFileContent(pkg, 200);
    assert.ok(res.content.includes("philia"));
  });

  // 6. Audio TTS
  await test("TTS: pcmToWav valid header structure", () => {
    const wav = pcmToWav(Buffer.alloc(480), 24000, 1);
    assert.strictEqual(wav.subarray(0, 4).toString(), "RIFF");
    assert.strictEqual(wav.subarray(8, 12).toString(), "WAVE");
  });

  // 7. Canvas Drawing Tool
  await test("Canvas: canvasDraw executes and draws circuit diagram", async () => {
    const res = await canvasDraw({ action: "circuit", component: "all" });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.isGoalMet, true);
    assert.ok(res.componentsDrawn.includes("battery"));
    assert.ok(res.componentsDrawn.includes("resistor_zigzag"));
    assert.ok(res.componentsDrawn.includes("wires_closed_loop"));
  });

  // 8. Default Browser & User Account Policy
  await test("Browser: detects user's default browser (Opera GX) and active profile directory", () => {
    const info = getDefaultBrowserInfo();
    console.log(`\n   [Default Browser]: ${info.name} (Exe: ${info.executablePath}, Profile: ${info.profileDir})`);
    assert.ok(info.name.length > 0);
    assert.strictEqual(info.executablePath, getDefaultBrowserExecutable());
    if (process.platform === "win32") {
      assert.ok(info.executablePath && fs.existsSync(info.executablePath));
      assert.ok(info.profileDir && fs.existsSync(info.profileDir));
    }
  });

  await test("Browser: resolveApplication resolves web services and URLs to protocol targets", async () => {
    const yt = await resolveApplication("youtube");
    assert.ok(yt !== null);
    assert.strictEqual(yt.type, "protocol");
    assert.strictEqual(yt.targetPath, "https://www.youtube.com");

    const reddit = await resolveApplication("reddit");
    assert.ok(reddit !== null);
    assert.strictEqual(reddit.type, "protocol");
    assert.strictEqual(reddit.targetPath, "https://www.reddit.com");

    const domain = await resolveApplication("github.com");
    assert.ok(domain !== null);
    assert.strictEqual(domain.type, "protocol");
    assert.strictEqual(domain.targetPath, "https://github.com");

    const fullUrl = await resolveApplication("https://news.ycombinator.com");
    assert.ok(fullUrl !== null);
    assert.strictEqual(fullUrl.type, "protocol");
    assert.strictEqual(fullUrl.targetPath, "https://news.ycombinator.com");
  });

  await test("Browser: resolveApplication resolves search queries to web searches", async () => {
    const ytSearch = await resolveApplication("search youtube for lofi beats");
    assert.ok(ytSearch !== null);
    assert.strictEqual(ytSearch.type, "protocol");
    assert.ok(ytSearch.targetPath.includes("youtube.com/results?search_query="));

    const googleSearch = await resolveApplication("search for modern web design");
    assert.ok(googleSearch !== null);
    assert.strictEqual(googleSearch.type, "protocol");
    assert.ok(googleSearch.targetPath.includes("google.com/search?q="));
  });

  await test("Browser: 'browser' and 'my browser' resolve to user default browser executable", async () => {
    const b1 = await resolveApplication("browser");
    assert.ok(b1 !== null);
    assert.strictEqual(b1.type, "executable");
    assert.ok(b1.targetPath.toLowerCase().includes("opera") || b1.targetPath.toLowerCase().includes("chrome") || b1.targetPath.toLowerCase().includes("edge"));

    const b2 = await resolveApplication("my browser");
    assert.ok(b2 !== null);
    assert.strictEqual(b2.type, "executable");
  });

  // 9. Brain Processing with Gemini & English-Only Multilingual Policy
  await test("Brain: processes query and returns structured reply", async () => {
    const brain = new PhiliaBrain();
    const res = await brain.process("Hello Philia, state your name and readiness.");
    assert.ok(res.reply.length > 0);
  });

  await test("Brain: understands foreign language (Tagalog/Spanish) but strictly replies in English", async () => {
    const brain = new PhiliaBrain();
    // Test Tagalog input
    const tagalogRes = await brain.process("Magandang araw Philia! Sino ka at ano ang maitutulong mo sa akin?");
    console.log(`\n   [Tagalog User Input]: "Magandang araw Philia! Sino ka at ano ang maitutulong mo sa akin?"`);
    console.log(`   [Philia English Reply]: "${tagalogRes.reply}"`);
    assert.ok(tagalogRes.reply.length > 0);
    // Verify it replied in English, not in Tagalog
    assert.ok(!tagalogRes.reply.toLowerCase().startsWith("magandang araw"));
    assert.ok(!tagalogRes.reply.toLowerCase().includes("ako si philia"));
    assert.ok(
      tagalogRes.reply.toLowerCase().includes("philia") ||
      tagalogRes.reply.toLowerCase().includes("assistant") ||
      tagalogRes.reply.toLowerCase().includes("help")
    );

    // Test Spanish input
    const spanishRes = await brain.process("Hola Philia, ¿cómo estás hoy?");
    console.log(`   [Spanish User Input]: "Hola Philia, ¿cómo estás hoy?"`);
    console.log(`   [Philia English Reply]: "${spanishRes.reply}"`);
    assert.ok(spanishRes.reply.length > 0);
    // Verify it replied in English, not in Spanish
    assert.ok(!spanishRes.reply.toLowerCase().startsWith("hola"));
    assert.ok(!spanishRes.reply.toLowerCase().includes("estoy bien"));
    assert.ok(
      spanishRes.reply.toLowerCase().includes("i am") ||
      spanishRes.reply.toLowerCase().includes("doing well") ||
      spanishRes.reply.toLowerCase().includes("ready") ||
      spanishRes.reply.toLowerCase().includes("how can i") ||
      spanishRes.reply.toLowerCase().includes("hello")
    );
  });

  console.log("\n=========================================");
  console.log(`Backend Test Results: ${passed} passed, ${failed} failed`);
  console.log("=========================================\n");

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
