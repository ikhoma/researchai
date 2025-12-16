// Повертаємо повну версію з generateAffinityMap через API:

import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ResearchData, Language } from "../types";

// ... (всі хелпери і схеми залишаємо без змін)

// -----------------------------
// Main function (V2 fixed)
// -----------------------------

export const analyzeResearchFile = async (
  file: File,
  fileType: "video" | "audio" | "text",
  onProgress?: (status: "uploading" | "processing" | "uploaded", progress?: number) => void,
  language: Language = "uk"
): Promise<ResearchData> => {
  const apiKey = process.env.GEMINI_API_KEY; // Читаємо ключ із сервера

  if (!apiKey) throw new Error("API Key not found.");

  const ai = new GoogleGenAI({ apiKey });

  // ... (весь інший код analyzeResearchFile залишаємо без змін)
};

// -----------------------------
// Standalone Affinity Generator через API
// -----------------------------

export const generateAffinityMap = async (
  highlights: any[],
  language: Language = "uk"
): Promise<any[]> => {
  const apiKey = process.env.GEMINI_API_KEY; // Використовуємо той самий API ключ із сервера

  if (!apiKey) throw new Error("API Key not found.");

  const ai = new GoogleGenAI({ apiKey });
  const reasonModelName = "gemini-2.5-flash";
  const languagePrompt = language === "uk" ? "Ukrainian" : "English";

  const affinityUserMessage = `Here are the research highlights:\n${JSON.stringify(highlights)}\n\nGenerate the affinity map in ${languagePrompt}.`;

  try {
    const affinityResponse = await retryOperation(async () => {
      return await ai.models.generateContent({
        model: reasonModelName,
        contents: {
          parts: [{ text: AFFINITY_SYSTEM_PROMPT }, { text: affinityUserMessage }],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: AFFINITY_SCHEMA,
          temperature: 0.3,
        },
      });
    }, 2, 2000, "Affinity Mapping Manual");

    const affinityJson = JSON.parse(affinityResponse.text || "{}");

    // Transform to UI format
    return transformApiClustersToUiClusters(affinityJson.items, highlights);

  } catch (error) {
    console.error("Manual Affinity Generation Failed:", error);
    throw error;
  }
};
