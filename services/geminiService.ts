import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ResearchData, Language } from "../types";

// -----------------------------
// Helpers
// -----------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const retryOperation = async <T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 2000,
  operationName = "Operation"
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.code || error?.response?.status;

      console.warn(`${operationName} attempt ${i + 1} failed`, { status, error });

      // Do not retry most 4xx except 429
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }

      await sleep(delay * Math.pow(2, i));
    }
  }
  throw lastError;
};

const isQuota429 = (err: any) => {
  const code = err?.code || err?.status || err?.error?.code;
  const msg = String(err?.message || err?.error?.message || "");
  return code === 429 || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("exceeded your current quota");
};

const fileToGenerativePart = async (
  file: File
): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        const base64String = reader.result.split(",")[1];
        resolve({
          inlineData: {
            data: base64String,
            mimeType: file.type || "application/octet-stream",
          },
        });
      } else {
        reject(new Error("Failed to read file. The file might be corrupted or unreadable."));
      }
    };
    reader.onerror = () => reject(new Error("File reading error. Please check if the file is accessible."));
    reader.readAsDataURL(file);
  });
};

// -----------------------------
// Schemas (V2)
// -----------------------------

const MAIN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    tags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          color: { type: Type.STRING },
        },
        required: ["id", "label", "color"],
      },
    },
    highlights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING },
          tagId: { type: Type.STRING },
        },
        required: ["id", "text", "tagId"],
      },
    },
    painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
    opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
    patterns: { type: Type.ARRAY, items: { type: Type.STRING } },
    sentiment: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING, enum: ["Positive", "Neutral", "Negative", "Mixed"] },
        score: { type: Type.INTEGER },
        positivePct: { type: Type.INTEGER },
        neutralPct: { type: Type.INTEGER },
        negativePct: { type: Type.INTEGER },
      },
      required: ["label", "score"],
    },
    executiveSummary: { type: Type.STRING },
    keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
    keyQuotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
        },
        required: ["text", "priority"],
      },
    },
  },
  required: ["transcript", "tags", "highlights"],
};

const AFFINITY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["theme", "subcluster"] },
          title: { type: Type.STRING },
          color: { type: Type.STRING },
          parentId: { type: Type.STRING },
          highlightIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["id", "type", "title"],
      },
    },
  },
  required: ["items"],
};

const INSIGHTS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    themes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING },
          need: { type: Type.STRING },
          dominantEmotion: { type: Type.STRING },
          opportunity: { type: Type.STRING },
          uxSolution: { type: Type.STRING },
          evidenceHighlightIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["theme", "need", "opportunity", "uxSolution"],
      },
    },
    wordCloud: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          count: { type: Type.INTEGER },
        },
        required: ["word", "count"],
      },
    },
    problemPatternsChart: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING },
          frequency: { type: Type.INTEGER },
          intensity: { type: Type.INTEGER },
        },
        required: ["theme", "frequency", "intensity"],
      },
    },
  },
  required: ["themes"],
};

// -----------------------------
// Prompts (V2)
// -----------------------------

const AFFINITY_SYSTEM_PROMPT = `
You are a qualitative research clustering engine.
You must return ONLY valid JSON that follows the AFFINITY_SCHEMA.
Rules:
- Use ALL provided highlights.
- No orphan highlights.
- Themes: 2–4 words, Subclusters: 2–5 words.
- No fluff.
`;

const INSIGHTS_SYSTEM_PROMPT = `
You are an AI Insights Engine for qualitative UX research.
Return ONLY valid JSON that follows the INSIGHTS_SCHEMA.
Rules:
1) Use ONLY verbatim quotes via highlight IDs (no fabrication).
2) Interpret meaning: theme, emotion, need, opportunity.
3) Provide 1-sentence UX solution, feasible.
4) Build wordCloud from emotional words.
5) Build problemPatternsChart frequency + intensity (1–5).
`;

// -----------------------------
// Main function (V2 fixed)
// -----------------------------

