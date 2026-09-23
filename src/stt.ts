import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { pcmToWav } from "./tts.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const STT_PROMPT = `You are a high-accuracy speech-to-text engine.
Transcribe the spoken audio clip accurately into plain English text.
Return ONLY the transcription. Do not add commentary, notes, quotes, or timestamps.
If the audio contains only background noise, clicks, or silence, respond with strictly: [SILENCE]`;

/**
 * Transcribe an audio buffer (PCM or WAV) using Gemini Multimodal Audio API.
 * @param audioBuffer Audio data (PCM 16-bit 16000Hz or standard WAV)
 * @param isRawPcm Whether the buffer is raw PCM (true) or formatted WAV (false)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  isRawPcm: boolean = true
): Promise<string> {
  if (!audioBuffer || audioBuffer.length === 0) {
    return "";
  }

  // If raw PCM from PvRecorder (16kHz 16-bit mono), wrap into standard WAV
  const wavBuffer = isRawPcm ? pcmToWav(audioBuffer, 16000, 1) : audioBuffer;

  const base64Audio = wavBuffer.toString("base64");
  console.log(`[STT] 🎙️ Transcribing ${wavBuffer.length} bytes of audio via Gemini...`);

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Audio,
          },
        },
        STT_PROMPT,
      ],
    });

    const transcription = (response.text || "").trim();

    if (!transcription || transcription.toUpperCase().includes("[SILENCE]")) {
      console.log(`[STT] No audible speech detected.`);
      return "";
    }

    console.log(`[STT] 📝 Transcribed: "${transcription}"`);
    return transcription;
  } catch (err: any) {
    console.error(`[STT Error] ❌ Failed to transcribe audio:`, err.message || err);
    return "";
  }
}
