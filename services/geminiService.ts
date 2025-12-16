

import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ResearchData, Tag, Cluster, Highlight, Language, AffinityItem } from "../types";

// Helper for retrying operations with exponential backoff
const retryOperation = async <T>(
  operation: () => Promise<T>,
  retries = 5,
  delay = 5000,
  operationName = "Operation"
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      console.warn(`${operationName} attempt ${i + 1} failed:`, error);
      lastError = error;

      const status = error.status || (error.response ? error.response.status : null);
      // Don't retry client errors (4xx) except 429. Retry 5xx.
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
  throw lastError;
};

// Helper to convert File to Base64 (only for small files)
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64String = reader.result.split(',')[1];
        resolve({
          inlineData: {
            data: base64String,
            mimeType: file.type || 'application/octet-stream',
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

// --- SCHEMAS ---

// 1. Main Analysis Schema (Transcript, Highlights, Summary) - No Clusters
const MAIN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING, description: "The detailed dialogue transcript." },
    tags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING, description: "Short label (max 3-5 words)." },
          color: { type: Type.STRING, description: "Hex color code, pastel preferred (e.g. #FCA5A5, #86EFAC)." }
        }
      }
    },
    highlights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING, description: "The exact quote text from the transcript." },
          tagId: { type: Type.STRING }
        }
      }
    },
    painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
    opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
    patterns: { type: Type.ARRAY, items: { type: Type.STRING } },
    sentiment: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING, enum: ["Positive", "Neutral", "Negative", "Mixed"] },
        score: { type: Type.INTEGER, description: "0 to 100" },
        distribution: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, enum: ["Positive", "Neutral", "Negative"] },
              value: { type: Type.INTEGER }
            }
          }
        }
      },
      required: ["label", "score", "distribution"]
    },
    keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
    keyQuotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "The actionable task or recommendation." },
          priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] }
        },
        required: ["text", "priority"]
      }
    }
  },
  required: ["transcript", "tags", "highlights", "painPoints", "opportunities", "patterns", "sentiment", "recommendations"]
};

// 2. Affinity Map Schema (Strict Structure)
const AFFINITY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    affinityMap: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING, description: "High-level theme name (2-4 words)." },
          description: { type: Type.STRING, description: "1-2 sentences explaining theme." },
          color: { type: Type.STRING, description: "Hex color value." },
          subclusters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING, description: "Pattern name (2-5 words)." },
                description: { type: Type.STRING, description: "Short description of pattern." },
                highlightIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "List of highlight IDs that belong to this subcluster."
                }
              },
              required: ["id", "label", "highlightIds"]
            }
          }
        },
        required: ["id", "label", "subclusters", "color"]
      }
    }
  },
  required: ["affinityMap"]
};

// 3. Insights Engine Schema
const INSIGHTS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    insightsTable: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          quoteId: { type: Type.STRING },
          text: { type: Type.STRING },
          theme: { type: Type.STRING },
          emotion: { type: Type.STRING },
          need: { type: Type.STRING },
          opportunity: { type: Type.STRING },
          proposedUXSolution: { type: Type.STRING }
        },
        required: ["text", "theme", "emotion", "need", "opportunity", "proposedUXSolution"]
      }
    },
    keyPainPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
    keyNeeds: { type: Type.ARRAY, items: { type: Type.STRING } },
    keyOpportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
    synthesis: { type: Type.STRING },
    wordCloud: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          count: { type: Type.INTEGER }
        },
        required: ["word", "count"]
      }
    },
    problemPatternsChart: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING },
          frequency: { type: Type.INTEGER },
          intensity: { type: Type.INTEGER }
        },
        required: ["theme", "frequency", "intensity"]
      }
    }
  },
  required: ["insightsTable", "keyPainPoints", "keyNeeds", "keyOpportunities", "synthesis", "wordCloud", "problemPatternsChart"]
};

// --- PROMPTS ---

