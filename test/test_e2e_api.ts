import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";

async function testE2e() {
  console.log("=========================================");
  console.log("   Running Jarvis E2E HTTP API Tests     ");
  console.log("=========================================\n");

  const port = 4172;

  // Helper function to make JSON HTTP request
  function makeRequest(pathname: string, method: string = "GET", body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : "";
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} });
            } catch (e) {
              resolve({ status: res.statusCode, data });
            }
          });
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Check if backend is already running or spawn it
  let backendProc: any = null;
  let isUp = false;

  try {
    const res = await makeRequest("/api/status");
    if (res.status === 200) isUp = true;
  } catch {}

  if (!isUp) {
    console.log("Spawning backend for test...");
    backendProc = spawn("npx", ["tsx", "src/main.ts"], {
      cwd: path.resolve(process.cwd(), "backend"),
      stdio: "pipe",
      shell: true,
    });

    // Wait for server to boot
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await makeRequest("/api/status");
        if (res.status === 200) {
          isUp = true;
          break;
        }
      } catch {}
    }
  }

  assert.ok(isUp, "Backend server should be responding on port 4172");

  // 1. Test /api/status
  console.log("1. Testing GET /api/status...");
  const statusRes = await makeRequest("/api/status");
  assert.strictEqual(statusRes.status, 200);
  assert.strictEqual(statusRes.data.status, "online");
  console.log("   Status:", statusRes.data);

  // 2. Test /api/chat with tool calling
  console.log("2. Testing POST /api/chat with tool calling query...");
  const chatRes = await makeRequest("/api/chat", "POST", {
    prompt: "What is the size of package.json in the current directory?",
    playVoice: false, // Don't play speaker audio during test
  });

  assert.strictEqual(chatRes.status, 200);
  assert.ok(chatRes.data.reply, "Should return a reply");
  console.log("   Jarvis Reply:", chatRes.data.reply.slice(0, 100));

  // 3. Test /api/reset
  console.log("3. Testing POST /api/reset...");
  const resetRes = await makeRequest("/api/reset", "POST");
  assert.strictEqual(resetRes.status, 200);
  assert.strictEqual(resetRes.data.success, true);

  if (backendProc) {
    console.log("Stopping test backend process...");
    backendProc.kill();
  }

  console.log("\n=========================================");
  console.log("   All E2E API Tests Passed! ✅          ");
  console.log("=========================================\n");
}

testE2e().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
