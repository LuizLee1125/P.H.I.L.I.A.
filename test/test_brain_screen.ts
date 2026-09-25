import { PhiliaBrain, isScreenInspectionRequest } from "../backend/src/brain.js";
import { config } from "../backend/src/config.js";

async function testScreenPhrases() {
  console.log("=== Testing Screen Phrase Matching ===");
  const testPhrases = [
    "at my screen",
    "look at my screen",
    "look at my screen and tell me what you see",
    "check my screen please",
    "what's on my screen right now",
    "can you see my screen?",
    "take a look at the screen",
  ];

  for (const phrase of testPhrases) {
    console.log(`"${phrase}" -> matched: ${isScreenInspectionRequest(phrase)}`);
  }

  console.log("\n=== Testing Brain Execution with: 'at my screen' ===");
  const brain = new PhiliaBrain(config.geminiModel);
  const result = await brain.process("at my screen", (event) => {
    console.log(`[Brain Event] ${event.type}: ${event.message || ""}`);
  });

  console.log("\n=== Test Result ===");
  console.log("Tools Used:", result.toolsUsed.map(t => t.tool));
  console.log("Reply:\n", result.reply);
}

testScreenPhrases().catch(console.error);
