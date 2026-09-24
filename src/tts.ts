import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import soundPlay from "sound-play";
import { config } from "./config.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

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

  header.write("RIFF", 0);
  header.writeUInt32LE(totalFileLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(totalDataLen, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Generate WAV audio buffer from text using Gemini TTS.
 */
export async function synthesizeWav(text: string): Promise<Buffer | null> {
  if (!text || text.trim().length === 0) return null;

  const spokenText = text
    .replace(/\*\*/g, "")
    .replace(/```[\s\S]*?```/g, "Code block omitted.")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .trim();

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
      return null;
    }

    const rawPcm = Buffer.from(audioPart.inlineData.data, "base64");
    return pcmToWav(rawPcm, 24000, 1);
  } catch (err: any) {
    console.error(`[TTS Error] ❌ Failed to generate speech:`, err.message || err);
    return null;
  }
}

/**
 * Generate speech and play aloud through system speakers.
 */
export async function speak(text: string): Promise<void> {
  const wavBuffer = await synthesizeWav(text);
  if (!wavBuffer) return;

  const tempDir = path.join(os.tmpdir(), "philia-audio");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempWavPath = path.join(tempDir, `speech-${Date.now()}.wav`);
  await fs.promises.writeFile(tempWavPath, wavBuffer);

  try {
    await soundPlay.play(tempWavPath);
  } finally {
    fs.promises.unlink(tempWavPath).catch(() => {});
  }
}
