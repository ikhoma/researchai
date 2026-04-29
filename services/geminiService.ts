import { ResearchData, Language } from "../types";

/**
 * Frontend service:
 * - НЕ читає ключі
 * - Викликає Vercel Serverless Functions (/api/*)
 */

export const analyzeResearchFile = async (
  file: File,
  fileType: "video" | "audio" | "text",
  onProgress?: (status: "uploading" | "processing" | "uploaded", progress?: number) => void,
  language: Language = "uk"
): Promise<ResearchData> => {
  const form = new FormData();
  form.append("file", file);
  form.append("fileType", fileType);
  form.append("language", language);

  onProgress?.("uploading", 10);

  let currentProgress = 10;
  const interval = setInterval(() => {
    if (currentProgress < 95) {
      currentProgress += Math.floor(Math.random() * 5) + 1;
      if (currentProgress > 95) currentProgress = 95;
      onProgress?.("uploading", currentProgress);
    }
  }, 1000);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      body: form,
    });

    clearInterval(interval);
    onProgress?.("processing", 99);

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg =
        data?.error ||
        data?.message ||
        `Request failed: ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    onProgress?.("uploaded", 100);
    return data as ResearchData;
  } catch (err) {
    clearInterval(interval);
    throw err;
  }
};

/**
 * Analyze a YouTube video by URL.
 * Fetches captions server-side via /api/youtube and runs Gemini analysis.
 * Returns ResearchData (same shape as analyzeResearchFile) plus optional
 * YouTube metadata for display/embedding.
 */
export const analyzeYoutubeUrl = async (
  youtubeUrl: string,
  language: Language = "uk",
  onProgress?: (status: "uploading" | "processing" | "uploaded", progress?: number) => void,
  transcriptOverride?: string
): Promise<ResearchData & { youtubeVideoId?: string; videoTitle?: string }> => {
  onProgress?.("uploading", 20);

  let currentProgress = 20;
  const interval = setInterval(() => {
    if (currentProgress < 95) {
      // Slower increment for YouTube as processing usually takes a bit longer
      currentProgress += Math.floor(Math.random() * 3) + 1;
      if (currentProgress > 95) currentProgress = 95;
      onProgress?.("uploading", currentProgress);
    }
  }, 1200);

  try {
    const res = await fetch("/api/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeUrl, language, transcriptOverride }),
    });

    clearInterval(interval);
    onProgress?.("processing", 99);

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg =
        data?.error ||
        data?.message ||
        `YouTube request failed: ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    onProgress?.("uploaded", 100);
    return data as ResearchData & { youtubeVideoId?: string; videoTitle?: string };
  } catch (err) {
    clearInterval(interval);
    throw err;
  }
};

/**
 * Optional: Affinity map generation.
 * Якщо у тебе вкладка Affinity використовує generateAffinityMap —
 * цей експорт має існувати, інакше build падає.
 */
export const generateAffinityMap = async (
  highlights: any[],
  language: Language = "uk"
): Promise<any[]> => {
  const res = await fetch("/api/affinity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ highlights, language }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `Affinity failed: ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return (data?.clusters || []) as any[];
};
