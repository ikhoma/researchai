import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type, Schema } from "@google/genai";

const AFFINITY_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        clusters: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    color: { type: Type.STRING },
                    items: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                text: { type: Type.STRING },
                                highlightIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                                type: { type: Type.STRING, enum: ["note", "subcluster"] },
                            },
                            required: ["id", "text"],
                        },
                    },
                },
                required: ["id", "title", "items", "color"],
            },
        },
    },
    required: ["clusters"],
};

const AFFINITY_SYSTEM_PROMPT = `
You are a qualitative research clustering engine.
Analyze the provided highlights and group them into logical clusters.
Each cluster should have a title, a color (pastel hex), and a list of items.
Each item represents a synthesized note or a group of highlights.

Rules:
- Use ALL provided highlights.
- No orphan highlights.
- Themes: 2–4 words.
- No fluff.
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "Server API key missing: GEMINI_API_KEY" });
        }

        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        const highlights = body?.highlights || [];
        const language = body?.language || "uk";
        const languagePrompt = language === "uk" ? "Ukrainian" : "English";

        const ai = new GoogleGenAI({ apiKey });

        const userMessage = `Here are the research highlights:\n${JSON.stringify(
            highlights
        )}\n\nGenerate the affinity map (clusters and items) in ${languagePrompt}. Return ONLY valid JSON matching the AFFINITY_SCHEMA.`;

        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: { parts: [{ text: AFFINITY_SYSTEM_PROMPT }, { text: userMessage }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: AFFINITY_SCHEMA,
                temperature: 0.3,
            },
        });

        const json = JSON.parse(response.text || "{}");
        return res.status(200).json(json.clusters || []);
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ error: e?.message || "Server error" });
    }
}
