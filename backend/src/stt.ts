import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { pcmToWav } from "./tts.js";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const STT_PROMPT = `You are a high-accuracy speech-to-text engine.
Transcribe the spoken audio clip accurately into plain English text.
Return ONLY the transcription. Do not add commentary, notes, quotes, or timestamps.
If the audio contains only background noise, clicks, or silence, respond with strictly: [SILENCE]`;

export async function transcribeAudio(
  audioBuffer: Buffer,
  isRawPcm: boolean = true
): Promise<string> {
  if (!audioBuffer || audioBuffer.length === 0) {
    return "";
  }

  // Pre-filter digital silence / low-energy buffers before making API call
  if (isRawPcm) {
    let maxAmp = 0;
    for (let i = 0; i < audioBuffer.length; i += 2) {
      const sample = Math.abs(audioBuffer.readInt16LE(i));
      if (sample > maxAmp) maxAmp = sample;
    }
    if (maxAmp < 150) {
      console.log(`[STT] Audio amplitude too low (${maxAmp}), treating as silence.`);
      return "";
    }
  }

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

    const cleaned = transcription.replace(/[\[\(].*?[\]\)]/g, "").trim();
    const isSilenceArtifact =
      !transcription ||
      /^\[?\(?\d{1,2}:\d{2}(:\d{2})?\]?\)?$/.test(transcription) ||
      transcription.toUpperCase().includes("[SILENCE]") ||
      cleaned.length === 0;

    if (isSilenceArtifact) {
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
