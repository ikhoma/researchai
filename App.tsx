

import React, { useState, useEffect, useRef } from 'react';
import { Layout } from './components/Layout';
import { Logo } from './components/Logo';
import { analyzeResearchFile, generateAffinityMap } from './services/geminiService';
import { ConfirmDialog } from './components/ConfirmDialog';
import { translations, Language } from './utils/translations';
import {
  AppScreen,
  ProjectState,
  INITIAL_DATA,
  Tag,
  Highlight,
  Task,
  SavedProject,
  ProjectFile,
  Cluster,
  ResearchData,
  AffinityItem
} from './types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid } from 'recharts';
import { TopNav } from './components/TopNav';

const STORAGE_KEY = 'reserchoo_project_data_v1';
const HISTORY_STORAGE_KEY = 'reserchoo_history_v1';

// --- Helper for MIME types ---
const getMimeType = (filename: string, fallbackGroup: 'video' | 'audio' | 'text'): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    'mp4': 'video/mp4', 'mov': 'video/quicktime', 'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska', 'webm': 'video/webm', 'm4v': 'video/x-m4v',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'aac': 'audio/aac', 'm4a': 'audio/mp4', 'flac': 'audio/flac', 'ogg': 'audio/ogg',
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv'
  };

  if (mimeMap[ext]) return mimeMap[ext];
  if (fallbackGroup === 'video') return 'video/mp4';
  if (fallbackGroup === 'audio') return 'audio/mpeg';
  return 'text/plain';
};

// Helper for formatting file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const getRandomPastelColor = () => {
  const hues = [0, 25, 50, 150, 200, 260, 320];
  const hue = hues[Math.floor(Math.random() * hues.length)] + (Math.random() * 20 - 10);
  return `hsl(${hue}, 75%, 85%)`;
};

// --- Sub-components for Screens ---

const StartScreen: React.FC<{ onStart: () => void, t: typeof translations['en'] }> = ({ onStart, t }) => (
  <div className="h-screen w-full flex flex-col items-center justify-center bg-white relative overflow-hidden">
    <div className="absolute top-20 left-20 text-[#BFA7F5]/20 text-9xl select-none floating-anim">✦</div>
    <div className="absolute bottom-40 right-40 text-[#FFD977]/30 text-8xl select-none floating-anim" style={{ animationDelay: '2s' }}>●</div>

    <div className="z-10 text-center flex flex-col items-center max-w-2xl px-6">
      <Logo size="xl" className="mb-6" />
      <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6 tracking-tight leading-tight">
        {t.start.title} <span className="text-[#BFA7F5]">{t.start.titleHighlight}</span>.
      </h1>
      <p className="text-xl text-slate-500 mb-10 leading-relaxed whitespace-pre-line">
        {t.start.subtitle}
      </p>
      <div className="flex gap-4">
        <button
          onClick={onStart}
          className="group relative px-8 py-4 bg-slate-900 text-white text-lg font-medium rounded-full shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center gap-2"
        >
          {t.start.button}
          <span className="material-icons group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </button>
      </div>
    </div>

    <div className="absolute bottom-10 text-sm text-slate-400">
      {t.start.footer}
    </div>
  </div>
);

