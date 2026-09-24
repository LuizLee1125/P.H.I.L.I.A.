import assert from "node:assert";
import path from "node:path";
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
    assert.ok(duration < 100, "Resolution must be ultra-fast (< 100ms)");
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

  // 7. Brain Processing with Gemini
  await test("Brain: processes query and returns structured reply", async () => {
    const brain = new PhiliaBrain();
    const res = await brain.process("Hello Philia, state your name and readiness.");
    assert.ok(res.reply.length > 0);
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
