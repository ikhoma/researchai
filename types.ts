

export enum AppScreen {
  START = 'START',
  UPLOAD = 'UPLOAD',
  PROCESSING = 'PROCESSING',
  TRANSCRIPT = 'TRANSCRIPT',
  AFFINITY = 'AFFINITY',
  INSIGHTS = 'INSIGHTS',
  SUMMARY = 'SUMMARY',
  EXPORT = 'EXPORT',
  END = 'END',
}

export type Language = 'en' | 'uk';

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export interface Highlight {
  id: string;
  text: string;
  tagId: string;
  startIndex?: number; // Simplified for MVP
}

export interface AffinityItem {
  id: string;
  text: string;
  highlightIds?: string[];
  type?: 'subcluster' | 'note';
}

export interface Cluster {
  id: string;
  title: string;
  items: AffinityItem[];
  color: string;
  // Layout properties for Affinity Map
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SentimentData {
  label: 'Positive' | 'Neutral' | 'Negative' | 'Mixed';
  score: number;
  distribution: { name: string; value: number; color: string }[];
}

export interface Task {
  id: string;
  text: string;
  priority: 'High' | 'Medium' | 'Low';
}

// --- NEW INSIGHTS ENGINE TYPES ---

export interface InsightTableRow {
  quoteId: string;
  text: string;
  theme: string;
  emotion: string;
  need: string;
  opportunity: string;
  proposedUXSolution: string;
}

export interface WordCloudItem {
  word: string;
  count: number;
}

export interface ProblemPattern {
  theme: string;
  frequency: number;
  intensity: number; // 1-5
}

export interface ResearchData {
  transcript: string;
  tags: Tag[];
  highlights: Highlight[];
  clusters: Cluster[];
  insights: {
    painPoints: string[];
    opportunities: string[];
    patterns: string[];
    sentiment: SentimentData;
    // New structured insights
    insightsTable?: InsightTableRow[];
    keyNeeds?: string[];
    keyPainPoints?: string[];
    keyOpportunities?: string[];
    synthesis?: string;
    wordCloud?: WordCloudItem[];
    problemPatternsChart?: ProblemPattern[];
  };
  summary: {
    keyFindings: string[];
    quotes: string[];
    recommendations: Task[];
  };
}

export interface SavedProject {
  id: string;
  name: string;
  date: string;
  fileType: 'video' | 'audio' | 'text';
  fileCount?: number;
  data: ResearchData;
}

export type FileStatus = 'uploading' | 'processing' | 'uploaded' | 'error';

export interface ProjectFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0-100
  type: 'video' | 'audio' | 'text';
  error?: string;
  analysisData?: ResearchData; // Store analysis per file
}

export interface ProjectState {
  id?: string;
  currentScreen: AppScreen;
  files: ProjectFile[];
  isProcessing: boolean;
  data: ResearchData | null;
  projectName: string;
  error?: string | null;
}

// Default empty data structure
export const INITIAL_DATA: ResearchData = {
  transcript: "",
  tags: [],
  highlights: [],
  clusters: [],
  insights: {
    painPoints: [],
    opportunities: [],
    patterns: [],
    sentiment: { label: 'Neutral', score: 50, distribution: [] },
    insightsTable: [],
    keyNeeds: [],
    keyPainPoints: [],
    keyOpportunities: [],
    synthesis: "",
    wordCloud: [],
    problemPatternsChart: []
  },
  summary: {
    keyFindings: [],
    quotes: [],
    recommendations: [],
  },
};