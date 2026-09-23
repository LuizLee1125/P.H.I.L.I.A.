import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import soundPlay from "sound-play";
import { config } from "./config.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/**
 * Prepend a standard 44-byte RIFF header to 16-bit linear PCM audio.
 */
export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate: number = 24000,
  numChannels: number = 1
): Buffer {
  const header = Buffer.alloc(44);
  const totalDataLen = pcmBuffer.length;
  const totalFileLen = 36 + totalDataLen;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  // RIFF chunk descriptor
  header.write("RIFF", 0);
  header.writeUInt32LE(totalFileLen, 4);
  header.write("WAVE", 8);

  // "fmt " sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 for linear PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // BitsPerSample (16-bit)

  // "data" sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(totalDataLen, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Generate audio from text using Gemini TTS and play it back through system speakers.
 */
export async function speak(text: string): Promise<void> {
  if (!text || text.trim().length === 0) return;

  // Clean markdown syntax for cleaner spoken delivery
  const spokenText = text
    .replace(/\*\*/g, "")
    .replace(/```[\s\S]*?```/g, "Code block omitted for speech.")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .trim();

  console.log(`[TTS] 🗣️ Speaking: "${spokenText.slice(0, 100)}${spokenText.length > 100 ? "..." : ""}" (Voice: ${config.geminiVoice})`);

  try {
    const ttsModel = "gemini-2.5-flash-preview-tts";

    const response = await ai.models.generateContent({
      model: ttsModel,
      contents: spokenText,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: config.geminiVoice,
            },
          },
        },
      },
    });

    const candidate = response.candidates?.[0];
    const audioPart = candidate?.content?.parts?.find((p: any) => p.inlineData && p.inlineData.mimeType?.startsWith("audio/"));

    if (!audioPart || !audioPart.inlineData?.data) {
      console.warn(`[TTS] No audio returned from Gemini for text.`);
      return;
    }

    const base64Data = audioPart.inlineData.data;
    const rawPcm = Buffer.from(base64Data, "base64");

    // Sample rate: Gemini TTS returns 24000Hz 16-bit PCM by default
    const wavBuffer = pcmToWav(rawPcm, 24000, 1);

    const tempDir = path.join(os.tmpdir(), "jarvis-audio");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempWavPath = path.join(tempDir, `speech-${Date.now()}.wav`);
    await fs.promises.writeFile(tempWavPath, wavBuffer);

    try {
      await soundPlay.play(tempWavPath);
    } finally {
      // Clean up temp file
      fs.promises.unlink(tempWavPath).catch(() => {});
    }
  } catch (err: any) {
    console.error(`[TTS Error] ❌ Failed to generate or play speech:`, err.message || err);
  }
}
