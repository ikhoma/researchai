// services/geminiService.ts
import type { ResearchData, Language } from "../types";

/**
 * Надсилає файл на серверний ендпоінт /api/analyze (Vercel Function),
 * де вже є доступ до process.env.GEMINI_API_KEY
 */
export const analyzeResearchFile = async (
  file: File,
  fileType: "video" | "audio" | "text",
  onProgress?: (status: "uploading" | "processing" | "uploaded", progress?: number) => void,
  language: Language = "uk"
): Promise<ResearchData> => {
  if (onProgress) onProgress("uploading", 10);

  const form = new FormData();
  form.append("file", file);
  form.append("fileType", fileType);
  form.append("language", language);

  // Важливо: відносний шлях, щоб працювало і локально, і на Vercel
  const res = await fetch("/api/analyze", {
    method: "POST",
    body: form,
  });

  if (onProgress) onProgress("processing", 80);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error || `Analyze failed (${res.status})`;
    throw new Error(msg);
  }

  if (onProgress) onProgress("uploaded", 100);

  return data as ResearchData;
};

/**
 * Якщо зараз affinity мапа тобі НЕ треба — можеш залишити,
 * але App.ts тоді не буде ламатись на імпорті.
 *
 * Тут заглушка (пізніше зробимо /api/affinity і підключимо).
 */
export const generateAffinityMap = async (
  _highlights: any[],
  _language: Language = "uk"
): Promise<any[]> => {
  // Повертаємо пусто, щоб UI не падав
  return [];
};
