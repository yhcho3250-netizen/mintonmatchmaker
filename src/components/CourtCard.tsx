import React, { useState, useRef, useEffect } from 'react';
import {
  CourtMatch,
  CourtInfo,
  Player,
  TIER_LABELS,
  ConeItem,
  SwapSelection,
  ConeColor,
  isPlayerLastMatchCompleted,
  extractCourtNumberLabel,
  formatCourtName,
  getNormalizedTurnQueue,
  addConeToTurnQueue,
  removeConeFromTurnQueue,
  formatConeTurnSequence,
} from '../types';
import { ArrowLeftRight, Check, RotateCcw, Settings2, Trash2, AlertTriangle, Coffee, GraduationCap, Flag, DoorOpen } from 'lucide-react';
import { ConeIcon } from './ConeIcon';
import { CourtTitleBadge } from './CourtTitleBadge';
import { HeaderConeScroll } from './HeaderConeScroll';
import { DragScrollContainer } from './DragScrollContainer';
import { PartnerDot } from './PartnerDot';
import { soundEffects } from '../utils/audio';

interface CourtCardProps {
  match: CourtMatch;
  court?: CourtInfo;
  playersMap: Map<string, Player>;
  onCompleteMatch: (matchId: string) => void;
  onResetMatch: (matchId: string) => void;
  onSelectPlayerForSwap: (playerId: string, matchId: string, team: 'teamA' | 'teamB', slot: 1 | 2) => void;
  selectedSwap?: SwapSelection | null;
  selectedSwapPlayerId?: string | null;
  onAdvanceTurn?: (courtNumber: number) => void;
  onUpdateCones?: (courtNumber: number, cones: ConeItem[], currentConeIndex: number) => void;
  onRenameCourt?: (courtNumber: number, newName: string) => void;
  onClearCourtMatch?: (courtNumber: number) => void;
  onRemoveCourt?: (courtNumber: number) => void;
  onRevertPreviousMatch?: (courtNumber: number) => void;
  hasPreviousMatch?: boolean;
  previousMatchSummary?: string;
  activeMatches?: CourtMatch[];
  queuedMatches?: CourtMatch[];
  conflictPlayerIds?: string[];
}

