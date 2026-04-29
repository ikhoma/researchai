import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type, Schema } from "@google/genai";

export const config = {
    api: {
        bodyParser: true,
    },
};

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
        insights: {
            type: Type.OBJECT,
            properties: {
                painPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
                patterns: { type: Type.ARRAY, items: { type: Type.STRING } },
                sentiment: {
                    type: Type.OBJECT,
                    properties: {
                        label: { type: Type.STRING, enum: ["Positive", "Neutral", "Negative", "Mixed"] },
                        score: { type: Type.INTEGER },
                        distribution: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    value: { type: Type.INTEGER },
                                    color: { type: Type.STRING },
                                },
                                required: ["name", "value", "color"],
                            },
                        },
                    },
                    required: ["label", "score", "distribution"],
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
                            proposedUXSolution: { type: Type.STRING },
                        },
                        required: ["quoteId", "text", "theme", "emotion", "need", "opportunity", "proposedUXSolution"],
                    },
                },
            },
            required: ["painPoints", "opportunities", "patterns", "sentiment", "wordCloud", "problemPatternsChart", "insightsTable"],
        },

        summary: {
            type: Type.OBJECT,
            properties: {
                keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
                quotes: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendations: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            text: { type: Type.STRING },
                            priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                        },
                        required: ["id", "text", "priority"],
                    },
                },
            },
            required: ["keyFindings", "quotes", "recommendations"],
        },
    },
    required: ["transcript", "tags", "highlights", "insights", "summary"],
};

function extractVideoId(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === "youtu.be") {
            return parsed.pathname.slice(1).split("?")[0] || null;
        }
        if (parsed.hostname.includes("youtube.com")) {
            const v = parsed.searchParams.get("v");
            if (v) return v;
            const pathMatch = parsed.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
            return pathMatch ? pathMatch[1] : null;
        }
    } catch {
        const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
        return match ? match[1] : null;
    }
    return null;
}

async function fetchVideoTitle(url: string): Promise<string | undefined> {
    try {
        const endpoint = new URL("https://www.youtube.com/oembed");
        endpoint.searchParams.set("url", url);
        endpoint.searchParams.set("format", "json");
        const res = await fetch(endpoint.toString());
        if (!res.ok) return undefined;
        const data = await res.json();
        return typeof data.title === "string" ? data.title : undefined;
    } catch {
        return undefined;
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "Server API key missing: GEMINI_API_KEY" });
        }

        const { youtubeUrl, language } = req.body as {
            youtubeUrl?: string;
            language?: string;
        };

        if (!youtubeUrl) {
            return res.status(400).json({ error: "No YouTube URL provided" });
        }

        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            return res.status(400).json({ error: "Could not extract a valid YouTube video ID from the URL" });
        }

        // Normalise to a clean watch URL — Gemini requires this exact format
        const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

        const languagePrompt = language === "uk" ? "Ukrainian" : "English";

        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = `
You are ReserchOO, an expert UX Research Assistant.
Analyze the provided YouTube user interview video.

Tasks:
1) GENERATE TRANSCRIPT:
   - Create a DETAILED, verbatim-style transcript from the audio/video.
   - Format strictly as "Question: ..." and "Answer: ...".
2) CODE & TAG:
   - Identify UX themes.
   - Use short, consistent labels.
   - PROVIDE COLORS: pastel hex colors.
3) HIGHLIGHTS:
   - Extract exact phrases (verbatim).
   - 15–20 highlights if possible.
4) INSIGHTS:
   - Pain Points, Opportunities, Patterns.
   - Sentiment with distribution (Positive/Neutral/Negative percentages summing to 100).
   - wordCloud: extract 15–25 emotionally significant or frequently mentioned words with a count (1–10 scale).
   - problemPatternsChart: list 5–8 recurring problem themes, each with frequency (how often mentioned, 1–10) and intensity (how severe, 1–5).
   - insightsTable: for each major insight, provide a verbatim quote, theme label, dominant emotion, underlying user need, opportunity, and a concrete proposed UX solution.
5) SUMMARY:
   - Key Findings + quotes + recommendations.

Output language: ${languagePrompt}.
Return ONLY valid JSON matching the schema.
`;

        // Pass the YouTube URL directly to Gemini — no transcript scraping needed.
        // gemini-2.5-flash natively accepts YouTube URLs as video input via fileData.
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: {
                parts: [
                    {
                        fileData: {
                            mimeType: "video/mp4", // Gemini treats YouTube URLs as video regardless of mimeType value
                            fileUri: canonicalUrl,
                        },
                    },
                    { text: systemPrompt },
                ],
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: MAIN_SCHEMA,
                temperature: 0.2,
            },
        });

        const json = JSON.parse(response.text || "{}");

        const videoTitle = await fetchVideoTitle(canonicalUrl);
        json.youtubeVideoId = videoId;
        json.videoTitle = videoTitle || json.videoTitle || canonicalUrl;

        return res.status(200).json(json);
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ error: e?.message || "Server error" });
    }
}
