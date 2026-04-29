import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { YoutubeTranscript } from "youtube-transcript";

export const config = {
    api: {
        bodyParser: true,
    },
};

type TranscriptSegment = {
    text: string;
    duration?: number;
    offset?: number;
    lang?: string;
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

function decodeEntities(value: string): string {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function parseTranscriptPayload(payload: string, lang?: string): TranscriptSegment[] {
    const trimmed = payload.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        const events = Array.isArray(parsed.events) ? parsed.events : [];
        return events
            .map((event: any) => {
                const text = Array.isArray(event.segs)
                    ? event.segs.map((seg: any) => seg.utf8 || "").join("")
                    : "";
                return {
                    text: text.replace(/\s+/g, " ").trim(),
                    offset: event.tStartMs,
                    duration: event.dDurationMs,
                    lang,
                };
            })
            .filter((segment: TranscriptSegment) => Boolean(segment.text));
    }

    const segments: TranscriptSegment[] = [];
    const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pRegex.exec(trimmed)) !== null) {
        const inner = pMatch[3];
        const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
        if (text) {
            segments.push({
                text,
                offset: Number(pMatch[1]),
                duration: Number(pMatch[2]),
                lang,
            });
        }
    }
    if (segments.length > 0) return segments;

    const textRegex = /<text start="([^"]*)" dur="([^"]*)">([\s\S]*?)<\/text>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(trimmed)) !== null) {
        const text = decodeEntities(textMatch[3]).replace(/\s+/g, " ").trim();
        if (text) {
            segments.push({
                text,
                offset: Math.round(Number(textMatch[1]) * 1000),
                duration: Math.round(Number(textMatch[2]) * 1000),
                lang,
            });
        }
    }
    return segments;
}

async function fetchTranscriptViaInnerTube(videoId: string): Promise<TranscriptSegment[]> {
    const failures: string[] = [];
    const clients = [
        {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
        },
        {
            clientName: "WEB",
            clientVersion: "2.20240401.00.00",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        },
        {
            clientName: "IOS",
            clientVersion: "20.10.4",
            userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X;)",
        },
        {
            clientName: "TVHTML5",
            clientVersion: "7.20240403.14.00",
            userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/5.0 TV Safari/537.36",
        },
    ];

    for (const client of clients) {
        try {
            const playerResponse = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": client.userAgent,
                },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: client.clientName,
                            clientVersion: client.clientVersion,
                            hl: "en",
                        },
                        thirdParty: {
                            embedUrl: `https://www.youtube.com/embed/${videoId}`,
                        },
                    },
                    videoId,
                }),
            });

            if (!playerResponse.ok) {
                failures.push(`${client.clientName}: player ${playerResponse.status}`);
                continue;
            }

            const playerJson = await playerResponse.json();
            const playabilityStatus = playerJson?.playabilityStatus?.status;
            const playabilityReason = playerJson?.playabilityStatus?.reason;
            const captionTracks = playerJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
                failures.push(`${client.clientName}: no caption tracks (${playabilityStatus || "unknown"}${playabilityReason ? `: ${playabilityReason}` : ""})`);
                continue;
            }

            const preferredTrack =
                captionTracks.find((track: any) => track.languageCode === "en") ||
                captionTracks.find((track: any) => track.kind === "asr") ||
                captionTracks[0];

            const transcriptUrl = new URL(preferredTrack.baseUrl);
            transcriptUrl.searchParams.set("fmt", "json3");

            const transcriptResponse = await fetch(transcriptUrl, {
                headers: {
                    "Accept-Language": preferredTrack.languageCode || "en",
                    "User-Agent": client.userAgent,
                },
            });
            if (!transcriptResponse.ok) {
                failures.push(`${client.clientName}: transcript ${transcriptResponse.status}`);
                continue;
            }

            const transcriptPayload = await transcriptResponse.text();
            const segments = parseTranscriptPayload(transcriptPayload, preferredTrack.languageCode);
            if (segments.length > 0) return segments;
            failures.push(`${client.clientName}: transcript payload was empty`);
        } catch {
            failures.push(`${client.clientName}: request failed`);
        }
    }

    throw new Error(`Innertube fallback failed: ${failures.join("; ") || "no caption tracks"}`);
}

async function fetchYoutubeTranscript(videoId: string, youtubeUrl: string): Promise<TranscriptSegment[]> {
    const attempts: Array<{ label: string; run: () => Promise<TranscriptSegment[]> }> = [
        { label: "youtube-transcript:id", run: () => YoutubeTranscript.fetchTranscript(videoId) },
        { label: "youtube-transcript:url", run: () => YoutubeTranscript.fetchTranscript(youtubeUrl) },
        { label: "youtube-transcript:en", run: () => YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }) },
        { label: "innertube", run: () => fetchTranscriptViaInnerTube(videoId) },
    ];

    const failures: string[] = [];
    for (const attempt of attempts) {
        try {
            const segments = await attempt.run();
            if (segments.length > 0) return segments;
            failures.push(`${attempt.label}: no segments`);
        } catch (error) {
            failures.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw new Error(`Transcript fetch failed after fallback attempts. ${failures.join(" | ")}`);
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

        const { youtubeUrl, language, transcriptOverride } = req.body as {
            youtubeUrl?: string;
            language?: string;
            transcriptOverride?: string;
        };

        if (!youtubeUrl) {
            return res.status(400).json({ error: "No YouTube URL provided" });
        }

        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            return res.status(400).json({ error: "Could not extract a valid YouTube video ID from the URL" });
        }

        const pastedTranscript = transcriptOverride?.replace(/\s+/g, " ").trim();
        let rawSegments: TranscriptSegment[];

        if (pastedTranscript && pastedTranscript.length >= 20) {
            rawSegments = [{ text: pastedTranscript }];
        } else {
            // Fetch captions — throws if captions are disabled or YouTube blocks the server.
            try {
                rawSegments = await fetchYoutubeTranscript(videoId, youtubeUrl);
            } catch (e: any) {
                return res.status(422).json({
                    error: `Could not fetch transcript for this video. ${e?.message || e}`,
                    canPasteTranscript: true,
                });
            }
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
