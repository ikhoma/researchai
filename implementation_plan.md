# Add YouTube Link as a Source File

Users can currently upload local video, audio, and text files. This adds a **"Add YouTube Link"** flow that fetches the transcript server-side and feeds it through the same analysis pipeline as any other source.

## How It Works (Architecture)

```mermaid
flowchart LR
    A[User pastes YouTube URL] --> B[/api/youtube — new serverless fn]
    B --> C[youtube-transcript npm pkg]
    C --> D[Raw captions text]
    D --> E[Gemini 2.5 Flash — same MAIN_SCHEMA]
    E --> F[ResearchData JSON]
    F --> G[Stored in ProjectFile as synthetic File object]
    G --> H[Transcript / Affinity / Insights screens unchanged]
```

**Key design decision**: YouTube sources are modelled as a `ProjectFile` with `type: 'youtube'`. The transcript text is wrapped in a synthetic `File` object so the entire downstream pipeline (state, rendering, export) stays untouched.

## Proposed Changes

---

### `types.ts`

#### [MODIFY] [types.ts](file:///Users/ivan.khoma/Projects/reserchai/types.ts)

- Extend `ProjectFile.type` union: `'video' | 'audio' | 'text' | 'youtube'`
- Extend `SavedProject.fileType` union: `'video' | 'audio' | 'text' | 'youtube'`

---

### New serverless API

#### [NEW] [api/youtube.ts](file:///Users/ivan.khoma/Projects/reserchai/api/youtube.ts)

- Accepts `POST { youtubeUrl, language }`
- Extracts video ID, fetches captions via `youtube-transcript` (no API key required — uses YouTube's public timedtext endpoint)
- Passes raw transcript text to Gemini with the **exact same `MAIN_SCHEMA` and system prompt** as `analyze.ts`
- Returns `ResearchData` JSON

---

### `services/geminiService.ts`

#### [MODIFY] [geminiService.ts](file:///Users/ivan.khoma/Projects/reserchai/services/geminiService.ts)

- Add `analyzeYoutubeUrl(url, language, onProgress)` that calls `/api/youtube`

---

### `App.tsx`

#### [MODIFY] [App.tsx](file:///Users/ivan.khoma/Projects/reserchai/App.tsx)

**`UploadScreen` component** (lines ~94–328):
- Add a "YouTube Link" tab/button next to "Browse" and "Record"
- Small inline input: text field + "Add" button that validates the URL
- On submit calls `onAddYoutubeUrl(url)`

**`handleAddFiles` → new `handleAddYoutubeUrl`** (lines ~1994):
- Creates a `ProjectFile` with `type: 'youtube'`
- Calls `analyzeYoutubeUrl` instead of `analyzeResearchFile`
- Wraps the returned transcript in a synthetic `File` for display

**File list rendering** (line ~262, ~701):
- Icon: `smart_display` (YouTube-style icon) for `type === 'youtube'`
- Name: show the YouTube video title (returned from API) or the URL
- Size: show "YouTube" label instead of file size
- **No** `<video>` or `<audio>` player (show a YouTube embed iframe instead)

## Verification Plan

### Automated
- `npm run build` — TypeScript must compile clean

### Manual
1. Paste a YouTube URL with auto-captions (e.g. a product walkthrough video)
2. Confirm the file card appears with the YouTube icon and URL label
3. Confirm it reaches `uploaded` status and shows the transcript
4. Confirm Insights and Affinity tabs populate normally

## Open Questions

> [!NOTE]
> **Caption availability**: `youtube-transcript` only works if the video has captions (auto-generated counts). Videos with captions disabled will return an error — the UI will show the standard "Error" badge on the file card, same as for other failures.

> [!IMPORTANT]
> **`youtube-transcript` package**: Needs to be installed as a dependency (`npm install youtube-transcript`). It's a small zero-dependency package that uses YouTube's internal `timedtext` API — no API key needed.
