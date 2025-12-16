import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable from "formidable";
import fs from "node:fs/promises";
import { GoogleGenAI, Type, Schema } from "@google/genai";

export const config = {
    api: {
        bodyParser: false,
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

function parseForm(req: VercelRequest) {
    const form = formidable({ multiples: false, keepExtensions: true });
    return new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
            if (err) reject(err);
            else resolve({ fields, files });
        });
    });
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

        const { fields, files } = await parseForm(req);

        const fileType = String(fields.fileType || "audio");
        const language = String(fields.language || "uk");
        const languagePrompt = language === "uk" ? "Ukrainian" : "English";

        const f = files.file as formidable.File | formidable.File[] | undefined;
        const fileObj = Array.isArray(f) ? f[0] : f;

        if (!fileObj?.filepath) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const mimeType =
            fileObj.mimetype ||
            (fileType === "video" ? "video/mp4" : fileType === "audio" ? "audio/mpeg" : "text/plain");

        const buf = await fs.readFile(fileObj.filepath);
        const base64 = buf.toString("base64");

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
   - Key Findings + quotes + recommendations.

Output language: ${languagePrompt}.
Return ONLY valid JSON matching the MAIN_SCHEMA.
`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: {
                parts: [
                    { inlineData: { data: base64, mimeType } },
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
        return res.status(200).json(json);
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ error: e?.message || "Server error" });
    }
}
