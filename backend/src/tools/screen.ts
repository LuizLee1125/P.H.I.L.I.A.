import screenshot from "screenshot-desktop";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export interface ScreenCaptureResult {
  success: boolean;
  timestamp: number;
  width?: number;
  height?: number;
  imageBase64?: string;
  source: "desktop_native" | "frontend_stream";
  error?: string;
}

export interface ScreenInspectResult {
  success: boolean;
  analysis: string;
  timestamp: number;
  width?: number;
  height?: number;
  hasImage: boolean;
  thumbnailBase64?: string;
  error?: string;
}

let latestFrontendFrame: {
  imageBase64: string;
  timestamp: number;
  width?: number;
  height?: number;
} | null = null;

let latestCaptureBuffer: Buffer | null = null;

/**
 * Register a frame snapshot received from the frontend screen stream.
 */
export function setFrontendScreenFrame(imageBase64: string, width?: number, height?: number) {
  // Strip data URL prefix if present
  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  latestFrontendFrame = {
    imageBase64: cleanBase64,
    timestamp: Date.now(),
    width,
    height,
  };
  try {
    latestCaptureBuffer = Buffer.from(cleanBase64, "base64");
  } catch {
    // ignore
  }
}

/**
 * Capture the current screen buffer (JPEG) from the desktop or frontend stream.
 */
export async function captureScreenBuffer(): Promise<{
  buffer: Buffer;
  base64: string;
  source: "desktop_native" | "frontend_stream";
  width?: number;
  height?: number;
}> {
  // If we have a fresh frontend stream frame (< 15 seconds old), prioritize it
  if (latestFrontendFrame && Date.now() - latestFrontendFrame.timestamp < 15000) {
    console.log("[Philia Vision] 🖥️ Using active frontend screen stream frame");
    const buffer = Buffer.from(latestFrontendFrame.imageBase64, "base64");
    return {
      buffer,
      base64: latestFrontendFrame.imageBase64,
      source: "frontend_stream",
      width: latestFrontendFrame.width,
      height: latestFrontendFrame.height,
    };
  }

  // Otherwise, use native desktop screenshot
  console.log("[Philia Vision] 📸 Capturing desktop screen via native capture...");
  try {
    const imgBuffer = await screenshot({ format: "jpg" });
    const base64 = imgBuffer.toString("base64");
    latestCaptureBuffer = imgBuffer;

    return {
      buffer: imgBuffer,
      base64,
      source: "desktop_native",
    };
  } catch (err: any) {
    console.warn(`[Philia Vision] Native screenshot failed: ${err.message}. Checking cached frame...`);
    if (latestFrontendFrame) {
      const buffer = Buffer.from(latestFrontendFrame.imageBase64, "base64");
      return {
        buffer,
        base64: latestFrontendFrame.imageBase64,
        source: "frontend_stream",
        width: latestFrontendFrame.width,
        height: latestFrontendFrame.height,
      };
    }
    throw new Error(`Screen capture failed: ${err.message}`);
  }
}

/**
 * Get the latest captured screen buffer if available.
 */
export function getLatestScreenshot(): Buffer | null {
  return latestCaptureBuffer;
}

/**
 * Inspect the user's screen using Gemini Vision.
 * Captures the screen, feeds it into Gemini multimodal vision,
 * and returns detailed visual understanding.
 */
export async function inspectScreen(
  query?: string,
  onProgress?: (status: string) => void
): Promise<ScreenInspectResult> {
  const timestamp = Date.now();
  onProgress?.("Capturing desktop screen...");

  let capture;
  try {
    capture = await captureScreenBuffer();
  } catch (err: any) {
    console.error("[Philia Vision] ❌ Failed to capture screen:", err.message);
    return {
      success: false,
      analysis: `I was unable to capture your screen: ${err.message}. Please ensure the Philia desktop app has screen recording permissions.`,
      timestamp,
      hasImage: false,
      error: err.message,
    };
  }

  onProgress?.("Analyzing screen content with Gemini Vision...");
  console.log(`[Philia Vision] 🧠 Sending screen capture (${capture.buffer.length} bytes) to Gemini Vision...`);

  const visionPrompt = query && query.trim().length > 0
    ? `The user is looking at their computer screen and asked you: "${query}".
Analyze the provided screenshot of the user's current desktop screen carefully.
Answer the user's question directly, accurately, and thoroughly based on what is visually shown on the screen.
Include details such as visible applications, open windows, text, code, tabs, file paths, error messages, websites, diagrams, or UI components relevant to their query.
Reply in clear, polished English.`
    : `You are Philia, inspecting what is currently on the user's computer screen.
Analyze the provided screenshot of the user's desktop in detail:
1. Identify the primary application(s) and active windows currently open (e.g. VS Code, browser, games, terminal, system apps).
2. Read and summarize the main content visible: text, documents, code, error messages, notifications, or active websites.
3. Note any key UI elements or pending actions.
Provide an articulate, concise, and structured overview of what the user is currently looking at. Reply in clear English.`;

  // Use config.geminiModel or fallback to gemini-2.5-flash / gemini-3.5-flash-lite
  const visionModel = config.geminiModel || "gemini-3.5-flash-lite";

  try {
    const response = await ai.models.generateContent({
      model: visionModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: capture.base64,
              },
            },
            {
              text: visionPrompt,
            },
          ],
        },
      ],
    });

    const analysis = response.text || "I captured your screen, but could not discern any visible content.";
    console.log("[Philia Vision] ✅ Screen analysis complete.");

    // Generate a lightweight base64 thumbnail if image is small enough
    const thumbnailBase64 = capture.base64;

    return {
      success: true,
      analysis,
      timestamp,
      width: capture.width,
      height: capture.height,
      hasImage: true,
      thumbnailBase64,
    };
  } catch (err: any) {
    console.error("[Philia Vision] ❌ Vision model error:", err.message);

    // If initial model failed with 503/404, attempt fallback to gemini-2.5-flash
    if (visionModel !== "gemini-2.5-flash") {
      try {
        console.log("[Philia Vision] 🔄 Retrying with fallback model gemini-2.5-flash...");
        const fallbackResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: capture.base64,
                  },
                },
                {
                  text: visionPrompt,
                },
              ],
            },
          ],
        });

        return {
          success: true,
          analysis: fallbackResponse.text || "Screen analyzed successfully.",
          timestamp,
          hasImage: true,
          thumbnailBase64: capture.base64,
        };
      } catch (fallbackErr: any) {
        console.error("[Philia Vision] ❌ Fallback model error:", fallbackErr.message);
      }
    }

    return {
      success: false,
      analysis: `I captured your screen, but encountered an error analyzing the visual content: ${err.message}`,
      timestamp,
      hasImage: true,
      error: err.message,
    };
  }
}
