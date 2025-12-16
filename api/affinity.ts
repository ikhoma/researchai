export const config = {
    runtime: "nodejs20.x",
};
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type, Schema } from "@google/genai";

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

const AFFINITY_SYSTEM_PROMPT = `
You are a qualitative research clustering engine.
Return ONLY valid JSON that follows the AFFINITY_SCHEMA.
Rules:
- Use ALL provided highlights.
- No orphan highlights.
- Themes: 2–4 words, Subclusters: 2–5 words.
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
        )}\n\nGenerate the affinity map in ${languagePrompt}.`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: { parts: [{ text: AFFINITY_SYSTEM_PROMPT }, { text: userMessage }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: AFFINITY_SCHEMA,
                temperature: 0.3,
            },
        });

        const json = JSON.parse(response.text || "{}");
        // тут можна повернути items як clusters (поки 1-в-1)
        return res.status(200).json({ clusters: json.items || [] });
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ error: e?.message || "Server error" });
    }
}
