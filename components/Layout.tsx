import React, { useState } from 'react';
import { Logo } from './Logo';
import { AppScreen, SavedProject, Language } from '../types';
import { translations } from '../utils/translations';

interface LayoutProps {
  currentScreen: AppScreen;
  currentProjectId?: string;
  history?: SavedProject[];
  onNavigate: (screen: AppScreen) => void;
  onLoadProject?: (project: SavedProject) => void;
  onNewProject?: () => void;
  onDeleteProject?: (id: string) => void;
  children: React.ReactNode;
  language: Language;
  onToggleLanguage: () => void;
  topNav?: React.ReactNode; // New prop for top navigation
}

const NavItem: React.FC<{ label: string; icon: string; active: boolean; onClick: () => void; disabled?: boolean; isLeftMenu?: boolean }> = ({ label, icon, active, onClick, disabled, isLeftMenu = true }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
      active 
        ? 'bg-[#BFA7F5]/20 text-purple-900' 
        : 'text-slate-500 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed'
    }`}
  >
    <span className="material-icons text-[18px]">{icon}</span>
    {label}
  </button>
);

export const Layout: React.FC<LayoutProps> = ({ 
  currentScreen, 
  currentProjectId,
  history = [], 
  onNavigate, 
  onLoadProject,
  onNewProject,
  onDeleteProject,
  children,
  language,
  onToggleLanguage,
  topNav // Use the new topNav prop
}) => {
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(true);
  const isSetup = currentScreen === AppScreen.START || currentScreen === AppScreen.UPLOAD || currentScreen === AppScreen.PROCESSING;
  const t = translations[language];

  if (isSetup && currentScreen === AppScreen.START) {
    return <div className="min-h-screen bg-white">{children}</div>;
  }

  return (
    <div className="flex min-h-screen bg-[#FAFAFA]">
      {/* Left Menu */}
      <div className="w-64 bg-white border-r border-slate-100 flex flex-col fixed h-full z-10 hidden md:flex">
        <div className="p-6">
          <Logo size="md" />
        </div>
        
        <div className="flex-1 px-4 space-y-1 overflow-y-auto">
          {/* New Project Button */}
          {onNewProject && (
             <button 
               onClick={onNewProject}
               className="w-full mb-6 flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
             >
               {t.sidebar.newAnalysis}
             </button>
          )}

          {/* My Projects Section */}
          {history && history.length > 0 && (
            <div className="mt-4">
              <div 
                className="flex items-center justify-between px-2 mb-2 text-slate-500 cursor-pointer hover:text-slate-700 transition-colors select-none"
                onClick={() => setIsProjectsExpanded(!isProjectsExpanded)}
              >
                  <div className="flex items-center gap-2 font-medium text-sm">
                      <span className="material-icons text-[20px] text-slate-400">folder_open</span>
                      {t.sidebar.myProjects}
                  </div>
                  <span 
                    className={`material-icons text-[20px] text-slate-400 transition-transform duration-200 ${isProjectsExpanded ? '' : '-rotate-90'}`}
                  >
                    expand_more
                  </span>
              </div>
              
              {isProjectsExpanded && (
                <div className="space-y-1 pb-4">
                  {history.map(item => (
                    <div 
                      key={item.id} 
                      className={`group px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${currentProjectId === item.id ? 'bg-[#EEF2FF] border border-[#C7D2FE]/50' : 'hover:bg-slate-50 border border-transparent'}`} 
                      onClick={() => onLoadProject && onLoadProject(item)}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                          <div className={`font-medium text-sm truncate ${currentProjectId === item.id ? 'text-slate-900' : 'text-slate-700'}`}>{item.name}</div>
                          {onDeleteProject && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); onDeleteProject(item.id); }}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                              title="Delete project"
                            >
                              <span className="material-icons text-[16px]">delete</span>
                            </button>
                          )}
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                          {item.fileCount !== undefined 
                            ? `${item.fileCount} ${item.fileCount === 1 ? 'file' : 'files'}` 
                            : (item.fileType ? (item.fileType.charAt(0).toUpperCase() + item.fileType.slice(1)) : 'File')} • {new Date(item.date).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 space-y-4">
           {/* Language Switcher */}
           <button 
             onClick={onToggleLanguage}
             className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-600 transition-colors"
           >
             <div className="flex items-center gap-2">
               <span className="material-icons text-sm text-slate-400">language</span>
               Language
             </div>
             <div className="flex items-center gap-1">
               <span className={language === 'en' ? 'text-slate-900 font-bold' : 'text-slate-400'}>EN</span>
               <span className="text-slate-300">/</span>
               <span className={language === 'uk' ? 'text-slate-900 font-bold' : 'text-slate-400'}>UA</span>
             </div>
           </button>

           {/* User Info Placeholder */}
           <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                <span className="material-icons text-base">person</span>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">User Name</p>
                <p className="text-xs text-slate-500">Free Tier</p>
              </div>
           </div>

           <div className="bg-purple-50 p-3 rounded-lg flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-200 flex items-center justify-center text-purple-700 font-bold text-xs">AI</div>
              <div>
                <p className="text-xs font-medium text-purple-900">{t.sidebar.geminiPowered}</p>
                <p className="text-[10px] text-purple-600">{t.sidebar.model}</p>
              </div>
           </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 md:ml-64 flex flex-col">
        {/* Top Navigation Bar */}
        {topNav && <div className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-10">{topNav}</div>}
        
        {/* Children (Screen Content) */}
        <main className="flex-1 p-6 md:p-10 overflow-auto h-screen">
          {children}
        </main>
      </div>
    </div>
  );
};