const AFFINITY_SYSTEM_PROMPT = `
You are an Affinity Mapping Engine for qualitative research. 
Your task is to transform coded highlights (verbatim quotes) into a structured affinity map that follows UX research best practices.

You MUST return ONLY valid JSON and strictly follow the AFFINITY_SCHEMA.

────────────────────────────────────────
AFFINITY MAPPING PRINCIPLES (MANDATORY)
────────────────────────────────────────

1. THEMATIC CLUSTERING
Group highlights into clusters based on semantic similarity, not surface words.
A cluster represents a shared meaning, pain point, behavior, or motivation.

2. HIERARCHICAL STRUCTURE
An affinity map must contain:
- **Themes** — high-level conceptual topics
- **Subclusters (patterns)** — recurring ideas within a theme
- **Highlights (evidence)** — verbatim quotes (linked via ID)

3. CLUSTER QUALITY RULES
Each theme must:
- Capture one coherent concept
- NOT be too broad ("General Issues") or too narrow
- Contain at least 2 subclusters

Each subcluster must:
- Represent a recurring pattern across highlights
- Have multiple highlights if possible
- NOT duplicate other subclusters in meaning

4. EVIDENCE REQUIREMENT
Every subcluster MUST link to real verbatim highlights via their highlight IDs.
No fabricated or paraphrased text is allowed.

5. COVERAGE
The affinity map must:
- Use ALL provided highlights
- Avoid unassigned “orphans”
- Merge meaningfully overlapping clusters

6. NAMES & LABELS
Use short, powerful, researcher-friendly labels:
- Themes: 2–4 words (e.g., “Marketplace Overload”, “Pricing Logic Complexity”)
- Subclusters: 2–5 words
- No jargon, no fluff
`;

const INSIGHTS_SYSTEM_PROMPT = `
You are an AI Insights Engine for qualitative UX research.  
Your task is to transform interview transcripts or coded highlights into a structured INSIGHTS PAGE that can be rendered directly in a research dashboard.

You MUST return ONLY valid JSON that follows the INSIGHTS_SCHEMA.
Do NOT include comments, explanations, or text outside the JSON.  

────────────────────────────────────────
INTERPRETATION RULES (MANDATORY)
────────────────────────────────────────

1. Use ONLY verbatim quotes provided in the input. No fabrication.
2. Interpret the meaning behind each quote:
   - Identify the theme (semantic cluster)
   - Extract the dominant emotion (frustration, confusion, overload, relief, confidence, etc.)
   - Identify the underlying user need
   - Identify the opportunity for product improvement
   - Suggest a clear, feasible UX solution

3. Themes must be:
   - 1–3 words
   - Human-readable
   - Meaning-based (e.g., “Marketplace Noise”, “System Stability”, “Pricing Logic”)

4. Needs must reflect psychology of user behavior:
   - clarity, predictability, speed, trust, effort reduction, control, error recovery, reassurance

5. UX solutions must be:
   - specific, actionable, one-sentence
   - grounded in common app capabilities (filters, grouping, UI clean-up, sorting, alerts, batching)

────────────────────────────────────────
WORD CLOUD GENERATION RULES
────────────────────────────────────────
- Extract emotionally charged words from all quotes.
- Include only meaningful emotional terms (exclude stopwords).
- Count frequency.
- Sort descending.

────────────────────────────────────────
INFOGRAPHIC / DIAGRAM DATA RULES (problemPatternsChart)
────────────────────────────────────────
For each theme:
- Calculate frequency (how many quotes map to this theme).
- Derive intensity score (1–5) based on severity, operational impact, and urgency.
`;

// --- FUNCTIONS ---

