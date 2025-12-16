import React from 'react';
import { AppScreen, Language } from '../types';
import { translations } from '../utils/translations';

interface TopNavProps {
  currentScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  isSetup: boolean; // True if in START, UPLOAD, or PROCESSING
  language: Language;
  hasData?: boolean; // True if research data is available
}

const TopNavItem: React.FC<{ label: string; icon: string; screen: AppScreen; active: boolean; onClick: () => void; disabled?: boolean }> = ({ label, icon, screen, active, onClick, disabled }) => (
  <button
    onClick={() => !disabled && onClick()}
    disabled={disabled}
    className={`
      relative px-4 py-3 text-sm font-medium transition-colors flex items-center gap-2
      ${active 
        ? 'text-purple-700' 
        : disabled 
          ? 'text-slate-300 cursor-not-allowed' 
          : 'text-slate-500 hover:text-slate-700'
      }
    `}
  >
    <span className="material-icons text-[20px]">{icon}</span>
    {label}
    {active && (
      <div className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-700 rounded-t-full"></div>
    )}
  </button>
);

export const TopNav: React.FC<TopNavProps> = ({ currentScreen, onNavigate, isSetup, language, hasData = false }) => {
  const t = translations[language];

  const analysisSteps = [
    { label: t.topNav.uploadSources, screen: AppScreen.UPLOAD, icon: 'cloud_upload' },
    { label: t.topNav.transcript, screen: AppScreen.TRANSCRIPT, icon: 'description' },
    { label: t.topNav.affinity, screen: AppScreen.AFFINITY, icon: 'grid_view' },
    { label: t.topNav.insights, screen: AppScreen.INSIGHTS, icon: 'lightbulb' },
    { label: t.topNav.summary, screen: AppScreen.SUMMARY, icon: 'summarize' },
  ];

  const isStepDisabled = (stepScreen: AppScreen) => {
    // Always allow navigating to Upload/Sources
    if (stepScreen === AppScreen.UPLOAD) return false;

    // If we have analyzed data, allow navigation to all tabs
    if (hasData) return false;

    // Otherwise (no data), disable analysis steps if we are still in the setup phase
    if (isSetup) return true;
    
    return false;
  };

  return (
    <nav className="flex items-center gap-6 px-6 overflow-x-auto whitespace-nowrap">
      {analysisSteps.map(step => (
        <TopNavItem
          key={step.screen}
          label={step.label}
          icon={step.icon}
          screen={step.screen}
          active={currentScreen === step.screen}
          onClick={() => onNavigate(step.screen)}
          disabled={isStepDisabled(step.screen)}
        />
      ))}
    </nav>
  );
};