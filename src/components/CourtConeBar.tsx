import React, { useState } from 'react';
import {
  CourtInfo,
  ConeItem,
  ConeColor,
  extractCourtNumberLabel,
  formatCourtName,
  getNormalizedTurnQueue,
  addConeToTurnQueue,
  removeConeFromTurnQueue,
  formatConeTurnSequence,
} from '../types';
import { ConeIcon } from './ConeIcon';
import { HeaderConeScroll } from './HeaderConeScroll';
import { DragScrollContainer } from './DragScrollContainer';
import { Trash2, RotateCw, Settings2 } from 'lucide-react';
import { soundEffects } from '../utils/audio';

interface CourtConeBarProps {
  court: CourtInfo;
  onAdvanceTurn: (courtNumber: number) => void;
  onUpdateCones: (courtNumber: number, cones: ConeItem[], currentConeIndex: number) => void;
  compact?: boolean;
}

export const CourtConeBar: React.FC<CourtConeBarProps> = ({
  court,
  onAdvanceTurn,
  onUpdateCones,
  compact = false,
}) => {
  const [showSettings, setShowSettings] = useState(false);

  const cones = getNormalizedTurnQueue(court.cones || [], court.currentConeIndex || 0);
  const currentIdx = 0;
  const activeCone = cones[currentIdx];
  const isOurTurn = activeCone?.color === 'red';

  const handleAddCone = (color: ConeColor) => {
    soundEffects.playRacketHit();
    const { cones: updated, currentConeIndex: nextIdx } = addConeToTurnQueue(
      court.cones || [],
      court.currentConeIndex || 0,
      color
    );
    onUpdateCones(court.courtNumber, updated, nextIdx);
  };

  const handleRemoveCone = (index: number) => {
    if ((court.cones || []).length <= 1) {
      return;
    }
    const { cones: updated, currentConeIndex: nextIdx } = removeConeFromTurnQueue(
      court.cones || [],
      court.currentConeIndex || 0,
      index
    );
    onUpdateCones(court.courtNumber, updated, nextIdx);
  };


  return (
    <div className="w-full">
      {/* Visual Cone Bar */}
      <div
        className={`px-3 py-2 rounded-xl flex items-center justify-between gap-2 border transition-colors ${
          isOurTurn
            ? 'bg-red-950/20 border-red-500/30'
            : 'bg-slate-900/90 border-slate-700/60'
        }`}
      >
        {/* Left: Active Cone Status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            {activeCone && (
              <ConeIcon
                color={activeCone.color}
                size="sm"
                isActive={true}
              />
            )}
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${
                isOurTurn
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm shadow-red-500/20'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isOurTurn ? 'bg-red-400 animate-pulse' : 'bg-slate-400'}`} />
              {isOurTurn ? '우리클럽 턴 (빨간 꼬깔)' : '다른클럽 턴 (회색 꼬깔)'}
            </span>
          </div>

          {/* Cone Queue Order preview (꼬깔 3개 이후부터 좌우 스크롤, 스크롤바 및 <,> 버튼 숨김) */}
          <div className="flex items-center gap-1 text-[11px] text-slate-400 pl-2 border-l border-slate-800 shrink-0">
            <span className="text-[10px] text-slate-500 font-semibold mr-0.5 hidden sm:inline">순서:</span>
            <HeaderConeScroll cones={cones} currentIdx={currentIdx} />
          </div>
        </div>

        {/* Right: Settings Action (상단 턴 넘기기 버튼 숨김) */}
        <div className="flex items-center gap-1 shrink-0">

          <button
            onClick={() => setShowSettings(!showSettings)}
            title="꼬깔 순서 및 추가 설정"
            className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors cursor-pointer ${
              showSettings ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded Cone Management Panel */}
      {showSettings && (
        <div className="mt-2 p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span>{formatCourtName(extractCourtNumberLabel(court.name, court.courtNumber))} 꼬깔(턴) 설정</span>
            </span>
            <span className="text-[10px] text-slate-400">
              총 {cones.length}개 꼬깔 등록됨
            </span>
          </div>

          {/* Cone List & Management */}
          <div className="space-y-1.5">
            <DragScrollContainer
              scrollToEndTrigger={cones.length}
              className="flex flex-nowrap items-center gap-1.5 py-0.5 max-w-full"
            >
              {cones.map((cone, idx) => {
                const isActive = idx === currentIdx;
                return (
                  <div
                    key={cone.id || idx}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs shrink-0 ${
                      isActive
                        ? 'bg-slate-800 border-emerald-400/70 text-white shadow-sm'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300'
                    }`}
                  >
                    <ConeIcon color={cone.color} size="xs" isActive={isActive} />
                    {isActive && (
                      <span className="text-[9px] px-1 bg-emerald-500/20 text-emerald-300 rounded font-bold shrink-0">
                        현재
                      </span>
                    )}
                    {cones.length > 1 && (
                      <button
                        onClick={() => handleRemoveCone(idx)}
                        title="꼬깔 제거"
                        className="ml-0.5 text-slate-500 hover:text-rose-400 cursor-pointer p-0.5 shrink-0"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </DragScrollContainer>
          </div>

          {/* Add Cone Buttons */}
          <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80">
            <button
              onClick={() => handleAddCone('red')}
              className="flex-1 py-1.5 px-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 font-semibold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ConeIcon color="red" size="xs" />
              <span>+ 빨간 꼬깔 (우리클럽)</span>
            </button>
            <button
              onClick={() => handleAddCone('gray')}
              className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <ConeIcon color="gray" size="xs" />
              <span>+ 회색 꼬깔 (다른클럽)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
