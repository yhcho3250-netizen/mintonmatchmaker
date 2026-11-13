import React from 'react';
import { ConeColor } from '../types';

interface ConeIconProps {
  color: ConeColor;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isActive?: boolean;
  className?: string;
  showLabel?: boolean;
}

export const ConeIcon: React.FC<ConeIconProps> = ({
  color,
  size = 'md',
  isActive = false,
  className = '',
  showLabel = false,
}) => {
  const isRed = color === 'red';

  const sizeClasses = {
    xs: 'w-3.5 h-3.5',
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }[size];

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div
        className={`relative flex items-center justify-center transition-all ${
          isActive
            ? isRed
              ? 'scale-110 drop-shadow-[0_0_8px_rgba(239,68,68,0.7)]'
              : 'scale-110 drop-shadow-[0_0_6px_rgba(148,163,184,0.5)]'
            : 'opacity-70 hover:opacity-100'
        }`}
        title={isRed ? '우리클럽 꼬깔 (빨간색)' : '다른클럽 꼬깔 (회색)'}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${sizeClasses}`}
        >
          {/* Base of Cone */}
          <ellipse
            cx="12"
            cy="20.5"
            rx="9"
            ry="2.5"
            fill={isRed ? '#991b1b' : '#334155'}
          />
          <ellipse
            cx="12"
            cy="19.5"
            rx="8.5"
            ry="2"
            fill={isRed ? '#dc2626' : '#475569'}
          />

          {/* Cone Body */}
          <path
            d="M6 19.5L11 3.5C11.3 2.5 12.7 2.5 13 3.5L18 19.5C18 19.5 15.5 21 12 21C8.5 21 6 19.5 6 19.5Z"
            fill={isRed ? '#ef4444' : '#64748b'}
          />

          {/* Reflective Band / Stripe (White on red, Silver/white on gray) */}
          <path
            d="M8.2 13.5L9.6 9.5C9.6 9.5 10.7 9.8 12 9.8C13.3 9.8 14.4 9.5 14.4 9.5L15.8 13.5C15.8 13.5 14 14.2 12 14.2C10 14.2 8.2 13.5 8.2 13.5Z"
            fill="#ffffff"
            fillOpacity={isRed ? '0.92' : '0.85'}
          />

          {/* Highlight sheen */}
          <path
            d="M10.8 4L8 14"
            stroke="#ffffff"
            strokeWidth="0.8"
            strokeLinecap="round"
            strokeOpacity="0.4"
          />
        </svg>

        {isActive && (
          <span
            className={`absolute -bottom-1 -right-1 w-2 h-2 rounded-full ring-2 ring-slate-950 ${
              isRed ? 'bg-red-400 animate-ping' : 'bg-slate-300'
            }`}
          />
        )}
      </div>

      {showLabel && (
        <span
          className={`text-xs font-bold ${
            isRed
              ? 'text-red-400'
              : 'text-slate-400'
          }`}
        >
          {isRed ? '우리클럽' : '다른클럽'}
        </span>
      )}
    </div>
  );
};
