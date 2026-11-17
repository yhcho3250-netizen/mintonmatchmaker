import React from 'react';
import { Player } from '../types';
import { getPartnerInfo } from '../utils/partnerUtils';
import { CrossedRacketsIcon } from './CrossedRacketsIcon';

interface PartnerDotProps {
  player?: Player | null;
  playerId?: string;
  allPlayers: Player[];
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showPartnerName?: boolean;
  className?: string;
}

export const PartnerDot: React.FC<PartnerDotProps> = ({
  player,
  playerId,
  allPlayers,
  size = 'md',
  showPartnerName = false,
  className = '',
}) => {
  const targetId = player?.id || playerId;
  if (!targetId || !allPlayers || allPlayers.length === 0) return null;

  const targetPlayer = player || allPlayers.find((p) => p.id === targetId);
  if (!targetPlayer || !targetPlayer.partnerId) return null;

  const info = getPartnerInfo(targetId, allPlayers);
  if (!info || !info.partner) return null;

  const sizeClasses = {
    xs: 'w-3 h-3',
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-4.5 h-4.5',
  };

  const iconSize = sizeClasses[size];

  return (
    <div
      className={`inline-flex items-center gap-1 shrink-0 select-none ${className}`}
      title={`파트너: ${info.partner.name} (${info.color.name} / 같은 코트 우선 배정)`}
    >
      <CrossedRacketsIcon
        className={`${iconSize} shrink-0 animate-partner-twinkle`}
        style={{
          color: info.color.glow,
          filter: `drop-shadow(0 0 5px ${info.color.glow})`,
        }}
      />
      {showPartnerName && (
        <span
          className={`text-[10px] font-bold ${info.color.text} truncate max-w-[65px]`}
        >
          {info.partner.name}
        </span>
      )}
    </div>
  );
};
