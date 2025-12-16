// api/analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import formidable from "formidable";
import fs from "node:fs";

export const config = {
    api: {
        bodyParser: false, // IMPORTANT for formidable
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }

        // ✅ ВАЖЛИВО: назви змінної
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "Server API key missing: GEMINI_API_KEY" });
        }

        const { file, fields } = await parseForm(req);

        const fileType = String(fields.fileType || "audio");
        const language = String(fields.language || "uk");
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

        // Малий файл → inline base64. (для великих файлів потім доробимо files.upload)
        const buf = fs.readFileSync(file.filepath);
        const base64 = buf.toString("base64");

        const mimeType =
            file.mimetype ||
            (fileType === "video" ? "video/mp4" : fileType === "audio" ? "audio/mpeg" : "text/plain");

        const contentPart = {
            inlineData: {
                data: base64,
                mimeType,
            },
        };

        const resp = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: { parts: [contentPart, { text: mainSystemPrompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: MAIN_SCHEMA,
                temperature: 0.2,
            },
        });

        const json = JSON.parse(resp.text || "{}");
        return res.status(200).json(json);
    } catch (err: any) {
        console.error(err);
        return res.status(500).json({ error: err?.message || "Unknown error" });
    }
}

function parseForm(req: VercelRequest) {
    const form = formidable({ multiples: false });

    return new Promise<{ file: formidable.File; fields: Record<string, any> }>((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
            if (err) return reject(err);
            const f = files.file;
            if (!f || Array.isArray(f)) return reject(new Error("No file uploaded (field name must be 'file')"));
            resolve({ file: f, fields });
        });
    });
}