const UploadScreen: React.FC<{
  onAddFiles: (files: File[], projectName: string) => void,
  onRemoveFile: (fileId: string) => void,
  files: ProjectFile[],
  isProcessing?: boolean,
  onProceed: () => void,
  t: typeof translations['en'],
  initialProjectName: string,
  onNameChange: (name: string) => void
}> = ({ onAddFiles, onRemoveFile, files, isProcessing, onProceed, t, initialProjectName, onNameChange }) => {
  const [projectName, setProjectName] = useState(initialProjectName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    setProjectName(initialProjectName);
  }, [initialProjectName]);

  const saveName = () => {
    setIsEditingName(false);
    if (projectName.trim() && projectName !== initialProjectName) {
      onNameChange(projectName);
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList);
      onAddFiles(filesArray, projectName);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        onAddFiles([file], projectName || "Audio Note");
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone error:", err);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const hasCompletedFiles = files.some(f => f.status === 'uploaded');

  return (
    <div className="max-w-3xl mx-auto pt-2 animate-fade-in pb-10">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">

        <div className="mb-8">
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t.upload.projectName}</label>
          {isEditingName ? (
            <div className="flex items-center">
              <input
                type="text"
                autoFocus
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                className="text-2xl font-bold text-slate-900 border-b-2 border-[#BFA7F5] outline-none w-full bg-transparent py-1"
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 group">
              <h3 className="text-2xl font-bold text-slate-900 truncate max-w-[500px]" title={projectName}>
                {projectName}
              </h3>
              <button
                onClick={() => setIsEditingName(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-[#BFA7F5] hover:bg-[#BFA7F5]/10 transition-all"
              >
                <span className="material-icons text-xl">edit</span>
              </button>
            </div>
          )}
          <p className="text-slate-500 mt-2">{t.upload.subtitle}</p>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${dragActive ? 'border-[#BFA7F5] bg-[#BFA7F5]/5' : 'border-slate-200 hover:border-slate-300'
            }`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFiles(e.dataTransfer.files); }}
        >
          <div className="w-16 h-16 bg-[#BFA7F5]/10 text-[#BFA7F5] rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="material-icons text-3xl">cloud_upload</span>
          </div>
          <h3 className="text-lg font-medium text-slate-900 mb-1">{t.upload.dragDrop}</h3>
          <p className="text-slate-500 mb-6 text-sm">{t.upload.supports} <br /><strong>{t.upload.maxSize}</strong></p>

          <div className="flex justify-center gap-4">
            <label className="px-6 py-2 bg-slate-900 text-white rounded-lg cursor-pointer hover:bg-slate-800 transition-colors flex items-center gap-2">
              {t.upload.browse}
              <input type="file" className="hidden" multiple accept="video/*,audio/*,.txt" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
            </label>

            {isRecording ? (
              <button
                onClick={stopRecording}
                className="px-6 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg cursor-pointer hover:bg-red-100 transition-colors flex items-center gap-2 animate-pulse"
              >
                <span className="material-icons text-sm">stop_circle</span>
                {t.upload.stopRecord}
              </button>
            ) : (
              <button
                onClick={startRecording}
                className="px-6 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <span className="material-icons text-sm text-slate-500">mic</span>
                {t.upload.record}
              </button>
            )}
          </div>
        </div>

        {files.length > 0 && (
          <div className="mt-8 space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <span className="material-icons text-slate-400 text-base">folder_open</span>
              {t.upload.projectFiles || "Project Files"}
            </h4>

            {files.map((fileItem) => (
              <div key={fileItem.id} className="relative bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center gap-4 overflow-hidden">
                {fileItem.status === 'uploading' && (
                  <div
                    className="absolute bottom-0 left-0 h-1 bg-[#BFA7F5] transition-all duration-300"
                    style={{ width: `${fileItem.progress}%` }}
                  ></div>
                )}
                {fileItem.status === 'processing' && (
                  <div className="absolute bottom-0 left-0 h-1 w-full bg-[#BFA7F5]/30 overflow-hidden">
                    <div className="h-full bg-[#BFA7F5] animate-progress-indeterminate"></div>
                  </div>
                )}
                {fileItem.status === 'uploaded' && (
                  <div className="absolute bottom-0 left-0 h-1 w-full bg-[#BFA7F5]"></div>
                )}

                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-slate-500 border border-slate-200">
                  <span className="material-icons">
                    {fileItem.type === 'video' ? 'videocam' : fileItem.type === 'audio' ? 'graphic_eq' : 'description'}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-900 truncate text-sm">{fileItem.file.name}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <span>{formatFileSize(fileItem.file.size)}</span>
                    {fileItem.status === 'uploading' && <span>• {t.upload.uploading} {fileItem.progress}%</span>}
                  </div>
                  {fileItem.status === 'error' && fileItem.error && (
                    <div className="mt-1.5 text-xs text-red-600 bg-red-50 px-2 py-1 rounded-md inline-block max-w-full break-words">
                      {fileItem.error}
                    </div>
                  )}
                </div>

                <div>
                  {fileItem.status === 'uploaded' && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Uploaded
                    </span>
                  )}
                  {fileItem.status === 'processing' && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 animate-pulse">
                      Processing
                    </span>
                  )}
                  {fileItem.status === 'error' && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      Error
                    </span>
                  )}
                </div>

                <button
                  onClick={() => onRemoveFile(fileItem.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                  title="Remove file"
                >
                  <span className="material-icons">delete_outline</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400 justify-center">
          <span className="material-icons text-sm">lock</span>
          {t.upload.secure}
        </div>

        {hasCompletedFiles && (
          <div className="mt-6 flex justify-end animate-fade-in">
            <button
              onClick={onProceed}
              className="px-6 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors flex items-center gap-2"
            >
              {t.success.button}
              <span className="material-icons">arrow_forward</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ProcessingScreen: React.FC<{ t: typeof translations['en'], error?: string | null, onBack?: () => void }> = ({ t, error, onBack }) => {
  if (error) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-white p-6">
        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6">
          <span className="material-icons text-4xl text-red-500">error_outline</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{t.common.error}</h2>
        <p className="text-slate-500 text-center max-w-md mb-8">{error}</p>
        <button
          onClick={onBack}
          className="px-6 py-3 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-white">
      <div className="relative w-24 h-24 mb-8">
        <div className="absolute inset-0 border-4 border-[#BFA7F5]/20 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-[#BFA7F5] border-t-transparent rounded-full animate-spin"></div>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">{t.processing.title}</h2>
      <p className="text-slate-500">{t.processing.step1}</p>
    </div>
  );
};

const SuccessScreen: React.FC<{ onContinue: () => void, t: typeof translations['en'] }> = ({ onContinue, t }) => (
  <div className="h-screen w-full flex flex-col items-center justify-center bg-white animate-fade-in">
    <div className="relative mb-8">
      <div className="flex gap-4">
        <div className="w-16 h-16 border-4 border-slate-900 rounded-full bg-white flex items-center justify-center">
          <div className="w-6 h-6 bg-slate-900 rounded-full translate-x-2"></div>
        </div>
        <div className="w-16 h-16 flex items-center justify-center">
          <div className="w-full h-2 bg-slate-900 rounded-full rotate-6 mt-4"></div>
        </div>
      </div>
    </div>

    <h1 className="text-4xl font-bold text-slate-900 mb-4">{t.success.title}</h1>
    <p className="text-slate-500 mb-10 text-lg">{t.success.subtitle}</p>

    <button
      onClick={onContinue}
      className="px-8 py-4 bg-[#BFA7F5] text-white text-lg font-bold rounded-xl shadow-lg hover:bg-[#a68bf0] hover:scale-105 transition-all flex items-center gap-2"
    >
      {t.success.button}
      <span className="material-icons">arrow_forward</span>
    </button>
  </div>
);

const TranscriptScreen: React.FC<{
  data: ProjectState['data'],
  projectName: string,
  files?: ProjectFile[],
  onUpdateTag: (id: string, label: string) => void,
  onAddHighlight: (fileId: string, text: string, tagId: string, tagName?: string, tagColor?: string) => void,
  onAddAffinity: (text: string) => void,
  t: typeof translations['en']
}> = ({ data, projectName, files, onUpdateTag, onAddHighlight, onAddAffinity, t }) => {
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const [selectionMenu, setSelectionMenu] = useState<{ x: number, y: number, text: string, fileId: string } | null>(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const [fileFilters, setFileFilters] = useState<Record<string, {
    speaker: string,
    tagLabel: string,
    search: string,
    showSpeakerMenu: boolean,
    showTagMenu: boolean
  }>>({});

  useEffect(() => {
    if (files && files.length > 0 && Object.keys(expandedState).length === 0) {
      setExpandedState({ [files[0].id]: true });
    }
  }, [files]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectionMenu && !(event.target as HTMLElement).closest('.selection-menu')) {
        setSelectionMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectionMenu]);

  const toggleFile = (fileId: string) => {
    setExpandedState(prev => ({
      ...prev,
      [fileId]: !prev[fileId]
    }));
  };

  const getFilter = (fileId: string) => fileFilters[fileId] || {
    speaker: 'All',
    tagLabel: 'All',
    search: '',
    showSpeakerMenu: false,
    showTagMenu: false
  };

  const updateFilter = (fileId: string, updates: Partial<typeof fileFilters[string]>) => {
    setFileFilters(prev => ({
      ...prev,
      [fileId]: { ...getFilter(fileId), ...updates }
    }));
  };

  // Map of Tag ID -> Tag Object
  const allTagsMap = React.useMemo(() => {
    const map = new Map<string, Tag>();
    if (data?.tags) data.tags.forEach(t => map.set(t.id, t));
    files?.forEach(f => {
      f.analysisData?.tags.forEach(tag => map.set(tag.id, tag));
    });
    return map;
  }, [files, data]);

  // Map of Label -> Color
  const tagColors = React.useMemo(() => {
    const map = new Map<string, string>();
    const processTags = (tags: Tag[] | undefined) => {
      if (!tags) return;
      tags.forEach(t => {
        if (!map.has(t.label)) map.set(t.label, t.color);
      });
    };
    processTags(data?.tags);
    files?.forEach(f => processTags(f.analysisData?.tags));
    return map;
  }, [files, data]);

  const sidebarTags = React.useMemo(() => {
    const tags = Array.from(allTagsMap.values());
    const seenLabels = new Set<string>();
    const unique: Tag[] = [];
    tags.forEach((t: Tag) => {
      if (!seenLabels.has(t.label)) {
        seenLabels.add(t.label);
        unique.push(t);
      }
    });
    return unique;
  }, [allTagsMap]);

  const aggregatedHighlights = React.useMemo(() => {
    if (!files || files.length === 0) return data?.highlights || [];
    return files.flatMap(f => f.analysisData?.highlights || []);
  }, [files, data]);

  const [activeFilterLabel, setActiveFilterLabel] = useState<string | null>(null);

  const isHighlightVisible = (highlight: Highlight) => {
    if (!activeFilterLabel) return true;
    const tag = allTagsMap.get(highlight.tagId);
    return tag?.label === activeFilterLabel;
  };

  const getFilteredHighlights = () => {
    return aggregatedHighlights.filter(isHighlightVisible);
  };

  const handleTextSelection = (e: React.MouseEvent, fileId: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (text.length > 2) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setSelectionMenu({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        text: text,
        fileId: fileId
      });
    } else {
      setSelectionMenu(null);
    }
  };

  const handleAddHighlightClick = () => {
    setShowTagModal(true);
  };

  const handleConfirmAddHighlight = () => {
    if (selectionMenu && (selectedTagId || newTagLabel)) {
      if (selectedTagId) {
        onAddHighlight(selectionMenu.fileId, selectionMenu.text, selectedTagId);
      } else if (newTagLabel) {
        onAddHighlight(selectionMenu.fileId, selectionMenu.text, 'NEW', newTagLabel, getRandomPastelColor());
      }
      setSelectionMenu(null);
      setShowTagModal(false);
      setNewTagLabel("");
      setSelectedTagId(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleAddToAffinity = () => {
    if (selectionMenu) {
      onAddAffinity(selectionMenu.text);
      setSelectionMenu(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const renderTextWithHighlights = (text: string, fileData: ResearchData | undefined) => {
    if (!fileData) return <span>{text}</span>;

    const fileHighlights = fileData.highlights.filter(h => isHighlightVisible(h));
    const sortedHighlights = [...fileHighlights].sort((a, b) => b.text.length - a.text.length);

    if (sortedHighlights.length === 0) return <span>{text}</span>;

    const patternParts = sortedHighlights.map(h => {
      const cleanText = h.text.trim().replace(/[.,;!?]+$/, '');
      const escaped = escapeRegExp(cleanText);
      return escaped.replace(/\s+/g, '[\\s\\r\\n]+');
    });

    if (patternParts.length === 0) return <span>{text}</span>;

    const pattern = `(${patternParts.join('|')})`;

    let parts: string[];
    try {
      const regex = new RegExp(pattern, 'gi');
      parts = text.split(regex);
    } catch (e) {
      return <span>{text}</span>;
    }

    return (
      <>
        {parts.map((part, i) => {
          const normalize = (s: string) => s.trim().replace(/[.,;!?]+$/, '').replace(/\s+/g, ' ').toLowerCase();
          const normalizedPart = normalize(part);

          if (!normalizedPart) return <span key={i}>{part}</span>;

          const matchedHighlight = sortedHighlights.find(h => {
            return normalize(h.text) === normalizedPart;
          });

          if (matchedHighlight) {
            const tag = allTagsMap.get(matchedHighlight.tagId);
            const color = (tag ? tagColors.get(tag.label) : null) || tag?.color || '#FFD977';

            return (
              <span
                key={i}
                style={{ backgroundColor: color }}
                className="px-0.5 rounded box-decoration-clone text-slate-900 font-medium cursor-pointer transition-colors hover:opacity-80 border-b border-black/10"
                title={tag?.label}
                onClick={() => tag && setActiveFilterLabel(tag.label)}
              >
                {part}
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </>
    );
  };

  return (
    <div className="max-w-screen-2xl mx-auto h-full flex flex-col gap-6 relative">
      {/* Selection Popover Menu */}
      {selectionMenu && (
        <div
          className="fixed z-50 bg-slate-900 text-white rounded-lg shadow-xl flex flex-col py-1 selection-menu transform -translate-x-1/2 -translate-y-full"
          style={{ left: selectionMenu.x, top: selectionMenu.y }}
        >
          {!showTagModal ? (
            <div className="flex">
              <button
                onClick={handleAddHighlightClick}
                className="px-3 py-2 text-xs font-medium hover:bg-white/10 flex items-center gap-1 border-r border-white/10"
              >
                <span className="material-icons text-sm text-[#BFA7F5]">brush</span>
                Highlight
              </button>
              <button
                onClick={handleAddToAffinity}
                className="px-3 py-2 text-xs font-medium hover:bg-white/10 flex items-center gap-1"
              >
                <span className="material-icons text-sm text-[#FFD977]">sticky_note_2</span>
                Affinity
              </button>
            </div>
          ) : (
            <div className="p-3 w-64">
              <h4 className="text-xs font-bold text-slate-300 mb-2 uppercase tracking-wide">Select Tag</h4>
              <div className="max-h-40 overflow-y-auto custom-scrollbar mb-2 space-y-1">
                {sidebarTags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedTagId(tag.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 ${selectedTagId === tag.id ? 'bg-white/20' : 'hover:bg-white/5'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }}></span>
                    {tag.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-white/10 pt-2 mt-1">
                <input
                  type="text"
                  placeholder="Or create new tag..."
                  value={newTagLabel}
                  onChange={(e) => { setNewTagLabel(e.target.value); setSelectedTagId(null); }}
                  className="w-full bg-white/10 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[#BFA7F5] mb-2"
                />
                <button
                  onClick={handleConfirmAddHighlight}
                  disabled={!selectedTagId && !newTagLabel}
                  className="w-full bg-[#BFA7F5] text-slate-900 py-1.5 rounded text-xs font-bold hover:bg-[#a68bf0] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Highlight
                </button>
              </div>
            </div>
          )}

          <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-900"></div>
        </div>
      )}

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{projectName}</h1>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
            Last updated just now • {files?.length || 0} files
          </p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
            Export to PDF
          </button>
        </div>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
          {/* FILE LIST & CONTENT */}
          {files && files.map(file => {
            const isExpanded = expandedState[file.id];
            const displayData = file.analysisData;
            const mediaUrl = URL.createObjectURL(file.file);
            const filter = getFilter(file.id);

            return (
              <div key={file.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <button
                  onClick={() => toggleFile(file.id)}
                  className={`w-full flex items-center justify-between p-4 transition-colors ${isExpanded ? 'bg-slate-50 border-b border-slate-100' : 'bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-icons text-slate-500">
                      {file.type === 'video' ? 'videocam' : file.type === 'audio' ? 'graphic_eq' : 'description'}
                    </span>
                    <div className="text-left">
                      <h3 className="font-semibold text-slate-900 text-sm">{file.file.name}</h3>
                      <div className="text-xs text-slate-500 flex items-center gap-2">
                        <span>{formatFileSize(file.file.size)}</span>
                        {file.status === 'processing' && <span className="text-amber-500">• Processing...</span>}
                        {file.status === 'uploaded' && <span className="text-green-600">• Indexed</span>}
                      </div>
                    </div>
                  </div>
                  <span className={`material-icons text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>

                {isExpanded && (
                  <div className="p-4 md:p-6 animate-fade-in">
                    <div className="bg-black aspect-video rounded-lg overflow-hidden flex items-center justify-center relative group mb-6">
                      {mediaUrl ? (
                        file.type === 'video' ? (
                          <video src={mediaUrl} controls className="w-full h-full object-contain" />
                        ) : (
                          <audio src={mediaUrl} controls className="w-full px-10" />
                        )
                      ) : (
                        <div className="text-slate-500 flex flex-col items-center">
                          <span className="material-icons text-4xl mb-2 opacity-50">play_circle_outline</span>
                          <span className="text-sm">No preview available</span>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-center justify-between mb-4 relative z-10">
                      <div className="flex gap-2 relative">
                        {/* Filter controls... */}
                        <div className="relative">
                          <button
                            onClick={() => updateFilter(file.id, { showSpeakerMenu: !filter.showSpeakerMenu, showTagMenu: false })}
                            className={`px-3 py-1.5 bg-white border ${filter.speaker !== 'All' ? 'border-[#BFA7F5] text-[#8B5CF6]' : 'border-slate-200 text-slate-700'} rounded-md text-xs font-medium flex items-center gap-1 hover:bg-slate-50`}
                          >
                            Speakers: {filter.speaker}
                            <span className="material-icons text-[14px]">expand_more</span>
                          </button>
                          {filter.showSpeakerMenu && (
                            <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-200 shadow-lg rounded-lg z-20 py-1">
                              {['All', 'Interviewer', 'Participant'].map(s => (
                                <button
                                  key={s}
                                  onClick={() => updateFilter(file.id, { speaker: s, showSpeakerMenu: false })}
                                  className="block w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="relative">
                          <button
                            onClick={() => updateFilter(file.id, { showTagMenu: !filter.showTagMenu, showSpeakerMenu: false })}
                            className={`px-3 py-1.5 bg-white border ${filter.tagLabel !== 'All' ? 'border-[#BFA7F5] text-[#8B5CF6]' : 'border-slate-200 text-slate-700'} rounded-md text-xs font-medium flex items-center gap-1 hover:bg-slate-50`}
                          >
                            {filter.tagLabel === 'All' ? 'Tags: All' : filter.tagLabel}
                            <span className="material-icons text-[14px]">expand_more</span>
                          </button>
                          {filter.showTagMenu && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 shadow-lg rounded-lg z-20 py-1 max-h-60 overflow-y-auto">
                              <button
                                onClick={() => updateFilter(file.id, { tagLabel: 'All', showTagMenu: false })}
                                className="block w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 font-medium"
                              >
                                All Tags
                              </button>
                              <div className="border-t border-slate-100 my-1"></div>
                              {sidebarTags.map(tag => (
                                <button
                                  key={tag.label}
                                  onClick={() => updateFilter(file.id, { tagLabel: tag.label, showTagMenu: false })}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tagColors.get(tag.label) || tag.color }}></span>
                                  {tag.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="relative">
                        <span className="material-icons absolute left-2 top-1.5 text-slate-400 text-sm">search</span>
                        <input
                          type="text"
                          value={filter.search}
                          onChange={(e) => updateFilter(file.id, { search: e.target.value })}
                          placeholder="Search in transcript"
                          className="pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-700 w-48 focus:outline-none focus:border-[#BFA7F5] transition-colors"
                        />
                        {filter.search && (
                          <button
                            onClick={() => updateFilter(file.id, { search: '' })}
                            className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600"
                          >
                            <span className="material-icons text-[14px]">close</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6" onMouseUp={(e) => handleTextSelection(e, file.id)}>
                      {file.status === 'processing' ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                          <div className="w-8 h-8 border-2 border-[#BFA7F5] border-t-transparent rounded-full animate-spin mb-3"></div>
                          <p className="text-sm">Transcribing {file.file.name}...</p>
                        </div>
                      ) : displayData?.transcript ? (
                        displayData.transcript.split('\n').map((para, i) => {
                          const trimmed = para.trim();
                          if (!trimmed) return null;

                          const isQuestion = trimmed.startsWith("Question:") || trimmed.startsWith("Interviewer:") || trimmed.startsWith("I:");
                          const isAnswer = trimmed.startsWith("Answer:") || trimmed.startsWith("Client:") || trimmed.startsWith("C:") || trimmed.startsWith("Participant:") || trimmed.startsWith("P:");

                          let content = trimmed;
                          let speaker = isQuestion ? "Interviewer" : isAnswer ? "Participant" : "Speaker";
                          let timestamp = "00:00";

                          if (isQuestion || isAnswer) {
                            const colonIdx = trimmed.indexOf(':');
                            if (colonIdx !== -1) {
                              content = trimmed.substring(colonIdx + 1).trim();
                            }
                          }

                          const mins = Math.floor(i * 1.5);
                          const secs = (i * 15) % 60;
                          timestamp = `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;

                          if (filter.speaker !== 'All' && speaker !== filter.speaker) return null;
                          if (filter.search && !content.toLowerCase().includes(filter.search.toLowerCase())) return null;

                          // Highlight filtering logic...
                          if (filter.tagLabel !== 'All' || activeFilterLabel) {
                            const currentFilterLabel = filter.tagLabel !== 'All' ? filter.tagLabel : activeFilterLabel;
                            const fileHighlights = displayData.highlights || [];
                            const relevantHighlights = fileHighlights.filter(h => {
                              const t = allTagsMap.get(h.tagId);
                              return t?.label === currentFilterLabel;
                            });
                            const normalize = (s: string) => s.trim().toLowerCase();
                            const hasRelevantHighlight = relevantHighlights.some(h =>
                              normalize(content).includes(normalize(h.text))
                            );
                            if (!hasRelevantHighlight) return null;
                          }

                          return (
                            <div key={i} className="flex gap-4 group/para">
                              <div className={`w-1 rounded-full flex-shrink-0 ${isQuestion ? 'bg-[#8B5CF6]' : 'bg-[#60A5FA]'}`}></div>
                              <div className="flex-1">
                                <div className="flex items-baseline gap-3 mb-1">
                                  <span className="text-sm font-semibold text-slate-700">{speaker}</span>
                                  <span className="text-xs text-slate-400 font-mono">{timestamp}</span>
                                </div>
                                <p className="text-slate-600 leading-relaxed text-sm selection:bg-purple-100 selection:text-purple-900">
                                  {renderTextWithHighlights(content, displayData)}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-slate-400 text-sm text-center italic py-4">No transcript available for this file.</p>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="w-80 flex flex-col gap-6 h-full overflow-hidden flex-shrink-0 sticky top-0">
          {/* TAGS & HIGHLIGHTS SIDEBAR */}
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex-shrink-0">
            <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              <span className="material-icons text-base text-slate-400">local_offer</span> {t.transcript.tags}
            </h3>
            {files && files.some(f => f.status === 'processing') && sidebarTags.length === 0 ? (
              <div className="text-xs text-slate-400 italic">Generating tags...</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sidebarTags.map(tag => {
                  const color = tagColors.get(tag.label) || tag.color;
                  return (
                    <button
                      key={tag.label}
                      onClick={() => setActiveFilterLabel(activeFilterLabel === tag.label ? null : tag.label)}
                      style={{ backgroundColor: color }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-slate-900 transition-all border border-transparent shadow-sm ${activeFilterLabel === tag.label ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:opacity-90'
                        }`}
                    >
                      {tag.label}
                    </button>
                  );
                })}
                {sidebarTags.length === 0 && <span className="text-xs text-slate-400 italic">No tags found</span>}
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span className="material-icons text-base text-[#FFD977]">format_quote</span> {t.transcript.highlights}
              </h3>
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setActiveFilterLabel(null)}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-all ${!activeFilterLabel ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  ALL
                </button>
                <button
                  onClick={() => setActiveFilterLabel(null)}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-all ${activeFilterLabel ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  disabled={!activeFilterLabel}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="overflow-y-auto space-y-3 pr-1 custom-scrollbar flex-1">
              {files && files.some(f => f.status === 'processing') && getFilteredHighlights().length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-slate-400 italic">Analyzing highlights...</p>
                </div>
              ) : getFilteredHighlights().length > 0 ? (
                getFilteredHighlights().map(highlight => {
                  const tag = allTagsMap.get(highlight.tagId);
                  const color = (tag ? tagColors.get(tag.label) : null) || tag?.color || '#E2E8F0';
                  return (
                    <div key={highlight.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 hover:shadow-sm transition-shadow">
                      <p className="text-xs text-slate-600 leading-snug mb-2 font-medium">"{highlight.text}"</p>
                      {tag && (
                        <span
                          style={{ backgroundColor: color }}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-slate-800 cursor-pointer"
                          onClick={() => setActiveFilterLabel(tag.label)}
                        >
                          {tag.label}
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8">
                  <p className="text-xs text-slate-400 italic">{t.transcript.noHighlights}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AffinityScreen: React.FC<{
  data: ResearchData,
  projectName: string,
  files?: ProjectFile[],
  onUpdateClusters: (clusters: Cluster[]) => void,
  t: typeof translations['en']
}> = ({ data, projectName, files, onUpdateClusters, t }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const [draggedItem, setDraggedItem] = useState<{ clusterId: string, itemId: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (data.clusters) {
      const initialized = data.clusters.map((c, i) => ({
        ...c,
        items: c.items || [],
        x: c.x ?? (50 + (i % 3) * 340),
        y: c.y ?? (50 + Math.floor(i / 3) * 340),
        width: c.width ?? 300,
        height: c.height ?? 340
      }));
      setClusters(initialized);
    }
  }, [data.clusters]);

  const [dragState, setDragState] = useState<{
    id: string,
    mode: 'drag' | 'resize',
    startX: number,
    startY: number,
    initialX: number,
    initialY: number,
    initialW: number,
    initialH: number
  } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      if (!dragState) return;
      e.preventDefault();

      const dx = (e.clientX - dragState.startX) / scale;
      const dy = (e.clientY - dragState.startY) / scale;

      setClusters(prev => prev.map(c => {
        if (c.id !== dragState.id) return c;
        if (dragState.mode === 'drag') {
          return { ...c, x: dragState.initialX + dx, y: dragState.initialY + dy };
        } else {
          return { ...c, width: Math.max(250, dragState.initialW + dx), height: Math.max(200, dragState.initialH + dy) };
        }
      }));
    };

    const handleMouseUp = () => {
      if (isPanning) {
        setIsPanning(false);
      }
      if (dragState) {
        const modified = clusters.find(c => c.id === dragState.id);
        if (modified) {
          onUpdateClusters(clusters);
        }
        setDragState(null);
      }
    };

    if (dragState || isPanning) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, isPanning, panStart, clusters, onUpdateClusters, scale]);

  const handleDragStart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const c = clusters.find(cl => cl.id === id);
    if (!c) return;
    setActiveId(id);
    setDragState({
      id,
      mode: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      initialX: c.x || 0,
      initialY: c.y || 0,
      initialW: c.width || 300,
      initialH: c.height || 340
    });
  };

  const handleResizeStart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const c = clusters.find(cl => cl.id === id);
    if (!c) return;
    setDragState({
      id,
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      initialX: c.x || 0,
      initialY: c.y || 0,
      initialW: c.width || 300,
      initialH: c.height || 340
    });
  };

  const handlePanStart = (e: React.MouseEvent) => {
    if (e.target === viewportRef.current || (e.target as HTMLElement).classList.contains('canvas-bg')) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      // e.preventDefault(); 
    }
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    const newScale = Math.min(Math.max(0.1, scale + delta), 4);
    setScale(newScale);
  };

  const zoomIn = () => setScale(s => Math.min(s + 0.2, 4));
  const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.1));
  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  const handleAddNote = (clusterId: string) => {
    const newItem: AffinityItem = {
      id: Math.random().toString(36).substr(2, 9),
      text: "New insight...",
      type: 'note'
    };
    const newClusters = clusters.map(c =>
      c.id === clusterId ? { ...c, items: [...c.items, newItem] } : c
    );
    setClusters(newClusters);
    onUpdateClusters(newClusters);
  };

  const handleCreateCluster = () => {
    const centerX = -offset.x / scale + 100;
    const centerY = -offset.y / scale + 100;

    const newCluster: Cluster = {
      id: Math.random().toString(36).substr(2, 9),
      title: "New Cluster",
      items: [],
      color: getRandomPastelColor(),
      x: centerX,
      y: centerY,
      width: 300,
      height: 340
    };
    const newClusters = [...clusters, newCluster];
    setClusters(newClusters);
    onUpdateClusters(newClusters);
  };

  const handleAutoLayout = () => {
    const PADDING = 40;
    const START_X = 50;
    const START_Y = 50;
    const MAX_ROW_WIDTH = 1600;

    let currentX = START_X;
    let currentY = START_Y;
    let currentRowHeight = 0;

    const newClusters = clusters.map((cluster) => {
      const width = cluster.width || 300;
      const height = cluster.height || 340;

      if (currentX + width > MAX_ROW_WIDTH && currentX > START_X) {
        currentX = START_X;
        currentY += currentRowHeight + PADDING;
        currentRowHeight = 0;
      }

      const newPos = { x: currentX, y: currentY };
      currentX += width + PADDING;
      currentRowHeight = Math.max(currentRowHeight, height);

      return { ...cluster, ...newPos };
    });

    setClusters(newClusters);
    onUpdateClusters(newClusters);
  };

  const handleUpdateNote = (clusterId: string, itemId: string, text: string) => {
    const newClusters = clusters.map(c =>
      c.id === clusterId ? {
        ...c,
        items: c.items.map(item => item.id === itemId ? { ...item, text } : item)
      } : c
    );
    setClusters(newClusters);
  };

  const handleNoteBlur = () => {
    onUpdateClusters(clusters);
  };

  const handleDeleteNote = (clusterId: string, itemId: string) => {
    const newClusters = clusters.map(c =>
      c.id === clusterId ? { ...c, items: c.items.filter(item => item.id !== itemId) } : c
    );
    setClusters(newClusters);
    onUpdateClusters(newClusters);
  };

  const handleDeleteCluster = (clusterId: string) => {
    setDeleteConfirmation({ id: clusterId });
  };

  const confirmDeleteCluster = () => {
    if (deleteConfirmation) {
      const newClusters = clusters.filter(c => c.id !== deleteConfirmation.id);
      setClusters(newClusters);
      onUpdateClusters(newClusters);
      setDeleteConfirmation(null);
    }
  };

  const handleUpdateTitle = (clusterId: string, title: string) => {
    setClusters(prev => prev.map(c => c.id === clusterId ? { ...c, title } : c));
  };

  const handleTitleBlur = () => {
    onUpdateClusters(clusters);
  };

  const handleItemDragStart = (e: React.DragEvent, clusterId: string, itemId: string) => {
    e.stopPropagation();
    setDraggedItem({ clusterId, itemId });
    e.dataTransfer.effectAllowed = 'move';
    if (e.currentTarget.parentElement) {
      e.dataTransfer.setDragImage(e.currentTarget.parentElement, 10, 10);
    }
  };

  const handleItemDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleItemDrop = (e: React.DragEvent, targetClusterId: string, targetItemId?: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem) return;

    const newClusters = [...clusters];
    const sourceClusterIdx = newClusters.findIndex(c => c.id === draggedItem.clusterId);
    const targetClusterIdx = newClusters.findIndex(c => c.id === targetClusterId);

    if (sourceClusterIdx === -1 || targetClusterIdx === -1) return;

    const sourceCluster = { ...newClusters[sourceClusterIdx], items: [...newClusters[sourceClusterIdx].items] };
    const targetCluster = sourceClusterIdx === targetClusterIdx
      ? sourceCluster
      : { ...newClusters[targetClusterIdx], items: [...newClusters[targetClusterIdx].items] };

    const itemIdx = sourceCluster.items.findIndex(i => i.id === draggedItem.itemId);
    if (itemIdx === -1) return;

    const [item] = sourceCluster.items.splice(itemIdx, 1);

    if (targetItemId) {
      if (targetItemId === draggedItem.itemId) {
        setDraggedItem(null);
        return;
      }
      const targetIdx = targetCluster.items.findIndex(i => i.id === targetItemId);
      if (targetIdx !== -1) {
        targetCluster.items.splice(targetIdx, 0, item);
      } else {
        targetCluster.items.push(item);
      }
    } else {
      targetCluster.items.push(item);
    }

    newClusters[sourceClusterIdx] = sourceCluster;
    if (sourceClusterIdx !== targetClusterIdx) {
      newClusters[targetClusterIdx] = targetCluster;
    }

    setClusters(newClusters);
    onUpdateClusters(newClusters);
    setDraggedItem(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header... same as previous */}
      <div className="flex justify-between items-start mb-4 flex-shrink-0 px-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{projectName}</h1>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
            Last updated just now • {files?.length || 0} files
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateCluster}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 flex items-center gap-2 shadow-sm"
          >
            <span className="material-icons text-sm">add_circle</span>
            Add Cluster
          </button>
          <button
            onClick={handleAutoLayout}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 shadow-sm"
            title="Auto Arrange"
          >
            <span className="material-icons text-sm">dashboard_customize</span>
            Auto Layout
          </button>
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
            Export to PDF
          </button>
        </div>
      </div>
      {
        clusters.length === 0 && !isGenerating && data.highlights && data.highlights.length > 0 && (
          <div className="flex-1 flex flex-col items-center justify-center p-10 bg-slate-50 border border-slate-200 rounded-xl m-4">
            <span className="material-icons text-6xl text-slate-300 mb-4">dashboard</span>
            <h3 className="text-xl font-bold text-slate-700 mb-2">Ready to Map</h3>
            <p className="text-slate-500 mb-6 text-center max-w-md">
              We have {data.highlights.length} highlights ready to be clustered.
              Click below to generate the affinity map.
            </p>
            <button
              onClick={async () => {
                setIsGenerating(true);
                try {
                  // Default to Ukrainian if not detectable, but really we should pass language from App level
                  // For now assuming 'uk' as per defaults, or could pass in props.
                  const newClusters = await generateAffinityMap(data.highlights, "uk");
                  setClusters(newClusters);
                  onUpdateClusters(newClusters);
                } catch (e) {
                  alert("Failed to generate map. Please try again.");
                  console.error(e);
                } finally {
                  setIsGenerating(false);
                }
              }}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold shadow-md hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <span className="material-icons">auto_awesome</span>
              Generate Affinity Map
            </button>
          </div>
        )
      }

      {
        isGenerating && (
          <div className="flex-1 flex flex-col items-center justify-center p-10 bg-slate-50 border border-slate-200 rounded-xl m-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-slate-600 font-medium">Clustering insights with AI...</p>
          </div>
        )
      }

      {
        clusters.length > 0 && (
          <div
            className="flex-1 min-h-0 relative bg-slate-100 overflow-hidden cursor-grab active:cursor-grabbing canvas-bg rounded-xl border border-slate-200"
            ref={viewportRef}
            onMouseDown={handlePanStart}
            onWheel={handleWheel}
          >
            <div
              className="absolute origin-top-left will-change-transform"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
              }}
            >
              <div
                className="absolute -inset-[10000px] opacity-20 pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }}
              ></div>

              {clusters.map(cluster => (
                <div
                  key={cluster.id}
                  className={`absolute flex flex-col rounded-xl shadow-sm border border-slate-200 transition-shadow overflow-hidden ${activeId === cluster.id ? 'shadow-2xl ring-2 ring-blue-400 z-10' : 'hover:shadow-md'
                    }`}
                  style={{
                    left: cluster.x,
                    top: cluster.y,
                    width: cluster.width,
                    height: cluster.height,
                    backgroundColor: cluster.color ? `${cluster.color}15` : '#F8FAFC'
                  }}
                  onMouseDown={(e) => { e.stopPropagation(); setActiveId(cluster.id); }}
                >
                  <div
                    className="h-12 px-4 flex items-center gap-2 cursor-move border-b border-slate-100/50 bg-white/50 backdrop-blur-sm"
                    onMouseDown={(e) => handleDragStart(e, cluster.id)}
                  >
                    <div className="w-3 h-3 rounded-full flex-shrink-0 border border-black/5" style={{ backgroundColor: cluster.color }}></div>

                    <input
                      id={`cluster-title-${cluster.id}`}
                      className="bg-transparent font-bold text-slate-800 text-sm focus:outline-none flex-1 min-w-0 py-1"
                      value={cluster.title}
                      onChange={(e) => handleUpdateTitle(cluster.id, e.target.value)}
                      onBlur={handleTitleBlur}
                      onMouseDown={(e) => e.stopPropagation()}
                    />

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        document.getElementById(`cluster-title-${cluster.id}`)?.focus();
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-800 hover:bg-black/5 transition-colors"
                      title="Rename Cluster"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="material-icons text-[14px]">edit</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCluster(cluster.id);
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors ml-1"
                      title="Delete Cluster"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="material-icons text-[14px]">delete</span>
                    </button>
                  </div>

                  <div
                    className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar"
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragOver={handleItemDragOver}
                    onDrop={(e) => handleItemDrop(e, cluster.id)}
                  >
                    {(cluster.items || []).map((item) => (
                      <div
                        key={item.id}
                        className={`group relative bg-white rounded-lg p-2 shadow-sm border border-slate-100 hover:shadow-md transition-all ${draggedItem?.itemId === item.id ? 'opacity-40' : ''}`}
                        onDragOver={handleItemDragOver}
                        onDrop={(e) => handleItemDrop(e, cluster.id, item.id)}
                      >
                        <div
                          className="absolute top-2 left-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          draggable
                          onDragStart={(e) => handleItemDragStart(e, cluster.id, item.id)}
                        >
                          <span className="material-icons text-[14px]">drag_indicator</span>
                        </div>

                        <textarea
                          className="w-full text-xs text-slate-600 bg-transparent focus:outline-none resize-none overflow-hidden pl-5"
                          value={item.text}
                          onChange={(e) => handleUpdateNote(cluster.id, item.id, e.target.value)}
                          onBlur={handleNoteBlur}
                          rows={Math.max(2, Math.ceil(item.text.length / 30))}
                        />
                        {item.highlightIds && item.highlightIds.length > 0 && (
                          <div className="absolute bottom-1 right-2 text-[9px] text-slate-300 font-mono">
                            {item.highlightIds.length} quotes
                          </div>
                        )}
                        <button
                          onClick={() => handleDeleteNote(cluster.id, item.id)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-100 text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm transition-all hover:bg-red-200"
                          title="Delete note"
                        >
                          <span className="material-icons text-[12px]">close</span>
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={() => handleAddNote(cluster.id)}
                      className="w-full py-2 flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-white/50 rounded-lg border border-dashed border-slate-300 transition-colors mt-2"
                    >
                      <span className="material-icons text-[14px]">add</span>
                      Add Note
                    </button>
                  </div>

                  <div
                    className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-center justify-center text-slate-300 hover:text-slate-500"
                    onMouseDown={(e) => handleResizeStart(e, cluster.id)}
                  >
                    <span className="material-icons text-[14px] rotate-45">filter_list</span>
                  </div>
                </div>
              ))}
            </div>


            <div className="absolute bottom-6 right-6 flex flex-col gap-2 bg-white rounded-lg shadow-lg border border-slate-100 p-1 z-20">
              <button
                onClick={zoomIn}
                className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded transition-colors"
                title="Zoom In"
              >
                <span className="material-icons text-lg">add</span>
              </button>
              <button
                onClick={zoomOut}
                className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded transition-colors"
                title="Zoom Out"
              >
                <span className="material-icons text-lg">remove</span>
              </button>
              <div className="h-px bg-slate-200 my-0.5"></div>
              <button
                onClick={resetView}
                className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded transition-colors"
                title="Reset View"
              >
                <span className="material-icons text-lg">center_focus_strong</span>
              </button>
            </div>

            <div className="absolute bottom-6 left-6 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-xs font-mono text-slate-500 border border-slate-200 pointer-events-none">
              {Math.round(scale * 100)}%
            </div>
          </div>
        )}

      <ConfirmDialog
        isOpen={!!deleteConfirmation}
        title="Delete Cluster"
        message="Are you sure you want to delete this cluster and all its contents? This action cannot be undone."
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={confirmDeleteCluster}
        onCancel={() => setDeleteConfirmation(null)}
      />
    </div>
  );
};

// --- NEW INSIGHTS SCREEN ---
const InsightsScreen: React.FC<{ data: ResearchData, projectName: string, t: typeof translations['en'] }> = ({ data, projectName, t }) => {
  const { insights } = data;

  // Data fallbacks
  // Data fallbacks - ensuring insights exists first
  const safeInsights = insights || {};
  const painPoints = (safeInsights.keyPainPoints && safeInsights.keyPainPoints.length > 0) ? safeInsights.keyPainPoints : (safeInsights.painPoints || []);
  const opportunities = (safeInsights.keyOpportunities && safeInsights.keyOpportunities.length > 0) ? safeInsights.keyOpportunities : (safeInsights.opportunities || []);
  const patterns = safeInsights.patterns || [];
  const sentiment = safeInsights.sentiment || { label: 'Neutral', score: 0 }; // Default sentiment
  const wordCloud = safeInsights.wordCloud || [];
  const problemPatterns = safeInsights.problemPatternsChart || [];
  const insightsTable = safeInsights.insightsTable || [];

  // Prepare sentiment data for chart
  const sentimentData = (sentiment.distribution && sentiment.distribution.length > 0) ? sentiment.distribution : [
    { name: 'Positive', value: 0 },
    { name: 'Neutral', value: 0 },
    { name: 'Negative', value: 0 }
  ];

  const COLORS: Record<string, string> = {
    Positive: '#86EFAC', // Green
    Neutral: '#CBD5E1',  // Gray
    Negative: '#FCA5A5', // Red
    Mixed: '#FDBA74'     // Orange
  };

  return (
    <div className="max-w-screen-2xl mx-auto space-y-8 pb-10">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t.insights.title}</h1>
          <p className="text-base text-slate-500 mt-1">{t.insights.subtitle}</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2">
          <span className="text-sm font-medium text-slate-500">{t.insights.sentiment}:</span>
          <span className="text-sm font-bold text-slate-900">{sentiment.label} ({sentiment.score}%)</span>
        </div>
      </div>

      {/* Top Row: Sentiment, Pain Points, Opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Sentiment Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[320px]">
          <h3 className="text-base font-bold text-slate-800 mb-6 self-start">{t.insights.distribution}</h3>
          <div className="relative w-48 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sentimentData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {sentimentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS] || '#CBD5E1'} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-6">
            {['Positive', 'Neutral', 'Negative'].map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[type as keyof typeof COLORS] }}></div>
                <span className="text-xs font-medium text-slate-600">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pain Points Card */}
        <div className="bg-rose-50/50 p-6 rounded-2xl border border-rose-100 flex flex-col min-h-[320px]">
          <h3 className="text-base font-bold text-rose-900 mb-4 flex items-center gap-2">
            <div className="p-1.5 bg-rose-100 rounded text-rose-600">
              <span className="material-icons text-lg">warning</span>
            </div>
            {t.insights.painPoints}
          </h3>
          <ul className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {painPoints.length > 0 ? painPoints.map((point, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-2 flex-shrink-0"></span>
                {point}
              </li>
            )) : (
              <p className="text-sm text-slate-400 italic">No pain points identified.</p>
            )}
          </ul>
        </div>

        {/* Opportunities Card */}
        <div className="bg-green-50/50 p-6 rounded-2xl border border-green-100 flex flex-col min-h-[320px]">
          <h3 className="text-base font-bold text-green-900 mb-4 flex items-center gap-2">
            <div className="p-1.5 bg-green-100 rounded text-green-600">
              <span className="material-icons text-lg">stars</span>
            </div>
            {t.insights.opportunities}
          </h3>
          <ul className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {opportunities.length > 0 ? opportunities.map((opp, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2 flex-shrink-0"></span>
                {opp}
              </li>
            )) : (
              <p className="text-sm text-slate-400 italic">No opportunities identified.</p>
            )}
          </ul>
        </div>

      </div>

      {/* Behavioral Patterns */}
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-6">{t.insights.patterns}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {patterns.length > 0 ? patterns.map((pattern, i) => (
            <div key={i} className="bg-slate-50 rounded-xl p-5 flex gap-4 border border-slate-100">
              <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 font-bold flex items-center justify-center flex-shrink-0">
                {i + 1}
              </div>
              <p className="text-sm text-slate-700 font-medium leading-relaxed">
                {pattern}
              </p>
            </div>
          )) : (
            <p className="text-slate-400 italic">No patterns detected.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Word Cloud */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="material-icons text-slate-400">psychology</span>
            Emotional Word Cloud
          </h3>
          <div className="flex-1 flex flex-wrap content-center items-center justify-center gap-3 p-4 overflow-hidden">
            {wordCloud.length > 0 ? wordCloud.map((item, idx) => {
              const size = Math.min(2.5, 0.8 + (item.count * 0.15));
              const opacity = Math.min(1, 0.4 + (item.count * 0.1));
              return (
                <span
                  key={idx}
                  style={{ fontSize: `${size}rem`, opacity }}
                  className="font-bold text-indigo-600 transition-all hover:scale-110 cursor-default"
                >
                  {item.word}
                </span>
              )
            }) : (
              <p className="text-slate-400 italic">No emotional data extracted.</p>
            )}
          </div>
        </div>

        {/* Problem Patterns Chart */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px]">
          <h3 className="text-base font-bold text-slate-800 mb-2 flex items-center gap-2">
            <span className="material-icons text-slate-400">scatter_plot</span>
            Problem Patterns (Frequency vs Intensity)
          </h3>
          <ResponsiveContainer width="100%" height="90%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="frequency" name="Frequency" unit="" label={{ value: 'Frequency', position: 'bottom', offset: 0 }} />
              <YAxis type="number" dataKey="intensity" name="Intensity" unit="" domain={[0, 6]} label={{ value: 'Intensity (1-5)', angle: -90, position: 'insideLeft' }} />
              <ZAxis type="number" dataKey="frequency" range={[60, 400]} />
              <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter name="Themes" data={problemPatterns} fill="#8884d8">
                {problemPatterns.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={['#F87171', '#FBBF24', '#60A5FA', '#34D399', '#A78BFA'][index % 5]} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Insights Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <span className="material-icons text-slate-400">table_chart</span>
            Actionable Insights Table
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-medium uppercase text-xs">
              <tr>
                <th className="px-6 py-4">Theme</th>
                <th className="px-6 py-4 w-1/3">Quote</th>
                <th className="px-6 py-4">Emotion & Need</th>
                <th className="px-6 py-4">Opportunity</th>
                <th className="px-6 py-4">Proposed Solution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {insightsTable.length > 0 ? insightsTable.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{row.theme}</td>
                  <td className="px-6 py-4 text-slate-600 italic">"{row.text}"</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full w-fit">
                        {row.emotion}
                      </span>
                      <span className="text-xs text-slate-500">Need: {row.need}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-700">{row.opportunity}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-2 text-indigo-700 font-medium bg-indigo-50 px-3 py-2 rounded-lg">
                      <span className="material-icons text-sm mt-0.5">lightbulb</span>
                      {row.proposedUXSolution}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400">No structured insights available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- SUMMARY SCREEN ---
const SummaryScreen: React.FC<{ data: ResearchData, projectName: string, t: typeof translations['en'] }> = ({ data, projectName, t }) => {
  // Safe access with fallbacks
  const summary = data.summary || {
    keyFindings: [],
    quotes: [],
    recommendations: []
  };

  const keyFindings = summary.keyFindings || (data.keyFindings && data.keyFindings.length > 0 ? data.keyFindings : []);
  const keyQuotes = summary.quotes || (data.keyQuotes && data.keyQuotes.length > 0 ? data.keyQuotes : []);
  const recommendations = summary.recommendations || (data.recommendations && data.recommendations.length > 0 ? data.recommendations : []);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">{t.summary.executive}</h1>
        <p className="text-slate-500">{projectName} • {t.summary.generatedBy}</p>
      </div>

      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span className="material-icons text-[#BFA7F5]">verified</span>
          {t.summary.keyFindings}
        </h2>
        <ul className="space-y-3">
          {keyFindings.length > 0 ? keyFindings.map((finding, i) => (
            <li key={i} className="flex gap-3 text-slate-700 leading-relaxed">
              <span className="text-[#BFA7F5] font-bold">•</span>
              {finding}
            </li>
          )) : (
            <p className="text-slate-400 italic">No key findings generated.</p>
          )}
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100">
          <h3 className="font-bold text-purple-900 mb-4 flex items-center gap-2">
            <span className="material-icons">record_voice_over</span>
            {t.summary.voice}
          </h3>
          <div className="space-y-4">
            {keyQuotes.length > 0 ? keyQuotes.map((quote, i) => (
              <blockquote key={i} className="relative pl-4 border-l-4 border-purple-200 italic text-purple-800 text-sm">
                "{quote}"
              </blockquote>
            )) : (
              <p className="text-slate-400 italic pl-4">No quotes extracted.</p>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <span className="material-icons text-green-500">check_circle</span>
              {t.summary.tasks}
            </h3>
          </div>
          <div className="space-y-3">
            {recommendations.length > 0 ? recommendations.map((task) => (
              <div key={task.id || Math.random()} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${task.priority === 'High' ? 'bg-red-500' : task.priority === 'Medium' ? 'bg-amber-500' : 'bg-green-500'
                  }`}></div>
                <div>
                  <p className="text-sm text-slate-800 font-medium">{task.text}</p>
                  <span className={`text-[10px] uppercase font-bold tracking-wider ${task.priority === 'High' ? 'text-red-500' : task.priority === 'Medium' ? 'text-amber-600' : 'text-green-600'
                    }`}>
                    {(t.summary.priority as any)[task.priority] || task.priority} Priority
                  </span>
                </div>
              </div>
            )) : (
              <p className="text-slate-400 italic">No recommendations generated.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


export const App: React.FC = () => {
  const [projectState, setProjectState] = useState<ProjectState>(() => {
    try {
      const storedState = localStorage.getItem(STORAGE_KEY);
      if (storedState) {
        const parsedState = JSON.parse(storedState);
        // CLEAR files AND data on reload to prevent ghost state
        return { ...parsedState, files: [], data: null, isProcessing: false, error: null };
      }
    } catch (e) {
      console.error("Failed to parse stored project state:", e);
      localStorage.removeItem(STORAGE_KEY);
    }
    return {
      currentScreen: AppScreen.START,
      files: [],
      isProcessing: false,
      data: null,
      projectName: "New Research Project",
      error: null,
    };
  });

  const [history, setHistory] = useState<SavedProject[]>(() => {
    try {
      const storedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (storedHistory) {
        return JSON.parse(storedHistory);
      }
      return [];
    } catch (e) {
      console.error("Failed to parse stored history:", e);
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      return [];
    }
  });

  const [language, setLanguage] = useState<Language>('en');

  // Global confirmation state
  const [confirmation, setConfirmation] = useState<{
    type: 'project';
    id: string;
    title: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    const serializableState = {
      id: projectState.id,
      currentScreen: projectState.currentScreen,
      data: projectState.data,
      projectName: projectState.projectName,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState));
  }, [projectState]);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const t = translations[language];

  const navigateTo = (screen: AppScreen) => {
    setProjectState(prevState => ({ ...prevState, currentScreen: screen, error: null }));
  };

  const handleStartAnalysis = () => {
    if (!projectState.id) {
      const newId = Math.random().toString(36).substr(2, 9);
      const defaultName = "New Research Project";
      const newProject: SavedProject = {
        id: newId,
        name: defaultName,
        date: new Date().toISOString(),
        fileType: 'text',
        fileCount: 0,
        data: { ...INITIAL_DATA }
      };
      setHistory(prev => [newProject, ...prev]);
      setProjectState(prevState => ({
        ...prevState,
        currentScreen: AppScreen.UPLOAD,
        id: newId,
        projectName: defaultName
      }));
    } else {
      setProjectState(prevState => ({ ...prevState, currentScreen: AppScreen.UPLOAD }));
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setProjectState(prevState => ({
      ...prevState,
      files: prevState.files.filter(f => f.id !== fileId)
    }));
  };

  const handleUpdateProjectName = (name: string) => {
    const projectId = projectState.id || Math.random().toString(36).substr(2, 9);
    setProjectState(prevState => ({
      ...prevState,
      projectName: name,
      id: projectId
    }));
    setHistory(prevHistory => {
      const existingIndex = prevHistory.findIndex(p => p.id === projectId);
      if (existingIndex >= 0) {
        const updatedHistory = [...prevHistory];
        updatedHistory[existingIndex] = { ...updatedHistory[existingIndex], name: name };
        return updatedHistory;
      } else {
        const newProject: SavedProject = {
          id: projectId,
          name: name,
          date: new Date().toISOString(),
          fileType: 'text',
          fileCount: projectState.files.length,
          data: { ...INITIAL_DATA }
        };
        return [newProject, ...prevHistory];
      }
    });
  };

  const handleAddFiles = async (newFiles: File[], projectName: string) => {
    const newProjectFiles: ProjectFile[] = newFiles.map(f => {
      let type: 'video' | 'audio' | 'text' = 'text';
      if (f.type.startsWith('video')) type = 'video';
      else if (f.type.startsWith('audio')) type = 'audio';
      else {
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].includes(ext || '')) type = 'video';
        else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(ext || '')) type = 'audio';
      }

      return {
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        status: 'uploading',
        progress: 0,
        type: type
      };
    });

    const projectId = projectState.id || Math.random().toString(36).substr(2, 9);

    setProjectState(prevState => ({
      ...prevState,
      files: [...prevState.files, ...newProjectFiles],
      projectName,
      id: projectId,
    }));

    newProjectFiles.forEach(async (projectFile) => {
      try {
        const analyzedData = await analyzeResearchFile(projectFile.file, projectFile.type, (status, progress) => {
          setProjectState(prevState => {
            if (!prevState.files.find(f => f.id === projectFile.id)) return prevState;
            return {
              ...prevState,
              files: prevState.files.map(f =>
                f.id === projectFile.id
                  ? { ...f, status: status, progress: progress || f.progress }
                  : f
              )
            };
          });
        }, language);

        setProjectState(prevState => {
          if (!prevState.files.find(f => f.id === projectFile.id)) return prevState;
          const updatedFiles = prevState.files.map(f =>
            f.id === projectFile.id ? {
              ...f,
              status: 'uploaded' as const,
              progress: 100,
              analysisData: analyzedData
            } : f
          );

          const newData = analyzedData;
          const currentName = prevState.projectName;

          const projectToSave: SavedProject = {
            id: prevState.id!,
            name: currentName,
            date: new Date().toISOString(),
            fileType: projectFile.type,
            fileCount: updatedFiles.length,
            data: newData,
          };

          setHistory(prevHistory => {
            const others = prevHistory.filter(p => p.id !== projectToSave.id);
            return [projectToSave, ...others].slice(0, 10);
          });

          return {
            ...prevState,
            files: updatedFiles,
            data: newData,
            error: null
          };
        });

      } catch (error: any) {
        console.error(`Error processing file ${projectFile.file.name}:`, error);
        setProjectState(prevState => {
          if (!prevState.files.find(f => f.id === projectFile.id)) return prevState;
          return {
            ...prevState,
            files: prevState.files.map(f =>
              f.id === projectFile.id ? { ...f, status: 'error', error: error.message } : f
            ),
            error: error.message || t.common.error
          };
        });
      }
    });
  };

  const handleContinueToTranscript = () => {
    navigateTo(AppScreen.TRANSCRIPT);
  };

  const handleUpdateTag = (tagId: string, newLabel: string) => {
    setProjectState(prevState => {
      const updateData = (data: ResearchData) => {
        const updatedTags = data.tags.map(tag =>
          tag.id === tagId ? { ...tag, label: newLabel } : tag
        );
        const updatedHighlights = data.highlights.map(highlight => {
          const oldTag = data.tags.find(t => t.id === tagId);
          if (highlight.tagId === tagId && oldTag) {
            return { ...highlight, text: highlight.text.replace(oldTag.label, newLabel) };
          }
          return highlight;
        });
        return { ...data, tags: updatedTags, highlights: updatedHighlights };
      };

      const newData = prevState.data ? updateData(prevState.data) : null;
      const newFiles = prevState.files.map(f =>
        f.analysisData ? { ...f, analysisData: updateData(f.analysisData) } : f
      );

      return {
        ...prevState,
        data: newData,
        files: newFiles
      };
    });
  };

  const handleAddHighlight = (fileId: string, text: string, tagId: string, tagName?: string, tagColor?: string) => {
    setProjectState(prevState => {
      let actualTagId = tagId;
      const updateData = (data: ResearchData) => {
        let newTags = [...data.tags];
        if (tagId === 'NEW' && tagName) {
          const existing = newTags.find(t => t.label === tagName);
          if (existing) {
            actualTagId = existing.id;
          } else {
            actualTagId = Math.random().toString(36).substr(2, 9);
            newTags.push({ id: actualTagId, label: tagName, color: tagColor || '#ccc' });
          }
        }

        const newHighlight: Highlight = {
          id: Math.random().toString(36).substr(2, 9),
          text: text,
          tagId: actualTagId
        };

        return {
          ...data,
          tags: newTags,
          highlights: [...data.highlights, newHighlight]
        };
      };

      const newFiles = prevState.files.map(f => {
        if (f.id === fileId && f.analysisData) {
          return { ...f, analysisData: updateData(f.analysisData) };
        }
        return f;
      });

      const newData = prevState.data ? updateData(prevState.data) : null;

      return {
        ...prevState,
        files: newFiles,
        data: newData
      };
    });
  };

  const handleAddAffinityItem = (text: string) => {
    setProjectState(prevState => {
      if (!prevState.data) return prevState;

      const inboxTitle = "Inbox";
      let clusters = [...prevState.data.clusters];
      let inbox = clusters.find(c => c.title === inboxTitle);

      const newItem: AffinityItem = {
        id: Math.random().toString(36).substr(2, 9),
        text: text,
        type: 'note'
      };

      if (inbox) {
        clusters = clusters.map(c => c.id === inbox?.id ? { ...c, items: [...c.items, newItem] } : c);
      } else {
        inbox = {
          id: Math.random().toString(36).substr(2, 9),
          title: inboxTitle,
          color: "#E2E8F0",
          x: 50,
          y: 50,
          width: 300,
          height: 300,
          items: [newItem]
        };
        clusters.push(inbox);
      }

      return {
        ...prevState,
        data: { ...prevState.data, clusters }
      };
    });
  };

  const handleUpdateClusters = (updatedClusters: Cluster[]) => {
    setProjectState(prevState => {
      if (!prevState.data) return prevState;
      return {
        ...prevState,
        data: {
          ...prevState.data,
          clusters: updatedClusters
        }
      };
    });
  };

  const handleNewProject = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const defaultName = "New Research Project";

    const newProject: SavedProject = {
      id: newId,
      name: defaultName,
      date: new Date().toISOString(),
      fileType: 'text',
      fileCount: 0,
      data: { ...INITIAL_DATA }
    };

    setHistory(prev => [newProject, ...prev]);

    setProjectState({
      id: newId,
      currentScreen: AppScreen.UPLOAD,
      files: [],
      isProcessing: false,
      data: null,
      projectName: defaultName,
      error: null,
    });
  };

  const handleLoadProject = (project: SavedProject) => {
    setProjectState({
      id: project.id,
      currentScreen: AppScreen.TRANSCRIPT,
      files: [],
      isProcessing: false,
      data: project.data,
      projectName: project.name,
      error: null,
    });
  };

  const handleDeleteProject = (projectId: string) => {
    setConfirmation({
      type: 'project',
      id: projectId,
      title: "Delete Project",
      message: "Are you sure you want to delete this project? All associated data including transcripts and analysis will be permanently lost."
    });
  };

  const executeDeletion = () => {
    if (confirmation && confirmation.type === 'project') {
      const projectId = confirmation.id;
      setHistory(prevHistory => prevHistory.filter(p => p.id !== projectId));
      if (projectState.id === projectId) {
        handleNewProject();
      }
      setConfirmation(null);
    }
  };

  const handleToggleLanguage = () => {
    setLanguage(prevLang => (prevLang === 'en' ? 'uk' : 'en'));
  };

  const isSetupPhase = projectState.currentScreen === AppScreen.START ||
    projectState.currentScreen === AppScreen.UPLOAD ||
    projectState.currentScreen === AppScreen.PROCESSING;

  const renderScreen = () => {
    switch (projectState.currentScreen) {
      case AppScreen.START:
        return <StartScreen onStart={handleStartAnalysis} t={t} />;
      case AppScreen.UPLOAD:
        return (
          <UploadScreen
            onAddFiles={handleAddFiles}
            onRemoveFile={handleRemoveFile}
            files={projectState.files}
            isProcessing={projectState.isProcessing}
            onProceed={handleContinueToTranscript}
            t={t}
            initialProjectName={projectState.projectName}
            onNameChange={handleUpdateProjectName}
          />
        );
      case AppScreen.PROCESSING:
        return (
          <ProcessingScreen
            t={t}
            error={projectState.error}
            onBack={() => setProjectState(prev => ({ ...prev, currentScreen: AppScreen.UPLOAD, error: null }))}
          />
        );
      case AppScreen.END:
        return <SuccessScreen onContinue={handleContinueToTranscript} t={t} />;
      case AppScreen.TRANSCRIPT:
        return projectState.data ? (
          <TranscriptScreen
            data={projectState.data}
            projectName={projectState.projectName}
            files={projectState.files}
            onUpdateTag={handleUpdateTag}
            onAddHighlight={handleAddHighlight}
            onAddAffinity={handleAddAffinityItem}
            t={t}
          />
        ) : (
          <p className="p-4 text-center text-slate-500">{t.common.error}: {t.transcript.noData}</p>
        );
      case AppScreen.AFFINITY:
        return projectState.data ? (
          <AffinityScreen
            data={projectState.data}
            projectName={projectState.projectName}
            files={projectState.files}
            onUpdateClusters={handleUpdateClusters}
            t={t}
          />
        ) : (
          <p className="p-4 text-center text-slate-500">{t.common.error}: No data available.</p>
        );
      case AppScreen.INSIGHTS:
        return projectState.data ? (
          <InsightsScreen
            data={projectState.data}
            projectName={projectState.projectName}
            t={t}
          />
        ) : (
          <p className="p-4 text-center text-slate-500">{t.common.error}: No data available.</p>
        );
      case AppScreen.SUMMARY:
        return projectState.data ? (
          <SummaryScreen
            data={projectState.data}
            projectName={projectState.projectName}
            t={t}
          />
        ) : (
          <p className="p-4 text-center text-slate-500">{t.common.error}: No data available.</p>
        );
      default:
        return (
          <div className="p-10 text-center">
            <p className="text-slate-500">Screen under development</p>
          </div>
        );
    }
  };

  return (
    <Layout
      currentScreen={projectState.currentScreen}
      currentProjectId={projectState.id}
      history={history}
      onNavigate={navigateTo}
      onLoadProject={handleLoadProject}
      onNewProject={handleNewProject}
      onDeleteProject={handleDeleteProject}
      language={language}
      onToggleLanguage={handleToggleLanguage}
      topNav={
        projectState.currentScreen !== AppScreen.START && (
          <TopNav
            currentScreen={projectState.currentScreen}
            onNavigate={navigateTo}
            isSetup={isSetupPhase}
            language={language}
            hasData={!!projectState.data}
          />
        )
      }
    >
      {renderScreen()}
      <ConfirmDialog
        isOpen={!!confirmation}
        title={confirmation?.title || ""}
        message={confirmation?.message || ""}
        confirmLabel="Delete"
        isDestructive={true}
        onConfirm={executeDeletion}
        onCancel={() => setConfirmation(null)}
      />
    </Layout>
  );
};
