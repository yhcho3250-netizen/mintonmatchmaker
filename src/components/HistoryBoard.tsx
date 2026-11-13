import React, { useState } from 'react';
import { CourtMatch, MatchRound, Player, TIER_LABELS, extractCourtNumberLabel, formatCourtName } from '../types';
import { Calendar, X, Sparkles, RotateCcw, AlertTriangle } from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { PartnerDot } from './PartnerDot';

interface HistoryBoardProps {
  completedMatches?: CourtMatch[];
  roundHistory?: MatchRound[];
  playersMap: Map<string, Player>;
  meetupName: string;
  onResetHistory?: () => void;
}

export const HistoryBoard: React.FC<HistoryBoardProps> = ({
  completedMatches = [],
  roundHistory = [],
  playersMap,
  meetupName,
  onResetHistory,
}) => {
  // Consolidate matches from completedMatches prop and roundHistory fallback
  const allMatches: CourtMatch[] = React.useMemo(() => {
    if (completedMatches && completedMatches.length > 0) {
      return completedMatches;
    }
    const fromRounds = roundHistory.flatMap((r) => r.matches);
    const map = new Map<string, CourtMatch>();
    fromRounds.forEach((m) => map.set(m.id, m));
    return Array.from(map.values()).sort(
      (a, b) => (b.completedAt || 0) - (a.completedAt || 0)
    );
  }, [completedMatches, roundHistory]);

  const getPlayer = (id: string, match?: CourtMatch): Player | undefined => {
    const fromMap = playersMap.get(id);
    if (fromMap) return fromMap;
    const snap = match?.playerSnapshots?.[id];
    if (snap) {
      return {
        id: snap.id,
        name: snap.name,
        tier: snap.tier,
        gender: snap.gender,
        isActive: false,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalPointsWon: 0,
        totalPointsLost: 0,
        consecutiveRestRounds: 0,
        partnerHistory: {},
        opponentHistory: {},
        createdAt: 0,
      };
    }
    return undefined;
  };

  // Selected player filter for highlighting identical name and tier
  const [highlightFilter, setHighlightFilter] = useState<{ name: string; tier: string } | null>(null);

  // In-app confirmation modal for match history reset (no window.confirm)
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [emptyNotice, setEmptyNotice] = useState(false);

  const handleResetButtonClick = () => {
    soundEffects.playRacketHit();
    if (allMatches.length === 0) {
      setEmptyNotice(true);
      setTimeout(() => setEmptyNotice(false), 3000);
      return;
    }
    setShowResetConfirmModal(true);
  };

  const handlePlayerClick = (player: Player) => {
    soundEffects.playRacketHit();
    if (
      highlightFilter &&
      highlightFilter.name === player.name &&
      highlightFilter.tier === player.tier
    ) {
      setHighlightFilter(null);
    } else {
      setHighlightFilter({ name: player.name, tier: player.tier });
    }
  };

  // 대진 기록에서는 휴식, 레슨, 마지막판, 퇴장 표시를 숨김
  const renderPlayerPill = (player: Player | undefined) => {
    if (!player) return <span className="text-slate-500 text-xs">미배정</span>;
    const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;

    const isHighlighted =
      highlightFilter !== null &&
      player.name === highlightFilter.name &&
      player.tier === highlightFilter.tier;

    return (
      <button
        type="button"
        onClick={() => handlePlayerClick(player)}
        title={`${player.name} (${tierMeta.short}) - 클릭 시 동일 이름 및 급수 선수 주황색 반짝임 강조`}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs shrink-0 transition-all cursor-pointer select-none active:scale-95 ${
          isHighlighted
            ? 'bg-orange-500/30 border-orange-400 text-orange-200 ring-2 ring-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.65)] animate-pulse'
            : 'bg-slate-900 border-slate-800 text-slate-200 hover:border-slate-700 hover:bg-slate-800/80'
        }`}
      >
        <span
          className={`font-bold whitespace-nowrap ${
            isHighlighted
              ? 'text-orange-300 font-extrabold'
              : player.gender === 'M'
              ? 'text-blue-400'
              : 'text-pink-400'
          }`}
        >
          {player.name}
        </span>
        <PartnerDot player={player} allPlayers={Array.from(playersMap.values())} size="xs" />
        <span
          className={`text-[10px] font-bold shrink-0 ${
            isHighlighted
              ? 'text-orange-300 font-black'
              : tierMeta.color
          }`}
        >
          {tierMeta.short}
        </span>
      </button>
    );
  };

  const renderHeader = () => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="text-lg font-bold text-white flex items-center gap-2 shrink-0 whitespace-nowrap">
          <Calendar className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>대진 기록</span>
        </h1>
        {onResetHistory && (
          <button
            type="button"
            onClick={handleResetButtonClick}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer ${
              allMatches.length > 0
                ? 'bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 border-slate-700 hover:border-rose-500/40'
                : 'bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-300 border-slate-750'
            }`}
            title="완료된 대진 기록 초기화"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>초기화</span>
          </button>
        )}
      </div>
      <div className="text-xs font-mono font-normal text-slate-400">
        (완료된 경기 총 {allMatches.length}개)
      </div>
    </div>
  );

  if (allMatches.length === 0) {
    return (
      <div className="space-y-4">
        {renderHeader()}

        {emptyNotice && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2 text-xs text-amber-300 animate-fadeIn">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>초기화할 완료된 대진 기록이 없습니다. (현재 0경기)</span>
          </div>
        )}

        <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 space-y-2">
          <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-400">
            완료된 경기 대진 기록이 없습니다
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            코트에서 [경기 완료]를 누르거나 코트 삭제 시 참가자들의 대진 기록이 이곳에 자동으로 보관됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderHeader()}

      {emptyNotice && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2 text-xs text-amber-300 animate-fadeIn">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>초기화할 완료된 대진 기록이 없습니다. (현재 0경기)</span>
        </div>
      )}

      {/* Active Highlight Banner */}
      {highlightFilter && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-orange-500/15 border border-orange-400/60 text-orange-200 text-xs flex items-center justify-between gap-2 animate-pulse shadow-md shadow-orange-500/15">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-400 shrink-0" />
            <span>
              선수 검색 강조 중: <strong className="text-white font-bold">{highlightFilter.name}</strong> ({TIER_LABELS[highlightFilter.tier as keyof typeof TIER_LABELS]?.short || highlightFilter.tier})과 동일한 이름 & 급수 선수를 주황색으로 반짝임 표시하고 있습니다.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEffects.playRacketHit();
              setHighlightFilter(null);
            }}
            className="px-2 py-1 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 hover:text-white border border-orange-400/40 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3 h-3" />
            <span>강조 해제</span>
          </button>
        </div>
      )}

      {/* Completed Matches List (모바일/데스크톱 모두 선수들 한 줄 나열) */}
      <div className="space-y-2.5">
        {allMatches.map((m, index) => {
          const p1 = getPlayer(m.teamA.player1Id, m);
          const p2 = getPlayer(m.teamA.player2Id, m);
          const p3 = getPlayer(m.teamB.player1Id, m);
          const p4 = getPlayer(m.teamB.player2Id, m);

          const courtTitle = formatCourtName(
            extractCourtNumberLabel(m.courtName, m.courtNumber)
          );
          const timeFormatted = m.completedAt
            ? new Date(m.completedAt).toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';

          return (
            <div
              key={m.id || index}
              className="p-3 sm:p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              {/* Left: Court info & Time */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-bold text-white text-xs sm:text-sm">
                  {courtTitle}
                </span>
                {timeFormatted && (
                  <span className="text-[11px] text-slate-400 font-mono">
                    {timeFormatted} 완료
                  </span>
                )}
                <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded-full border border-emerald-500/20 ml-1">
                  완료
                </span>
              </div>

              {/* Right: 4 Participants in a single horizontal row (선수들 한줄 나열, vs 제거) */}
              <div className="flex items-center gap-1.5 overflow-x-auto touch-manipulation no-scrollbar max-w-full py-0.5">
                {renderPlayerPill(p1)}
                {renderPlayerPill(p2)}
                {renderPlayerPill(p3)}
                {renderPlayerPill(p4)}
              </div>
            </div>
          );
        })}
      </div>

      {/* 대진 기록 초기화 확인 모달 (브라우저 window.confirm 대신 안정적인 앱 모달 제공) */}
      {showResetConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
          onClick={() => setShowResetConfirmModal(false)}
        >
          <div
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <RotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">대진 기록 초기화</h3>
                  <p className="text-[11px] text-slate-400">완료된 경기 기록을 모두 삭제합니다</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-3.5">
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-bold text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>총 {allMatches.length}개의 완료 대진 기록이 삭제됩니다</span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  초기화 실행 시 선수들의 <strong>진행 경기 수</strong>와 <strong>승패 전적</strong>이 0으로 리셋되며, 코트 꼬깔 순서도 처음으로 돌아갑니다.
                </p>
              </div>
              <p className="text-xs text-slate-400">
                * 참가자 명단과 코트 설정은 안전하게 그대로 유지됩니다.
              </p>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirmModal(false);
                  if (onResetHistory) {
                    onResetHistory();
                  }
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl shadow-lg shadow-rose-600/30 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>대진 기록 초기화 실행</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
