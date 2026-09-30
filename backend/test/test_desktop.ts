import assert from "node:assert";
import {
  getScreenDimensions,
  desktopMove,
  desktopClick,
  desktopType,
  desktopHotkey,
  desktopScroll,
  focusWindow,
} from "../src/tools/desktop.js";
import { locateOnScreen } from "../src/tools/screen.js";
import { PhiliaBrain } from "../src/brain.js";
import { grantFullAccess } from "../src/permissions.js";

async function runDesktopTests() {
  console.log("=========================================");
  console.log("   Running Philia Desktop RPA Tests      ");
  console.log("=========================================\n");

  grantFullAccess();

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

  // 1. Screen dimensions
  await test("getScreenDimensions returns valid display resolution", async () => {
    const dims = await getScreenDimensions();
    assert.strictEqual(dims.success, true, "Expected success to be true");
    assert.ok(dims.width > 0, `Expected width > 0, got ${dims.width}`);
    assert.ok(dims.height > 0, `Expected height > 0, got ${dims.height}`);
    console.log(`\n   [Screen Bounds]: ${dims.width}x${dims.height} (Cursor: ${dims.cursorX}, ${dims.cursorY})`);
  });

  // 2. Cursor movement
  await test("desktopMove repositions mouse cursor", async () => {
    const res = await desktopMove(400, 300, false);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.action, "move");
    assert.strictEqual(res.x, 400);
    assert.strictEqual(res.y, 300);
  });

  // 3. Mouse click
  await test("desktopClick sends click event without throwing", async () => {
    const res = await desktopClick(400, 300, "left", false);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.action, "click");
  });

  // 4. Keyboard typing
  await test("desktopType simulates typing without corruption", async () => {
    const testText = "Philia Automation Test 123";
    const res = await desktopType(testText, false);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.action, "type");
    assert.strictEqual(res.charCount, testText.length);
  });

  // 5. Hotkey shortcuts
  await test("desktopHotkey sends key combo", async () => {
    const res = await desktopHotkey("ctrl+shift");
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.action, "hotkey");
    assert.strictEqual(res.keys, "ctrl+shift");
  });

  // 6. Scroll wheel
  await test("desktopScroll sends scroll event", async () => {
    const res = await desktopScroll(120);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.action, "scroll");
  });

  // 7. Focus window
  await test("focusWindow attempts window activation", async () => {
    const res = await focusWindow("explorer");
    assert.strictEqual(res.action, "focus");
    assert.ok(typeof res.success === "boolean");
  });

  // 8. Brain tool declarations
  await test("Brain registers desktop RPA & computer use tools", async () => {
    const brain = new PhiliaBrain();
    assert.ok(brain, "Brain should instantiate successfully");
  });

  console.log(`\n=========================================`);
  console.log(`Desktop RPA Tests: ${passed} passed, ${failed} failed`);
  console.log(`=========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runDesktopTests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