export const analyzeResearchFile = async (
  file: File,
  fileType: 'video' | 'audio' | 'text',
  onProgress?: (status: 'uploading' | 'processing' | 'uploaded', progress?: number) => void,
  language: Language = 'uk'
): Promise<ResearchData> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found.");

  const ai = new GoogleGenAI({ apiKey });

  // Model selection
  const mainModelName = 'gemini-2.5-flash';
  const reasonModelName = 'gemini-2.5-flash';

  // 1. UPLOAD HANDLING
  if (file.size > 500 * 1024 * 1024) throw new Error("File exceeds 500MB limit.");

  let contentPart: any;

  try {
    if (onProgress) onProgress('uploading', 10);

    if (file.size > 20 * 1024 * 1024) {
      // Large file handling
      const mimeType = file.type || (fileType === 'video' ? 'video/mp4' : (fileType === 'audio' ? 'audio/mpeg' : 'text/plain'));

      const uploadResponse = await retryOperation(async () => {
        return await ai.files.upload({
          file: file,
          config: { mimeType, displayName: file.name }
        });
      }, 3, 3000, "File Upload");

      if (onProgress) onProgress('uploaded', 100);

      // @ts-ignore
      const uploadedFile = uploadResponse.file || uploadResponse;
      if (!uploadedFile?.name) throw new Error("Gemini File Upload failed.");
      const fileName = uploadedFile.name;
      const fileUri = uploadedFile.uri;

      if (onProgress) onProgress('processing');

      // Poll for processing
      let fileInfo = await ai.files.get({ name: fileName });
      // @ts-ignore
      let currentFile = fileInfo.file || fileInfo;
      let attempts = 0;
      while (currentFile.state === "PROCESSING" && attempts < 150) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        fileInfo = await ai.files.get({ name: fileName });
        // @ts-ignore
        currentFile = fileInfo.file || fileInfo;
        attempts++;
      }

      if (currentFile.state === "FAILED") throw new Error("Processing failed on server.");
      contentPart = { fileData: { fileUri: fileUri, mimeType: mimeType } };

    } else {
      // Inline
      if (onProgress) onProgress('uploading', 50);
      contentPart = await fileToGenerativePart(file);
      if (onProgress) onProgress('processing');
    }

    // --- STEP 1: TRANSCRIPT & HIGHLIGHTS ---

    const languagePrompt = language === 'uk' ? 'Ukrainian' : 'English';
    const mainSystemPrompt = `
      You are ReserchOO, an expert UX Research Assistant. 
      Analyze the provided user interview material.
      
      Tasks:
      1. GENERATE TRANSCRIPT: 
         - Create a DETAILED, verbatim-style transcript.
         - Format strictly as "Question: ..." and "Answer: ...".
      2. CODE & TAG:
         - Identify UX themes (System Stability, UI Clutter, etc).
         - Use short, consistent labels.
         - MAXIMIZE COVERAGE: Tag all relevant parts of the conversation.
         - PROVIDE COLORS: Assign distinct pastel hex colors to each tag.
      3. HIGHLIGHTS:
         - Extract EXACT text phrases matching the tags.
         - Text MUST be exact substrings of transcript (verbatim).
         - COVERAGE REQUIREMENT: You MUST include highlights from the BEGINNING, MIDDLE, and END of the transcript. Do not ignore any part.
         - QUANTITY: Extract at least 5-10 highlights per major theme. Aim for 15-20 highlights total.
      4. INSIGHTS & SUMMARY:
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
          // thinkingConfig removed as it's experimental and not supported on all models
        }
      });
    }, 2, 2000, "Main Analysis");

    let mainJson;
    try {
      mainJson = JSON.parse(mainResponse.text || "{}");
    } catch (e) {
      console.error("JSON Parse Error. Response text length:", mainResponse.text?.length);
      console.error("Response text start:", mainResponse.text?.substring(0, 500));
      console.error("Response text end:", mainResponse.text?.substring((mainResponse.text?.length || 0) - 500));
      throw new Error(`Failed to parse AI response. The response might be truncated due to size limits. Length: ${mainResponse.text?.length}`);
    }
    const rawHighlights = Array.isArray(mainJson.highlights) ? mainJson.highlights : [];

    // --- STEP 2: AFFINITY MAPPING (CHAINED) ---
    const highlightsJsonString = JSON.stringify(rawHighlights);
    const affinityUserMessage = `Here are the research highlights:\n${highlightsJsonString}\n\nGenerate the affinity map in ${languagePrompt}.`;

    const affinityResponse = await retryOperation(async () => {
      return await ai.models.generateContent({
        model: reasonModelName,
        contents: {
          parts: [
            { text: AFFINITY_SYSTEM_PROMPT },
            { text: affinityUserMessage }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: AFFINITY_SCHEMA,
          temperature: 0.3,
        }
      });
    }, 2, 2000, "Affinity Mapping");

    const affinityJson = JSON.parse(affinityResponse.text || "{}");

    // --- STEP 3: DEEP INSIGHTS (CHAINED) ---
    const insightsUserMessage = `Here are the research highlights with IDs:\n${highlightsJsonString}\n\nGenerate the deep insights page JSON in ${languagePrompt}.`;

    const insightsResponse = await retryOperation(async () => {
      return await ai.models.generateContent({
        model: reasonModelName,
        contents: {
          parts: [
            { text: INSIGHTS_SYSTEM_PROMPT },
            { text: insightsUserMessage }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: INSIGHTS_SCHEMA,
          temperature: 0.3
        }
      });
    }, 2, 2000, "Insights Generation");

    const insightsJson = JSON.parse(insightsResponse.text || "{}");

    // --- MERGE & FINALIZE ---

    const ensureArray = (arr: any) => Array.isArray(arr) ? arr : [];

    // ID Remapping
    const filePrefix = Math.random().toString(36).substr(2, 5);

    const rawTags = ensureArray(mainJson.tags);
    const tagIdMap = new Map<string, string>();
    const uniqueTags = rawTags.map((t: any) => {
      const newId = `${filePrefix}_${t.id}`;
      tagIdMap.set(t.id, newId);
      return { ...t, id: newId };
    });

    const highlightIdMap = new Map<string, string>(); // Old ID -> New ID
    const uniqueHighlights = rawHighlights.map((h: any) => {
      const newId = `${filePrefix}_${h.id}`;
      highlightIdMap.set(h.id, newId);
      return {
        ...h,
        id: newId,
        tagId: tagIdMap.get(h.tagId) || h.tagId
      };
    });

    // Map Affinity Structure
    const rawThemes = ensureArray(affinityJson.affinityMap);
    const clusters = rawThemes.map((theme: any, i: number) => {
      const items = ensureArray(theme.subclusters).map((sub: any) => ({
        id: `${filePrefix}_${sub.id}`,
        text: `${sub.label}: ${sub.description || ''}`.trim(),
        type: 'subcluster' as const,
        highlightIds: ensureArray(sub.highlightIds).map((hid: string) => highlightIdMap.get(hid) || hid)
      }));

      return {
        id: `${filePrefix}_${theme.id || Math.random().toString(36)}`,
        title: theme.label,
        items: items,
        color: theme.color || '#E2E8F0',
        x: 50 + (i % 3) * 350,
        y: 50 + Math.floor(i / 3) * 350,
        width: 320,
        height: 340
      };
    });

    // Process Insights Table with remapped IDs
    const rawInsightsTable = ensureArray(insightsJson.insightsTable);
    const insightsTable = rawInsightsTable.map((row: any) => ({
      ...row,
      quoteId: highlightIdMap.get(row.quoteId) || row.quoteId
    }));

    return {
      transcript: mainJson.transcript || "",
      tags: uniqueTags,
      highlights: uniqueHighlights,
      clusters: clusters,
      insights: {
        painPoints: ensureArray(mainJson.painPoints),
        opportunities: ensureArray(mainJson.opportunities),
        patterns: ensureArray(mainJson.patterns),
        sentiment: {
          label: mainJson.sentiment?.label || "Neutral",
          score: typeof mainJson.sentiment?.score === 'number' ? mainJson.sentiment.score : 50,
          distribution: ensureArray(mainJson.sentiment?.distribution)
        },
        // Deep Insights Data
        insightsTable: insightsTable,
        keyNeeds: ensureArray(insightsJson.keyNeeds),
        keyPainPoints: ensureArray(insightsJson.keyPainPoints),
        keyOpportunities: ensureArray(insightsJson.keyOpportunities),
        synthesis: insightsJson.synthesis || "",
        wordCloud: ensureArray(insightsJson.wordCloud),
        problemPatternsChart: ensureArray(insightsJson.problemPatternsChart)
      },
      summary: {
        keyFindings: ensureArray(mainJson.keyFindings),
        quotes: ensureArray(mainJson.keyQuotes),
        recommendations: ensureArray(mainJson.recommendations).map((r: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          text: r.text || "",
          priority: r.priority || "Medium"
        }))
      }
    };

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};
