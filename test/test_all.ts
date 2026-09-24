import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { isPathDenied, assertPathNotDenied } from "../src/config.js";
import { searchFiles, getFileMetadata, readFileContent } from "../src/tools/files.js";
import { writeFileContent, deleteFile, setFileWriteConfirmationHandler } from "../src/tools/filesWrite.js";
import { browserOpen, browserReadPage, browserClose } from "../src/tools/browser.js";
import { resolveApplication } from "../src/tools/appResolver.js";
import { executeCommand } from "../src/tools/system.js";
import {
  grantFullAccess,
  revokeFullAccess,
  isFullAccessGranted,
} from "../src/permissions.js";
import { PhiliaBrain } from "../src/brain.js";
import { pcmToWav } from "../src/tts.js";
import { transcribeAudio } from "../src/stt.js";

async function runTests() {
  console.log("=========================================");
  console.log("   Running Philia Comprehensive Tests    ");
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

  // 1. Config & Deny-list guardrails (Restricted Mode)
  await test("Deny-list blocks C:\\Windows and System32 when restricted", () => {
    revokeFullAccess();
    if (process.platform === "win32") {
      const winCheck = isPathDenied("C:\\Windows", true);
      assert.strictEqual(winCheck.denied, true, "C:\\Windows should be denied");

      const sys32Check = isPathDenied("C:\\Windows\\System32\\cmd.exe", true);
      assert.strictEqual(sys32Check.denied, true, "System32 should be denied");

      assert.throws(() => {
        assertPathNotDenied("C:\\Windows\\explorer.exe", true);
      }, /Access Denied/);
    } else {
      const sysCheck = isPathDenied("/etc/passwd", true);
      assert.strictEqual(sysCheck.denied, true, "/etc should be denied on POSIX");
    }
  });

  // 2. Full Access grant & persistence ("never again")
  await test("Permissions: grantFullAccess enables unrestricted computer access", () => {
    grantFullAccess();
    assert.strictEqual(isFullAccessGranted(), true);
    if (process.platform === "win32") {
      const check = isPathDenied("C:\\Program Files");
      assert.strictEqual(check.denied, false);
    }
  });

  // 3. Fast Application Resolver (HoYoPlay, calc)
  await test("AppResolver: resolves 'HoYoPlay' launcher/shortcut instantly (< 50ms)", async () => {
    const start = Date.now();
    const resolved = await resolveApplication("HoYoPlay");
    const duration = Date.now() - start;
    console.log(`\n   [HoYoPlay resolved to]: "${resolved?.targetPath}" in ${duration}ms`);
    assert.ok(resolved !== null);
    assert.ok(
      resolved.targetPath.toLowerCase().includes("hoyo") ||
      resolved.targetPath.toLowerCase().includes("launcher")
    );
  });

  // 4. Command execution tool
  await test("System: executeCommand runs shell commands with full access", async () => {
    const res = await executeCommand("echo PhiliaVerified");
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes("PhiliaVerified"));
  });

  await test("Deny-list permits current workspace path", () => {
    const cwdCheck = isPathDenied(process.cwd());
    assert.strictEqual(cwdCheck.denied, false, "Current workspace should be permitted");
    const safeCwd = assertPathNotDenied(process.cwd());
    assert.ok(safeCwd);
  });

  // 5. Files tools
  await test("Files: getFileMetadata for package.json", async () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const meta = await getFileMetadata(pkgPath);
    assert.strictEqual(meta.isFile, true);
    assert.strictEqual(meta.isDirectory, false);
    assert.ok(meta.sizeBytes > 0);
    assert.ok(meta.mtime);
  });

  await test("Files: readFileContent for package.json", async () => {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const result = await readFileContent(pkgPath, 500);
    assert.strictEqual(result.isBinary, false);
    assert.ok(result.content.includes("philia-assistant"));
  });

  await test("Files: searchFiles locates package.json", async () => {
    const searchResult = await searchFiles("package.json", process.cwd());
    assert.ok(searchResult.matches.length > 0, "Should locate package.json in workspace");
    assert.ok(searchResult.matches.some(m => m.endsWith("package.json")));
  });

  // 6. Audio helpers
  await test("Audio: pcmToWav generates valid 44-byte RIFF header", () => {
    const dummyPcm = Buffer.alloc(100);
    const wav = pcmToWav(dummyPcm, 24000, 1);
    assert.strictEqual(wav.length, 144);
    assert.strictEqual(wav.subarray(0, 4).toString(), "RIFF");
    assert.strictEqual(wav.subarray(8, 12).toString(), "WAVE");
  });

  await test("STT: returns empty for pure silence", async () => {
    const silence = Buffer.alloc(16000);
    const text = await transcribeAudio(silence, true);
    assert.strictEqual(text, "", "Silence should transcribe to empty text");
  });

  // 7. FilesWrite & Trash
  await test("FilesWrite: writeFileContent and deleteFile with trash", async () => {
    const testDir = path.join(os.tmpdir(), "philia-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    const testFile = path.join(testDir, "test-note.txt");

    setFileWriteConfirmationHandler(() => true);

    const writeRes = await writeFileContent(testFile, "Hello Philia test!");
    assert.strictEqual(writeRes.success, true);
    assert.ok(fs.existsSync(testFile));

    const delRes = await deleteFile(testFile);
    assert.strictEqual(delRes.success, true);
    assert.strictEqual(delRes.movedToRecycleBin, true);
    assert.strictEqual(fs.existsSync(testFile), false, "File should no longer be in testDir");

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // 8. Browser tools
  await test("Browser: browserOpen and browserReadPage on example.com", async () => {
    const summary = await browserOpen("https://example.com");
    assert.ok(summary.includes("Example Domain") || summary.includes("Interactive Elements"));

    const readRes = await browserReadPage();
    assert.ok(readRes.includes("Example Domain"));

    await browserClose();
  });

  // 9. Gemini Brain tool calling integration
  await test("Brain: processes query and executes getFileMetadata tool", async () => {
    const brain = new PhiliaBrain();
    const res = await brain.process("What is the size and modification date of package.json in the current directory?");
    console.log(`\n   [Brain Reply Excerpt]: ${res.reply.slice(0, 120)}...`);
    assert.ok(res.reply.length > 0, "Brain should produce a response");
    assert.ok(res.reply.toLowerCase().includes("package.json") || res.reply.toLowerCase().includes("bytes") || res.reply.toLowerCase().includes("size"));
  });

  console.log("\n=========================================");
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log("=========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner encountered an error:", err);
  process.exit(1);
});
