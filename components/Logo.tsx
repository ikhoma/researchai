import React from 'react';

export const Logo: React.FC<{ size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }> = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24'
  };

  return (
    <div className={`flex items-center gap-2 font-bold text-slate-900 tracking-tight ${className}`}>
      <div className={`relative flex items-center justify-center ${sizeClasses[size]} text-[#BFA7F5]`}>
        {/* The OO Eyes */}
        <div className="absolute left-0 w-[45%] h-[90%] border-[3px] border-current rounded-full flex items-center justify-center bg-white oo-eye-blink">
          <div className="w-[30%] h-[30%] bg-black rounded-full translate-x-[20%]"></div>
        </div>
        <div className="absolute right-0 w-[45%] h-[90%] border-[3px] border-current rounded-full flex items-center justify-center bg-white oo-eye-blink" style={{ animationDelay: '0.1s' }}>
          <div className="w-[30%] h-[30%] bg-black rounded-full translate-x-[20%]"></div>
        </div>
      </div>
      <span className={size === 'xl' ? 'text-4xl' : size === 'lg' ? 'text-3xl' : 'text-xl'}>
        Reserch AI
      </span>
    </div>
  );
};
