import assert from "node:assert";
import path from "node:path";
import http from "node:http";
import { config, isPathDenied, assertPathNotDenied } from "../src/config.js";
import { searchFiles, getFileMetadata, readFileContent } from "../src/tools/files.js";
import { JarvisBrain } from "../src/brain.js";
import { pcmToWav } from "../src/tts.js";

async function runTests() {
  console.log("=========================================");
  console.log("     Running Jarvis Backend Tests        ");
  console.log("=========================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    process.stdout.write(`Testing: ${name}... `);
    try {
      await fn();
      console.log("✅ PASS");
      passed++;
    } catch (err: any) {
      console.log(`❌ FAIL\n   ${err.message}`);
      failed++;
    }
  }

  await test("Deny-list guardrails on Windows system paths", () => {
    if (process.platform === "win32") {
      assert.strictEqual(isPathDenied("C:\\Windows").denied, true);
      assert.strictEqual(isPathDenied("C:\\Program Files").denied, true);
    }
  });

  await test("Files: getFileMetadata on package.json", async () => {
    const pkg = path.resolve(process.cwd(), "package.json");
    const meta = await getFileMetadata(pkg);
    assert.strictEqual(meta.isFile, true);
  });

  await test("Files: readFileContent on package.json", async () => {
    const pkg = path.resolve(process.cwd(), "package.json");
    const res = await readFileContent(pkg, 200);
    assert.ok(res.content.includes("jarvis"));
  });

  await test("TTS: pcmToWav valid header structure", () => {
    const wav = pcmToWav(Buffer.alloc(480), 24000, 1);
    assert.strictEqual(wav.subarray(0, 4).toString(), "RIFF");
    assert.strictEqual(wav.subarray(8, 12).toString(), "WAVE");
  });

  await test("Brain: processes query and returns structured reply", async () => {
    const brain = new JarvisBrain();
    const res = await brain.process("Hello Jarvis, state your name and readiness.");
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