export const analyzeResearchFile = async (
  file: File,
  fileType: "video" | "audio" | "text",
  onProgress?: (status: "uploading" | "processing" | "uploaded", progress?: number) => void,
  language: Language = "uk"
): Promise<ResearchData> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found.");

  const ai = new GoogleGenAI({ apiKey });

  // ✅ ONLY Flash for everything (free-friendly)
  const mainModelName = "gemini-2.5-flash";
  const reasonModelName = "gemini-2.5-flash";

  // Hard file size limit (UI says 500MB)
  if (file.size > 500 * 1024 * 1024) {
    throw new Error("File exceeds 500MB limit.");
  }

  const languagePrompt = language === "uk" ? "Ukrainian" : "English";

  let contentPart: any;

  try {
    if (onProgress) onProgress("uploading", 10);

    // --- Upload handling ---
    if (file.size > 20 * 1024 * 1024) {
      // Large file: upload via Files API
      const mimeType =
        file.type ||
        (fileType === "video" ? "video/mp4" : fileType === "audio" ? "audio/mpeg" : "text/plain");

      const uploadResponse = await retryOperation(async () => {
        return await ai.files.upload({
          file,
          config: { mimeType, displayName: file.name },
        });
      }, 3, 3000, "File Upload");

      if (onProgress) onProgress("uploaded", 100);

      // @ts-ignore
      const uploadedFile = uploadResponse.file || uploadResponse;

      const fileUri = uploadedFile?.uri;
      if (!fileUri) throw new Error("Gemini File Upload failed: missing fileUri.");

      const uploadedName = uploadedFile.name;
      if (!uploadedName) throw new Error("Gemini File Upload failed: missing name.");

      // Poll for file state to be ACTIVE
      console.log(`Waiting for ${uploadedName} to process...`);
      let isActive = false;
      let attempt = 0;

      while (!isActive) {
        attempt++;
        if (attempt > 60) { // 5 minutes timeout (5s * 60)
          throw new Error("File processing timed out.");
        }

        const fileStatus = await ai.files.get({ name: uploadedName });
        const state = fileStatus.state;

        console.log(`File ${uploadedName} state: ${state}`);

        if (state === "ACTIVE") {
          isActive = true;
        } else if (state === "FAILED") {
          throw new Error("File processing failed on Gemini side.");
        } else {
          // PROCESSING
          if (onProgress) onProgress("processing");
          await sleep(5000);
        }
      }

      if (onProgress) onProgress("processing");

      contentPart = { fileData: { fileUri, mimeType } };
    } else {
      // Small file inline
      if (onProgress) onProgress("uploading", 50);
      contentPart = await fileToGenerativePart(file);
      if (onProgress) onProgress("processing");
    }

    // --- STEP 1: Transcript + Tags + Highlights + Summary ---
    const mainSystemPrompt = `
You are ReserchOO, an expert UX Research Assistant.
Analyze the provided user interview material.

Tasks:
1) GENERATE TRANSCRIPT:
   - Create a DETAILED, verbatim-style transcript.
   - Format strictly as "Question: ..." and "Answer: ...".
2) CODE & TAG:
   - Identify UX themes (System Stability, UI Clutter, etc).
   - Use short, consistent labels.
   - MAXIMIZE COVERAGE: Tag all relevant parts of the conversation.
   - PROVIDE COLORS: Assign distinct pastel hex colors to each tag.
3) HIGHLIGHTS:
   - Extract EXACT text phrases matching the tags.
   - Text MUST be exact substrings of transcript (verbatim).
   - COVERAGE REQUIREMENT: include highlights from BEGINNING, MIDDLE, END.
   - QUANTITY: 15–20 highlights total if possible.
4) INSIGHTS & SUMMARY:
   - Summarize Pain Points, Opportunities, Patterns.
   - Analyze Sentiment.
   - Write a Key Findings summary.

Output language: ${languagePrompt}.
Return ONLY valid JSON matching the MAIN_SCHEMA.
`;

    const mainResponse = await retryOperation(async () => {
      return await ai.models.generateContent({
        model: mainModelName,
        contents: { parts: [contentPart, { text: mainSystemPrompt }] },
        config: {
          responseMimeType: "application/json",
          responseSchema: MAIN_SCHEMA,
          temperature: 0.2,
        },
      });
    }, 2, 2000, "Main Analysis");

    let mainJson: any;
    try {
      mainJson = JSON.parse(mainResponse.text || "{}");
    } catch (e) {
      throw new Error(
        `Failed to parse AI response (Step 1). Response might be truncated. Length: ${mainResponse.text?.length}`
      );
    }

    const highlights = Array.isArray(mainJson.highlights) ? mainJson.highlights : [];

    // --- STEP 2: Affinity mapping (from highlights) ---
    let affinityJson: any = { items: [] };
    try {
      const affinityUserMessage = `Here are the research highlights:\n${JSON.stringify(
        highlights
      )}\n\nGenerate the affinity map in ${languagePrompt}.`;

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
      }, 2, 2000, "Affinity Mapping");

      try {
        affinityJson = JSON.parse(affinityResponse.text || "{}");
      } catch (e) {
        console.warn("Failed to parse Affinity JSON, continuing with empty.", e);
      }
    } catch (error) {
      console.warn("Affinity Mapping step failed (likely quota), skipping.", error);
      // Continue without affinity map
    }

    // --- STEP 3: Insights page (from highlights) ---
    let insightsJson: any = { themes: [], wordCloud: [], problemPatternsChart: [] };
    try {
      const insightsUserMessage = `Use these highlights to generate insights:\n${JSON.stringify(
        highlights
      )}\n\nOutput in ${languagePrompt}.`;

      const insightsResponse = await retryOperation(async () => {
        return await ai.models.generateContent({
          model: reasonModelName,
          contents: {
            parts: [{ text: INSIGHTS_SYSTEM_PROMPT }, { text: insightsUserMessage }],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: INSIGHTS_SCHEMA,
            temperature: 0.3,
          },
        });
      }, 2, 2000, "Insights Generation");

      try {
        insightsJson = JSON.parse(insightsResponse.text || "{}");
      } catch (e) {
        console.warn("Failed to parse Insights JSON, continuing with empty.", e);
      }
    } catch (error) {
      console.warn("Insights Generation step failed (likely quota), skipping.", error);
      // Continue without insights
    }

    // --- Normalize output to ResearchData ---
    const ensureArray = (arr: any) => (Array.isArray(arr) ? arr : []);

    // Transform flat API clusters into UI Clusters
    const apiClusters = ensureArray(affinityJson.items);
    const uiClusters = apiClusters.map((cluster: any, index: number) => {
      const clusterItems = ensureArray(cluster.highlightIds).map((hId: string) => {
        const highlight = highlights.find((h: any) => h.id === hId);
        return {
          id: hId || Math.random().toString(36).substr(2, 9),
          text: highlight ? highlight.text : "Missing quote...",
          highlightIds: [hId],
          type: 'note'
        };
      });

      // Initialize with default layout positions (grid-ish)
      return {
        id: cluster.id || `cluster-${index}`,
        title: cluster.title || "Untitled Cluster",
        items: clusterItems,
        color: cluster.color || "#E2E8F0",
        x: 50 + (index % 3) * 350,
        y: 50 + Math.floor(index / 3) * 400,
        width: 300,
        height: 340
      };
    });

    // Map themes to Insights Table format
    const insightsTable = ensureArray(insightsJson.themes).map((t: any) => ({
      theme: t.theme,
      emotion: t.dominantEmotion,
      need: t.need,
      opportunity: t.opportunity,
      proposedUXSolution: t.uxSolution,
      quoteId: t.evidenceHighlightIds?.[0] || "",
      text: t.evidenceHighlightIds?.[0]
        ? (highlights.find((h: any) => h.id === t.evidenceHighlightIds[0])?.text || "Quote not found")
        : ""
    }));

    return {
      transcript: mainJson.transcript || "",
      tags: ensureArray(mainJson.tags),
      highlights: ensureArray(mainJson.highlights),
      clusters: uiClusters,
      insights: {
        painPoints: ensureArray(mainJson.painPoints),
        opportunities: ensureArray(mainJson.opportunities),
        patterns: ensureArray(mainJson.patterns),
        sentiment: mainJson.sentiment || { label: "Neutral", score: 50, distribution: [] },
        insightsTable: insightsTable,
        wordCloud: ensureArray(insightsJson.wordCloud),
        problemPatternsChart: ensureArray(insightsJson.problemPatternsChart),
        // Fallbacks for keys checking
        keyPainPoints: ensureArray(mainJson.painPoints),
        keyOpportunities: ensureArray(mainJson.opportunities)
      },
      summary: mainJson.keyFindings ? {
        keyFindings: ensureArray(mainJson.keyFindings),
        quotes: ensureArray(mainJson.keyQuotes),
        recommendations: ensureArray(mainJson.recommendations)
      } : {
        keyFindings: [], quotes: [], recommendations: []
      }
    } as any;
  } catch (error: any) {
    // ✅ Friendly quota error
    if (isQuota429(error)) {
      throw new Error(
        "Gemini free-tier quota exceeded (input tokens). " +
        "This usually happens when sending a large video. " +
        "Try: (1) upload audio (.mp3) extracted from the video, (2) upload transcript (.txt), or (3) upload a shorter clip."
      );
    }

    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};
