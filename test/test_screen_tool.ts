import { inspectScreen, captureScreenBuffer } from "../backend/src/tools/screen.js";

async function test() {
  console.log("Testing Philia screen capture and vision tool...");
  try {
    const capture = await captureScreenBuffer();
    console.log(`Screen captured: ${capture.buffer.length} bytes, source: ${capture.source}`);
    
    console.log("Running inspectScreen...");
    const inspectResult = await inspectScreen("What is on the screen right now?", (status) => {
      console.log(`[Status] ${status}`);
    });
    
    console.log("Inspection success:", inspectResult.success);
    console.log("Analysis preview:", inspectResult.analysis.slice(0, 300));
  } catch (err) {
    console.error("Test error:", err);
  }
}

test();
