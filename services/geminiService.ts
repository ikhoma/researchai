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

  const res = await fetch("/api/analyze", {
    method: "POST",
    body: form,
  });

  onProgress?.("processing", 70);

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
