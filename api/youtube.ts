import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { YoutubeTranscript } from "youtube-transcript";

export const config = {
    api: {
        bodyParser: true,
    },
};

// Reuse the same schema as analyze.ts
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
            },
            required: ["painPoints", "opportunities", "patterns", "sentiment"],
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
        // youtu.be/VIDEO_ID
        if (parsed.hostname === "youtu.be") {
            return parsed.pathname.slice(1).split("?")[0] || null;
        }
        // youtube.com/watch?v=VIDEO_ID, /shorts/VIDEO_ID, /embed/VIDEO_ID, /live/VIDEO_ID
        if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
            const videoParam = parsed.searchParams.get("v");
            if (videoParam) return videoParam;
            const pathMatch = parsed.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
            return pathMatch ? pathMatch[1] : null;
        }
    } catch {
        // Not a valid URL — try regex fallback
        const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
        return match ? match[1] : null;
    }
    return null;
}

async function fetchVideoTitle(youtubeUrl: string): Promise<string | undefined> {
    try {
        const endpoint = new URL("https://www.youtube.com/oembed");
        endpoint.searchParams.set("url", youtubeUrl);
        endpoint.searchParams.set("format", "json");
        const response = await fetch(endpoint);
        if (!response.ok) return undefined;
        const metadata = await response.json();
        return typeof metadata.title === "string" ? metadata.title : undefined;
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

        const { youtubeUrl, language } = req.body as { youtubeUrl?: string; language?: string };

        if (!youtubeUrl) {
            return res.status(400).json({ error: "No YouTube URL provided" });
        }

        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            return res.status(400).json({ error: "Could not extract a valid YouTube video ID from the URL" });
        }

        // Fetch captions — throws if captions are disabled
        let rawSegments: { text: string }[];
        try {
            rawSegments = await YoutubeTranscript.fetchTranscript(videoId);
        } catch (e: any) {
            return res.status(422).json({
                error: `Could not fetch transcript for this video. It may have captions disabled or be unavailable. (${e?.message || e})`,
            });
        }

        const rawText = rawSegments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

        if (!rawText) {
            return res.status(422).json({ error: "Transcript is empty for this video." });
        }

        const videoTitle = await fetchVideoTitle(youtubeUrl);

        const languagePrompt = language === "uk" ? "Ukrainian" : "English";

        const ai = new GoogleGenAI({ apiKey });

const mainSystemPrompt = `
You are ReserchOO, an expert UX Research Assistant.
Analyze the provided user interview material.

Tasks:
1) GENERATE TRANSCRIPT:
   - Create a DETAILED, verbatim-style transcript.
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
   - Sentiment.
5) SUMMARY:
   - Key Findings + quotes + recommendations.

Output language: ${languagePrompt}.
Return ONLY valid JSON matching the MAIN_SCHEMA.
`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: {
                parts: [
                    { text: `RAW YOUTUBE TRANSCRIPT:\n\n${rawText}` },
                    { text: mainSystemPrompt },
                ],
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: MAIN_SCHEMA,
                temperature: 0.2,
            },
        });

        const json = JSON.parse(response.text || "{}");

        // Attach metadata so the frontend can display and embed the source.
        json.youtubeVideoId = videoId;
        json.videoTitle = videoTitle || json.videoTitle || youtubeUrl;

        return res.status(200).json(json);
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ error: e?.message || "Server error" });
    }
}