export const CourtCard: React.FC<CourtCardProps> = ({
  match,
  court,
  playersMap,
  onCompleteMatch,
  onResetMatch,
  onSelectPlayerForSwap,
  selectedSwap,
  selectedSwapPlayerId,
  onAdvanceTurn,
  onUpdateCones,
  onRenameCourt,
  onClearCourtMatch,
  onRemoveCourt,
  onRevertPreviousMatch,
  hasPreviousMatch,
  previousMatchSummary,
  activeMatches = [],
  queuedMatches = [],
  conflictPlayerIds = [],
}) => {
  const [showConeSettings, setShowConeSettings] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const fallbackStartRef = useRef<number>(Date.now());

  useEffect(() => {
    fallbackStartRef.current = Date.now();
  }, [match.id]);

  const computeElapsedSeconds = () => {
    const start = match.startedAt || fallbackStartRef.current;
    const end = match.status === 'completed' && match.completedAt ? match.completedAt : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  };

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(computeElapsedSeconds);

  useEffect(() => {
    setElapsedSeconds(computeElapsedSeconds());
    if (match.status === 'completed') return;
    const interval = setInterval(() => {
      setElapsedSeconds(computeElapsedSeconds());
    }, 1000);
    return () => clearInterval(interval);
  }, [match.id, match.startedAt, match.status, match.completedAt]);

  const formattedElapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(
    elapsedSeconds % 60
  ).padStart(2, '0')}`;

  useEffect(() => {
    if (!showConeSettings) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const target = e.target as Node;
      if (!target) return;
      if (
        settingsPanelRef.current &&
        settingsPanelRef.current.contains(target)
      ) {
        return;
      }
      if (
        settingsButtonRef.current &&
        settingsButtonRef.current.contains(target)
      ) {
        return;
      }
      setShowConeSettings(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsideClick, true);
      document.addEventListener('touchstart', handleOutsideClick, true);
      document.addEventListener('click', handleOutsideClick, true);
    }, 40);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('touchstart', handleOutsideClick, true);
      document.removeEventListener('click', handleOutsideClick, true);
    };
  }, [showConeSettings]);

  const handleAddCone = (color: ConeColor) => {
    if (!court || !onUpdateCones) return;
    soundEffects.playRacketHit();
    const { cones: updated, currentConeIndex: nextIdx } = addConeToTurnQueue(
      court.cones || [],
      court.currentConeIndex || 0,
      color
    );
    onUpdateCones(court.courtNumber, updated, nextIdx);
  };

  const handleRemoveCone = (index: number) => {
    if (!court || !onUpdateCones) return;
    if ((court.cones || []).length <= 1) return;
    soundEffects.playRacketHit();
    const { cones: updated, currentConeIndex: nextIdx } = removeConeFromTurnQueue(
      court.cones || [],
      court.currentConeIndex || 0,
      index
    );
    onUpdateCones(court.courtNumber, updated, nextIdx);
  };

  const p1 = playersMap.get(match.teamA.player1Id);
  const p2 = playersMap.get(match.teamA.player2Id);
  const p3 = playersMap.get(match.teamB.player1Id);
  const p4 = playersMap.get(match.teamB.player2Id);

  const courtPlayers = [
    { player: p1, team: 'teamA' as const, slot: 1 as const },
    { player: p2, team: 'teamA' as const, slot: 2 as const },
    { player: p3, team: 'teamB' as const, slot: 1 as const },
    { player: p4, team: 'teamB' as const, slot: 2 as const },
  ];

  const isCompleted = match.status === 'completed';

  const handleFinish = () => {
    soundEffects.playWhistle();
    onCompleteMatch(match.id);
  };

  const handleFinishAndRotateTurn = () => {
    soundEffects.playWhistle();
    onCompleteMatch(match.id);
  };

  // Check if player is duplicated on another active court.
  // 나중에 코트에 배정된 선수/경기에게만 경고 표시 적용 (먼저 배정되어 있던 앞선 경기 선수는 경고 제외)
  const checkIsLaterDuplicate = (playerId: string) => {
    const matchesWithPlayer = (activeMatches || []).filter(
      (m) =>
        m.teamA.player1Id === playerId ||
        m.teamA.player2Id === playerId ||
        m.teamB.player1Id === playerId ||
        m.teamB.player2Id === playerId
    );
    if (matchesWithPlayer.length <= 1) return false;

    // 배정된 시점(playerAssignedAt 또는 startedAt)을 최우선 기준으로 오름차순 정렬
    // 먼저 배정된 경기(time이 작음)가 0번 인덱스 -> 앞순서이므로 경고 미표시 (false)
    // 나중에 코트에 배정된 경기(time이 큼) -> 뒷순서이므로 경고 표시 (true)
    const sorted = [...matchesWithPlayer].sort((a, b) => {
      const timeA = a.playerAssignedAt?.[playerId] ?? a.startedAt ?? 0;
      const timeB = b.playerAssignedAt?.[playerId] ?? b.startedAt ?? 0;
      if (timeA !== timeB) {
        return timeA - timeB; // 오름차순: 가장 먼저 배정된 경기 우선
      }
      // 시간까지 완전히 동일할 경우(동시 생성), 코트 번호 낮은 코트를 앞순서로 간주
      return a.courtNumber - b.courtNumber;
    });

    const earliestMatch = sorted[0];
    // 현재 경기가 가장 먼저 배정된 경기라면 경고 미표시 (false)
    // 나중에 배정된 경기라면 경고 표시 (true)
    return match.id !== earliestMatch.id;
  };

  const renderPlayerItem = (
    player: Player | undefined,
    team: 'teamA' | 'teamB',
    slot: 1 | 2,
    index: number
  ) => {
    // 4명의 선수 카드를 현재 2x2 위치에 고정하면서 중앙 동그라미 완료 버튼을 가리지 않도록 안쪽 모서리를 타원 모양으로 찌그림
    const cornerClass =
      index === 0
        ? 'court-player-corner-tl'
        : index === 1
        ? 'court-player-corner-tr'
        : index === 2
        ? 'court-player-corner-bl'
        : 'court-player-corner-br';

    // 이름·급수·배정/진행 텍스트가 타원형 모서리 쪽으로 밀려 들어가지 않도록
    // 타원 곡선 바깥 영역에만 위치하는 '보이지 않는 사각형 박스' 영역 정의 (좌측 열은 우측 타원 제외, 우측 열은 좌측 타원 제외)
    const isLeftColumn = index % 2 === 0;
    const innerRectBoxClass = isLeftColumn ? 'pr-6 sm:pr-7' : 'pl-6 sm:pl-7';

    if (!player) {
      return (
        <div
          key={index}
          className={`p-3 ${cornerClass} border border-dashed border-slate-700 text-slate-500 text-xs flex items-center`}
        >
          <div className={`w-full text-center ${innerRectBoxClass}`}>
            선수 미배정
          </div>
        </div>
      );
    }

    const isSelected =
      selectedSwap?.source === 'court' &&
      selectedSwap.matchId === match.id &&
      selectedSwap.team === team &&
      selectedSwap.slot === slot;
    const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;

    // 앞순서에 배정된 선수는 경고표시 제외, 뒷순서 중복 코트 또는 대기열 코트투입 중복 충돌 선수에게 표시
    const isDuplicate = checkIsLaterDuplicate(player.id) || conflictPlayerIds.includes(player.id);
    const isResting = player.specialStatus === 'resting';
    const isLesson = player.specialStatus === 'lesson';
    const isLastMatchDone = isPlayerLastMatchCompleted(player);
    const isLastMatchActive = player.specialStatus === 'last_match' && !isLastMatchDone;

    const cardBgClass = isSelected
      ? 'bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/50 shadow-md'
      : isDuplicate
      ? 'bg-orange-950/60 border-2 border-orange-500 ring-2 ring-orange-400/90 animate-pulse text-orange-100 shadow-lg shadow-orange-500/30'
      : isResting
      ? 'bg-slate-900/90 border-2 border-amber-500/80 ring-1 ring-amber-400/50 shadow-md shadow-amber-500/20'
      : isLesson
      ? 'bg-slate-900/90 border-2 border-indigo-500/80 ring-1 ring-indigo-400/50 shadow-md shadow-indigo-500/20'
      : isLastMatchDone
      ? 'bg-slate-900/80 border-2 border-slate-400/60 ring-1 ring-slate-400/30 animate-subtle-gray-glow'
      : isLastMatchActive
      ? 'bg-slate-900/90 border-2 border-rose-500/80 ring-1 ring-rose-400/50 shadow-md shadow-rose-500/20'
      : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700/80 hover:border-slate-600';

    return (
      <div
        key={player.id}
        data-player-swap-item="true"
        data-conflict-duplicate-player={isDuplicate ? 'true' : undefined}
        onClick={() => onSelectPlayerForSwap(player.id, match.id, team, slot)}
        className={`p-3 ${cornerClass} border transition-all cursor-pointer select-none touch-manipulation group relative overflow-hidden ${cardBgClass}`}
      >
        {/* Centered Gently Blinking Overlay when hovered, active/dragged, or selected */}
        {isSelected ? (
          <div className={`absolute inset-0 bg-slate-950/85 backdrop-blur-[2px] rounded-[inherit] flex items-center justify-center p-2 ${innerRectBoxClass} z-10 pointer-events-none`}>
            <div className="px-3 py-1.5 rounded-lg bg-amber-500/25 border border-amber-400 text-amber-300 text-xs font-bold flex items-center gap-1.5 animate-pulse shadow-lg shadow-amber-500/30">
              <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>교체 대상 선택</span>
            </div>
          </div>
        ) : (
          <div className={`absolute inset-0 bg-slate-950/80 backdrop-blur-[1.5px] rounded-[inherit] opacity-0 group-hover:opacity-100 group-active:opacity-100 flex items-center justify-center p-2 ${innerRectBoxClass} z-10 transition-opacity pointer-events-none`}>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-xs font-bold flex items-center gap-1.5 animate-pulse shadow-md shadow-emerald-500/25">
              <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>선수 교체</span>
            </div>
          </div>
        )}

        {/* 보이지 않는 사각형 박스: 타원형 모서리 영역으로 이름·급수가 밀려 들어가지 않도록 고정된 직사각형 내부에 정렬 */}
        <div className={`w-full flex flex-col justify-between ${innerRectBoxClass}`}>
          <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`font-bold text-sm truncate ${
                  isLastMatchDone
                    ? 'text-slate-300'
                    : player.gender === 'M'
                    ? 'text-blue-400'
                    : 'text-pink-400'
                }`}
              >
                {player.name}
              </span>
              <PartnerDot player={player} allPlayers={Array.from(playersMap.values())} size="sm" />
              {isDuplicate && (
                <span title="다른 코트와 중복 배정됨 (클릭하여 교체)" className="inline-flex shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0 animate-pulse" />
                </span>
              )}
              {isResting && (
                <span
                  title="현재 휴식중 상태인 선수입니다"
                  className="inline-flex items-center justify-center p-1 rounded-md bg-amber-500/25 border border-amber-400/80 text-amber-300 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)] shrink-0"
                >
                  <Coffee className="w-3 h-3 text-amber-400 shrink-0" />
                </span>
              )}
              {isLesson && (
                <span
                  title="현재 레슨중 상태인 선수입니다"
                  className="inline-flex items-center justify-center p-1 rounded-md bg-indigo-500/25 border border-indigo-400/80 text-indigo-300 animate-pulse shadow-[0_0_8px_rgba(129,140,248,0.5)] shrink-0"
                >
                  <GraduationCap className="w-3 h-3 text-indigo-300 shrink-0" />
                </span>
              )}
              {isLastMatchActive && (
                <span
                  title="마지막판(막판) 상태인 선수입니다"
                  className="inline-flex items-center justify-center p-1 rounded-md bg-rose-500/25 border border-rose-400/80 text-rose-300 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)] shrink-0"
                >
                  <Flag className="w-3 h-3 text-rose-300 shrink-0" />
                </span>
              )}
              {isLastMatchDone && (
                <span
                  title="마지막판 경기를 완료하여 퇴장 상태인 선수입니다"
                  className="inline-flex items-center justify-center p-1 rounded-md bg-slate-800/90 border border-slate-400/70 text-slate-200 shadow-[0_0_8px_rgba(148,163,184,0.4)] shrink-0"
                >
                  <DoorOpen className="w-3 h-3 text-slate-200 shrink-0" />
                </span>
              )}
            </div>

            <span
              className={`text-[10px] font-semibold shrink-0 ${tierMeta.color}`}
            >
              {tierMeta.short}
            </span>
          </div>

          {(() => {
            const activeCount = (activeMatches || []).filter(
              (m) =>
                m.teamA.player1Id === player.id ||
                m.teamA.player2Id === player.id ||
                m.teamB.player1Id === player.id ||
                m.teamB.player2Id === player.id
            ).length;

            const queuedCount = (queuedMatches || []).filter(
              (m) =>
                m.teamA.player1Id === player.id ||
                m.teamA.player2Id === player.id ||
                m.teamB.player1Id === player.id ||
                m.teamB.player2Id === player.id
            ).length;

            const totalAssigned = player.gamesPlayed + activeCount + queuedCount;

            return (
              <div className="mt-2 flex items-center justify-start text-[11px] text-slate-300 font-mono tabular-nums whitespace-nowrap overflow-hidden w-full">
                <span className="font-medium text-slate-300">
                  배정 {totalAssigned} / 진행 {player.gamesPlayed}
                </span>
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  const courtDisplayName = formatCourtName(
    extractCourtNumberLabel(court?.name || match.courtName, court?.courtNumber ?? match.courtNumber)
  );

  const cones = getNormalizedTurnQueue(court?.cones || [], court?.currentConeIndex || 0);
  const currentIdx = 0;

  // Duplicate player check on this court (앞순서에 배정된 선수는 경고표시 제외하고 뒷순서 코트에만 경고 적용)
  const duplicateCourtPlayers = [
    { p: playersMap.get(match.teamA.player1Id), team: 'teamA' as const, slot: 1 as const },
    { p: playersMap.get(match.teamA.player2Id), team: 'teamA' as const, slot: 2 as const },
    { p: playersMap.get(match.teamB.player1Id), team: 'teamB' as const, slot: 1 as const },
    { p: playersMap.get(match.teamB.player2Id), team: 'teamB' as const, slot: 2 as const },
  ].filter((item): item is { p: Player; team: 'teamA' | 'teamB'; slot: 1 | 2 } => {
    const p = item.p;
    if (!p) return false;
    return checkIsLaterDuplicate(p.id);
  });
  const hasDuplicate = duplicateCourtPlayers.length > 0;

  return (
    <div
      className={`relative rounded-2xl border transition-all overflow-hidden bg-slate-900/60 backdrop-blur-sm ${
        hasDuplicate
          ? 'border-orange-500 ring-2 ring-orange-500 shadow-xl shadow-orange-500/25'
          : isCompleted
          ? 'border-slate-800 opacity-80'
          : 'border-slate-700/80 shadow-lg shadow-black/20 hover:border-emerald-500/50'
      }`}
    >
      {/* Unified Single-Row Header on Mobile: Court Title + Turn + Cone Sequence + Actions */}
      <div className="px-3 sm:px-4 h-[42px] bg-slate-800/80 border-b border-slate-700/70 flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto touch-manipulation no-scrollbar relative z-30">
        {/* Left: Court Name + Turn status + Cone sequence (Strictly 1 line) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
          {/* Active Cone & Court Name */}
          <div className="flex items-center gap-1 shrink-0">
            <ConeIcon color="red" size="sm" isActive={true} />
            <CourtTitleBadge
              courtNumber={court?.courtNumber ?? match.courtNumber}
              courtName={court?.name || match.courtName}
              onRenameCourt={onRenameCourt}
            />
          </div>

          {/* Inline Cone Sequence Order (꼬깔 3개 이후부터 좌우 스크롤, 스크롤바 및 <,> 버튼 숨김) */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400 pl-1.5 border-l border-slate-700/80 shrink-0">
            <HeaderConeScroll cones={cones} currentIdx={currentIdx} />
          </div>
        </div>

        {/* Right: 경기 진행 시간 (설정 버튼 왼쪽에 밀착) + 설정 버튼 */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span
            title="현재 코트 경기 진행 시간 (분:초)"
            className="px-1.5 py-0.5 rounded bg-slate-900/90 border border-emerald-500/35 text-emerald-300 font-mono font-bold text-[10px] sm:text-[11px] tabular-nums tracking-tight inline-flex items-center gap-1 shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span>{formattedElapsed}</span>
          </span>
          {court && onUpdateCones && (
            <button
              ref={settingsButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                setShowConeSettings(!showConeSettings);
              }}
              title="꼬깔 순서 및 추가 설정"
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 border shrink-0 ${
                showConeSettings
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800/90 border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-700/80'
              }`}
            >
              <Settings2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
              <span>설정</span>
            </button>
          )}
        </div>
      </div>

      {/* Warning Alert if any player on this court is duplicated on another active court */}
      {hasDuplicate && (
        <div className="px-3.5 py-2.5 bg-orange-500/25 border-b-2 border-orange-500 text-orange-200 text-xs font-bold flex flex-wrap items-center justify-between gap-2 animate-pulse shadow-md shadow-orange-500/25">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 animate-bounce" />
            <span className="leading-tight">
              ⚠️ 타 선수와 교체
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const first = duplicateCourtPlayers[0];
              onSelectPlayerForSwap(first.p.id, match.id, first.team, first.slot);
            }}
            className="px-2.5 py-1 bg-orange-500 hover:bg-orange-400 text-slate-950 font-black text-[11px] rounded-lg transition-colors cursor-pointer shrink-0 shadow-sm"
          >
            선수 교체하기
          </button>
        </div>
      )}

      {/* Backdrop for closing settings when clicking/touching outside within court card */}
      {showConeSettings && (
        <div
          className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[0.5px]"
          onClick={(e) => {
            e.stopPropagation();
            setShowConeSettings(false);
          }}
        />
      )}

      {/* Expanded Cone Management Settings Panel Overlay (코트 기능 위에 덮어씌움) */}
      {showConeSettings && court && onUpdateCones && (
        <div
          ref={settingsPanelRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 top-[42px] bottom-0 z-30 overflow-y-auto p-3.5 bg-slate-950/95 backdrop-blur-md space-y-2.5 animate-in fade-in duration-150 rounded-b-2xl border-t border-slate-800"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Settings2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{courtDisplayName} 꼬깔(턴) 순서 설정</span>
            </span>
            {onRemoveCourt && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  soundEffects.playRacketHit();
                  setShowConeSettings(false);
                  onRemoveCourt(court?.courtNumber ?? match.courtNumber);
                }}
                className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 hover:text-rose-200 font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer active:scale-95 shrink-0"
                title="코트 삭제 - 배정된 경기는 완료 처리되어 대진 기록에 보존됩니다"
              >
                <Trash2 className="w-3 h-3 text-rose-400 shrink-0" />
                <span>코트 삭제</span>
              </button>
            )}
          </div>

          {/* Cone List & Delete (새로운 꼬깔 추가 시 뒤에서부터 생성, 꼬깔 순환 매커니즘 적용) */}
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
                      : 'bg-slate-900 border-slate-800 text-slate-300'
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

          {/* Revert to Previous Match Team Button (전 경기 팀으로 되돌리기 - 항상 활성화) */}
          {onRevertPreviousMatch && court && (
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  onRevertPreviousMatch(court.courtNumber);
                  setShowConeSettings(false);
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 shadow-sm active:scale-98"
                title={
                  hasPreviousMatch
                    ? '해당 코트의 직전 경기 팀으로 되돌리고 꼬깔과 대진기록을 복원합니다'
                    : '현재 배정된 팀을 게임목록 대기열로 되돌리고 빈 코트로 전환합니다 (꼬깔 이동 없음)'
                }
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>전 경기 팀으로 되돌리기</span>
                {previousMatchSummary && (
                  <span className="text-[10px] font-normal text-amber-400/90 truncate max-w-[150px]">
                    ({previousMatchSummary})
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      )}
      {/* Participants List (Clean 2x2 Grid: 가로두줄 세로두줄 고정 + 정중앙 동그라미 완료 버튼) */}
      <div className="p-3 sm:p-4 bg-gradient-to-b from-slate-900/40 via-slate-950/40 to-slate-950/80">
        <div className="relative grid grid-cols-2 gap-2 sm:gap-2.5">
          {courtPlayers.map((item, idx) =>
            renderPlayerItem(item.player, item.team, item.slot, idx)
          )}

          {/* 4명의 선수 카드 정중앙 동그라미 완료 버튼 */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center">
            {!isCompleted ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFinishAndRotateTurn();
                }}
                title="경기 완료 후 다음 꼬깔(턴)으로 자동 회전합니다"
                className="pointer-events-auto w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 active:scale-90 text-white font-black text-[11px] sm:text-xs shadow-[0_0_14px_rgba(239,68,68,0.45)] hover:shadow-[0_0_20px_rgba(239,68,68,0.75)] border-2 border-slate-950 ring-1 ring-red-400/60 transition-all flex flex-col items-center justify-center leading-none gap-0.5 whitespace-nowrap cursor-pointer select-none"
              >
                <Check className="w-3.5 h-3.5 stroke-[3] shrink-0" />
                <span>완료</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResetMatch(match.id);
                }}
                title="다시 진행"
                className="pointer-events-auto w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 hover:bg-slate-700 active:scale-90 text-slate-200 font-bold text-[10px] sm:text-[11px] shadow-lg border-2 border-slate-950 ring-1 ring-slate-600 transition-all flex items-center justify-center leading-tight text-center cursor-pointer select-none"
              >
                <span>다시<br />진행</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
