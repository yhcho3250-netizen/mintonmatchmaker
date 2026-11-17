import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  CourtInfo,
  CourtMatch,
  Player,
  MatchOptions,
  ConeItem,
  ConeColor,
  isPlayerLastMatchCompleted,
  extractCourtNumberLabel,
  formatCourtName,
  getNormalizedTurnQueue,
  addConeToTurnQueue,
  removeConeFromTurnQueue,
  formatConeTurnSequence,
} from '../types';
import {
  Sparkles,
  Play,
  Clock,
  RotateCcw,
  Settings2,
  Trash2,
  Coffee,
  GraduationCap,
  Flag,
  DoorOpen,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { generateSingleCourtMatch, isSpecialMatchTurnReady } from '../utils/matchmaker';
import { ConeIcon } from './ConeIcon';
import { CourtTitleBadge } from './CourtTitleBadge';
import { HeaderConeScroll } from './HeaderConeScroll';
import { DragScrollContainer } from './DragScrollContainer';
import { PartnerDot } from './PartnerDot';

interface EmptyCourtCardProps {
  court: CourtInfo;
  queuedMatches: CourtMatch[];
  restingPlayers: Player[];
  playersMap: Map<string, Player>;
  allPlayers?: Player[];
  options?: MatchOptions;
  activeMatches?: CourtMatch[];
  currentRound?: number;
  onAssignQueueToCourt: (matchId: string, courtNumber: number) => void;
  onGenerateForCourt: (courtNumber: number, pregeneratedMatch?: CourtMatch) => void;
  onRemoveCourt: (courtNumber: number) => void;
  onRenameCourt: (courtNumber: number, newName: string) => void;
  onAdvanceTurn: (courtNumber: number) => void;
  onUpdateCones: (courtNumber: number, cones: ConeItem[], currentConeIndex: number) => void;
  selectedBenchPlayersCount?: number;
  onAssignSelectedToThisCourt?: (courtNumber: number) => void;
  onRevertPreviousMatch?: (courtNumber: number) => void;
  onOpenAssignQueueModal?: (courtNumber: number) => void;
  hasPreviousMatch?: boolean;
  previousMatchSummary?: string;
}

export const EmptyCourtCard: React.FC<EmptyCourtCardProps> = ({
  court,
  queuedMatches,
  restingPlayers,
  playersMap,
  allPlayers = [],
  options,
  activeMatches = [],
  currentRound = 0,
  onAssignQueueToCourt,
  onGenerateForCourt,
  onRemoveCourt,
  onRenameCourt,
  onAdvanceTurn,
  onUpdateCones,
  selectedBenchPlayersCount = 0,
  onAssignSelectedToThisCourt,
  onRevertPreviousMatch,
  onOpenAssignQueueModal,
  hasPreviousMatch,
  previousMatchSummary,
}) => {
  const [showConeSettings, setShowConeSettings] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

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

  const [isTouched, setIsTouched] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isButtonInteractable, setIsButtonInteractable] = useState(false);
  const touchRevealTimeRef = useRef<number>(0);

  // When isTouched becomes true on mobile, delay button interactivity by 350ms to prevent ghost clicks
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isTouched) {
      touchRevealTimeRef.current = Date.now();
      timer = setTimeout(() => {
        setIsButtonInteractable(true);
      }, 350);
    } else {
      setIsButtonInteractable(false);
    }
    return () => clearTimeout(timer);
  }, [isTouched]);

  const canClickAction = () => {
    if (isHovered) return true;
    if (!isButtonInteractable) return false;
    if (Date.now() - touchRevealTimeRef.current < 400) return false;
    return true;
  };

  const isPlayerActiveOnOtherCourt = (playerId: string): boolean => {
    if (!activeMatches) return false;
    return activeMatches.some(
      (m) =>
        Number(m.courtNumber) !== Number(court.courtNumber) &&
        m.status !== 'completed' &&
        (m.teamA.player1Id === playerId ||
          m.teamA.player2Id === playerId ||
          m.teamB.player1Id === playerId ||
          m.teamB.player2Id === playerId)
    );
  };

  const [selectedQueueId, setSelectedQueueId] = useState<string>(
    queuedMatches.length > 0 ? queuedMatches[0].id : ''
  );

  const eligibleRestingCount = restingPlayers.filter((p) => {
    if (
      !p.isActive ||
      p.specialStatus === 'resting' ||
      p.specialStatus === 'lesson' ||
      isPlayerLastMatchCompleted(p)
    ) {
      return false;
    }
    if (p.specialStatus === 'last_match') {
      const inQueue = queuedMatches.some(
        (m) =>
          !m.isSpecialMatch &&
          (m.teamA.player1Id === p.id ||
            m.teamA.player2Id === p.id ||
            m.teamB.player1Id === p.id ||
            m.teamB.player2Id === p.id)
      );
      if (inQueue) return false;
    }
    return true;
  }).length;

  const canGenerate = eligibleRestingCount >= 4;

  const expectedMatchPreview = useMemo(() => {
    if (!canGenerate) return null;
    try {
      const roster = (
        allPlayers.length > 0
          ? allPlayers
          : restingPlayers
      ).filter((p) => !p.attendancePending);
      const alreadyPlayingIds = new Set<string>();
      (activeMatches || []).forEach((m) => {
        if (m.status !== 'completed') {
          [m.teamA?.player1Id, m.teamA?.player2Id, m.teamB?.player1Id, m.teamB?.player2Id].forEach((id) => {
            if (id) alreadyPlayingIds.add(id);
          });
        }
      });

      const { match } = generateSingleCourtMatch(
        roster,
        options || ({ mode: 'balanced' } as MatchOptions),
        (currentRound || 0) + 1,
        court.courtNumber,
        alreadyPlayingIds,
        queuedMatches || [],
        activeMatches || [],
        true
      );

      const pA1 = playersMap.get(match.teamA.player1Id) || roster.find((p) => p.id === match.teamA.player1Id);
      const pA2 = playersMap.get(match.teamA.player2Id) || roster.find((p) => p.id === match.teamA.player2Id);
      const pB1 = playersMap.get(match.teamB.player1Id) || roster.find((p) => p.id === match.teamB.player1Id);
      const pB2 = playersMap.get(match.teamB.player2Id) || roster.find((p) => p.id === match.teamB.player2Id);

      if (pA1 && pA2 && pB1 && pB2) {
        return { pA1, pA2, pB1, pB2, match };
      }
    } catch (err) {
      // Fallback
    }
    return null;
  }, [canGenerate, allPlayers, playersMap, restingPlayers, activeMatches, options, currentRound, court.courtNumber, queuedMatches]);

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

  const rosterForSpecial = useMemo(
    () => (allPlayers.length > 0 ? allPlayers : restingPlayers).filter((p) => !p.attendancePending),
    [allPlayers, restingPlayers]
  );

  const normalQueuedMatches = useMemo(
    () => queuedMatches.filter((m) => !m.isSpecialMatch),
    [queuedMatches]
  );

  const deployableQueuedMatches = useMemo(
    () =>
      queuedMatches.filter(
        (m) =>
          !m.isSpecialMatch ||
          isSpecialMatchTurnReady(m, rosterForSpecial, activeMatches, queuedMatches, options)
      ),
    [queuedMatches, rosterForSpecial, activeMatches, options]
  );

  const readySpecialMatch = useMemo(
    () => deployableQueuedMatches.find((m) => Boolean(m.isSpecialMatch)),
    [deployableQueuedMatches]
  );

  const firstDeployableMatch = deployableQueuedMatches[0];
  const isFirstDeployableSpecial = Boolean(firstDeployableMatch?.isSpecialMatch);
  const nextNormalQueuedMatch = normalQueuedMatches[0];

  const getPlayer = (id: string) => playersMap.get(id);

  const cones = getNormalizedTurnQueue(court.cones || [], court.currentConeIndex || 0);
  const currentIdx = 0;
  const courtDisplayName = formatCourtName(extractCourtNumberLabel(court.name, court.courtNumber));

  return (
    <div
      onClick={() => {
        if (showConeSettings) {
          setShowConeSettings(false);
          return;
        }
        if (!isTouched) {
          setIsTouched(true);
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsTouched(false);
      }}
      className="group relative rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 backdrop-blur-sm overflow-hidden flex flex-col justify-between transition-all hover:border-emerald-500/40 select-none touch-manipulation cursor-pointer"
    >
      {/* Unified Single-Row Header on Mobile: Court Title + Cone Sequence + Actions */}
      <div className="px-3 sm:px-4 h-[42px] bg-slate-800/80 border-b border-slate-700/70 flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto touch-manipulation no-scrollbar">
        {/* Left: Court Name + Cone sequence (Strictly 1 line, no 빈코트 badge) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            <ConeIcon color="red" size="sm" isActive={true} />
            <CourtTitleBadge
              courtNumber={court.courtNumber}
              courtName={court.name}
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
            title="경기 대기 중 (경기 시작 시 진행 시간 표시)"
            className="px-1.5 py-0.5 rounded bg-slate-900/80 border border-slate-700/80 text-slate-400 font-mono font-bold text-[10px] sm:text-[11px] tabular-nums tracking-tight inline-flex items-center gap-1 shrink-0"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
            <span>00:00</span>
          </span>
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
        </div>
      </div>

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
      {showConeSettings && (
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
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                soundEffects.playRacketHit();
                setShowConeSettings(false);
                onRemoveCourt(court.courtNumber);
              }}
              className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 hover:text-rose-200 font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer active:scale-95 shrink-0"
              title="코트 삭제"
            >
              <Trash2 className="w-3 h-3 text-rose-400 shrink-0" />
              <span>코트 삭제</span>
            </button>
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
          {onRevertPreviousMatch && (
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  onRevertPreviousMatch(court.courtNumber);
                  setShowConeSettings(false);
                  setIsTouched(false);
                  setIsHovered(false);
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 shadow-sm active:scale-98"
                title={
                  hasPreviousMatch
                    ? '해당 코트의 직전 경기 팀으로 되돌리고 꼬깔과 대진기록을 복원합니다'
                    : '대진기록에 해당 코트의 전 경기가 없습니다'
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

      {/* Court Interior Simulation / Slot Area with Hover/Touch Action Overlay */}
      <div className="relative min-h-[190px] p-4 sm:p-5 flex-1 flex flex-col justify-center items-center text-center space-y-2.5 overflow-hidden">
        {/* Base Background: Badminton racket & Status text */}
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl shrink-0">
          🏸
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-300">
            경기가 배정되지 않았습니다
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            {isFirstDeployableSpecial && readySpecialMatch
              ? '스페셜 경기 투입 차례가 되었습니다!'
              : nextNormalQueuedMatch
              ? '대기 1순위 경기가 대기 중입니다'
              : '대기 중인 경기가 없습니다'}
          </p>
        </div>

        {/* Hover / Touch Overlay (경기가 배정되지 않았습니다 문구를 덮으며 표시) */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            setIsTouched(false);
          }}
          className={`absolute inset-0 z-20 p-4 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center transition-all duration-200 ${
            isTouched || isHovered
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
        >
          {isFirstDeployableSpecial && readySpecialMatch ? (
            /* 스페셜 게임이 대기열의 현재 입장할 순서(1순위)에 도달했을 때: 무지개 오로라 애니메이션 배너 + '스페셜 경기 즉시 투입' 버튼 표시 */
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-sm animate-rainbow-aurora-card rounded-xl p-3 text-left space-y-2 transition-all ${
                isHovered || isButtonInteractable ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-white font-extrabold">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-200 animate-spin" style={{ animationDuration: '5s' }} />
                  <span>스페셜 대기 경기</span>
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-950/60 border border-white/30 text-amber-200 font-bold">
                  출전 차례 도착
                </span>
              </div>

              <div className="text-xs text-slate-300 flex items-center justify-center flex-wrap gap-1 sm:gap-1.5 py-0.5 w-full mx-auto">
                {[
                  getPlayer(readySpecialMatch.teamA.player1Id),
                  getPlayer(readySpecialMatch.teamA.player2Id),
                  getPlayer(readySpecialMatch.teamB.player1Id),
                  getPlayer(readySpecialMatch.teamB.player2Id),
                ].map((p, idx) => {
                  if (!p) return null;
                  const isLastDone = isPlayerLastMatchCompleted(p);
                  const isLastActive = p.specialStatus === 'last_match' && !isLastDone;
                  const isDuplicate = isPlayerActiveOnOtherCourt(p.id);

                  return (
                    <React.Fragment key={p.id || idx}>
                      {idx > 0 && (
                        <span className="text-white/60 text-xs font-bold shrink-0 mx-0.5">•</span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[11px] font-bold flex items-center gap-1 transition-all shrink-0 ${
                          isDuplicate
                            ? 'bg-orange-950/90 border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)] ring-1 ring-orange-400/80 animate-pulse'
                            : 'bg-slate-950/90 border-white/25'
                        }`}
                        title={
                          isDuplicate
                            ? `${p.name} (현재 다른 코트에 배정되어 진행 중입니다)`
                            : p.name
                        }
                      >
                        <span
                          className={
                            isLastDone
                              ? 'text-slate-400'
                              : p.gender === 'M'
                              ? 'text-blue-400'
                              : 'text-pink-400'
                          }
                        >
                          {p.name}
                        </span>
                        <PartnerDot player={p} allPlayers={Array.from(playersMap.values())} size="xs" />
                        {p.specialStatus === 'resting' && (
                          <Coffee className="w-2.5 h-2.5 text-amber-400 animate-pulse shrink-0" />
                        )}
                        {p.specialStatus === 'lesson' && (
                          <GraduationCap className="w-2.5 h-2.5 text-indigo-400 animate-pulse shrink-0" />
                        )}
                        {isLastActive && (
                          <Flag className="w-2.5 h-2.5 text-rose-400 animate-pulse shrink-0" />
                        )}
                        {isLastDone && (
                          <DoorOpen className="w-2.5 h-2.5 text-slate-300 shrink-0" />
                        )}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canClickAction()) return;
                  onAssignQueueToCourt(readySpecialMatch.id, court.courtNumber);
                }}
                className="w-full py-2.5 px-3 animate-rainbow-aurora-btn active:scale-98 text-white font-black text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>스페셜 경기 즉시 투입</span>
              </button>

              {onOpenAssignQueueModal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canClickAction()) return;
                    soundEffects.playRacketHit();
                    onOpenAssignQueueModal(court.courtNumber);
                  }}
                  className="w-full py-1.5 px-3 bg-slate-950/90 hover:bg-slate-900 border border-white/25 hover:border-amber-400/60 text-amber-200 font-semibold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-300" />
                  <span>배정선수관리 (대기 1~5번 경기 선택)</span>
                </button>
              )}
            </div>
          ) : nextNormalQueuedMatch ? (
            /* 일반 대기 1순위 경기가 있을 때 */
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-sm bg-slate-900 border border-amber-500/40 rounded-xl p-3 text-left space-y-2 shadow-2xl transition-all ${
                isHovered || isButtonInteractable ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-amber-300 font-semibold">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  대기 1순위 경기
                </span>
                <span className="text-[10px] text-slate-400">
                  총 {normalQueuedMatches.length}경기 대기 중
                </span>
              </div>

              <div className="text-xs text-slate-300 flex items-center justify-center flex-wrap gap-1 sm:gap-1.5 py-0.5 w-full mx-auto">
                {[
                  getPlayer(nextNormalQueuedMatch.teamA.player1Id),
                  getPlayer(nextNormalQueuedMatch.teamA.player2Id),
                  getPlayer(nextNormalQueuedMatch.teamB.player1Id),
                  getPlayer(nextNormalQueuedMatch.teamB.player2Id),
                ].map((p, idx) => {
                  if (!p) return null;
                  const isLastDone = isPlayerLastMatchCompleted(p);
                  const isLastActive = p.specialStatus === 'last_match' && !isLastDone;
                  const isDuplicate = isPlayerActiveOnOtherCourt(p.id);

                  return (
                    <React.Fragment key={p.id || idx}>
                      {idx > 0 && (
                        <span className="text-slate-600 text-xs font-bold shrink-0 mx-0.5">•</span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[11px] font-bold flex items-center gap-1 transition-all shrink-0 ${
                          isDuplicate
                            ? 'bg-orange-950/80 border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)] ring-1 ring-orange-400/80 animate-pulse'
                            : isLastDone
                            ? 'bg-slate-950 border-slate-800'
                            : 'bg-slate-950 border-slate-800'
                        }`}
                        title={
                          isDuplicate
                            ? `${p.name} (현재 다른 코트에 배정되어 진행 중입니다)`
                            : p.name
                        }
                      >
                        <span
                          className={
                            isLastDone
                              ? 'text-slate-400'
                              : p.gender === 'M'
                              ? 'text-blue-400'
                              : 'text-pink-400'
                          }
                        >
                          {p.name}
                        </span>
                        <PartnerDot player={p} allPlayers={Array.from(playersMap.values())} size="xs" />
                        {p.specialStatus === 'resting' && (
                          <Coffee className="w-2.5 h-2.5 text-amber-400 animate-pulse shrink-0" />
                        )}
                        {p.specialStatus === 'lesson' && (
                          <GraduationCap className="w-2.5 h-2.5 text-indigo-400 animate-pulse shrink-0" />
                        )}
                        {isLastActive && (
                          <Flag className="w-2.5 h-2.5 text-rose-400 animate-pulse shrink-0" />
                        )}
                        {isLastDone && (
                          <DoorOpen className="w-2.5 h-2.5 text-slate-300 shrink-0" />
                        )}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canClickAction()) return;
                  onAssignQueueToCourt(nextNormalQueuedMatch.id, court.courtNumber);
                }}
                className="w-full py-2 px-3 bg-amber-400 hover:bg-amber-300 active:scale-98 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md shadow-amber-500/25 flex items-center justify-center gap-1.5 cursor-pointer mt-1"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>이 대기 경기 즉시 투입하기</span>
              </button>

              {readySpecialMatch && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canClickAction()) return;
                    onAssignQueueToCourt(readySpecialMatch.id, court.courtNumber);
                  }}
                  className="w-full py-2 px-3 animate-rainbow-aurora-btn active:scale-98 text-white font-black text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                  title="출전 순서가 도래한 스페셜 경기를 이 코트에 즉시 투입합니다"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-200 animate-spin shrink-0" style={{ animationDuration: '5s' }} />
                  <span>스페셜 경기 즉시 투입</span>
                </button>
              )}

              {onOpenAssignQueueModal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canClickAction()) return;
                    soundEffects.playRacketHit();
                    onOpenAssignQueueModal(court.courtNumber);
                  }}
                  className="w-full py-1.5 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 text-amber-300 font-semibold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>배정선수관리 (대기 1~5번 경기 선택)</span>
                </button>
              )}
            </div>
          ) : (
            /* 일반 대기열이 없고 스페셜 경기도 아직 차례가 안 되었을 때: 이 코트 투입 예상 선수 (4명) + 이 코트 경기 자동 생성 그대로 진행 */
            <div
              onClick={(e) => e.stopPropagation()}
              className={`flex flex-col items-center gap-2 transition-all ${
                isHovered || isButtonInteractable ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
              {/* Expected 4 Players Preview Box (자동 생성 버튼 바로 위 - A팀/B팀/VS 없이 한줄 표시, 내용에 맞춰 좌우 너비 자동조정) */}
              {canGenerate && expectedMatchPreview && (
                <div className="w-fit max-w-full px-3 py-2 rounded-xl bg-slate-900/95 border border-emerald-500/40 shadow-xl shadow-black/60 flex flex-col items-center gap-1.5 animate-in fade-in duration-150 mb-1 mx-auto">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 whitespace-nowrap">
                    <Sparkles className="w-3.5 h-3.5 fill-emerald-400/20 text-emerald-400 shrink-0" />
                    <span>이 코트 투입 예상 선수 (4명)</span>
                  </div>

                  <div className="w-fit bg-slate-950/70 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap overflow-hidden">
                    <span className={expectedMatchPreview.pA1.gender === 'M' ? 'text-blue-400' : 'text-pink-400'}>
                      {expectedMatchPreview.pA1.name}
                    </span>
                    <span className="text-slate-600 text-[10px]">•</span>
                    <span className={expectedMatchPreview.pA2.gender === 'M' ? 'text-blue-400' : 'text-pink-400'}>
                      {expectedMatchPreview.pA2.name}
                    </span>
                    <span className="text-slate-600 text-[10px]">•</span>
                    <span className={expectedMatchPreview.pB1.gender === 'M' ? 'text-blue-400' : 'text-pink-400'}>
                      {expectedMatchPreview.pB1.name}
                    </span>
                    <span className="text-slate-600 text-[10px]">•</span>
                    <span className={expectedMatchPreview.pB2.gender === 'M' ? 'text-blue-400' : 'text-pink-400'}>
                      {expectedMatchPreview.pB2.name}
                    </span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canClickAction()) return;
                  soundEffects.playRacketHit();
                  onGenerateForCourt(court.courtNumber, expectedMatchPreview?.match);
                }}
                disabled={!canGenerate}
                className={`py-3 px-5 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-xl active:scale-95 cursor-pointer ${
                  canGenerate
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30 ring-2 ring-emerald-400/50'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
                title={
                  canGenerate
                    ? '대기 중인 참가자 중 4명을 선발하여 이 코트에 즉시 편성합니다'
                    : '대기 중인 활동 선수가 4명 이상이어야 합니다'
                }
              >
                <Sparkles className="w-4 h-4 fill-current shrink-0" />
                <span>
                  {canGenerate
                    ? '이 코트 경기 자동 생성'
                    : `대기 선수 부족 (${eligibleRestingCount}/4명)`}
                </span>
              </button>
              {canGenerate && (
                <span className="text-[11px] text-slate-400">
                  클릭 시 대기 인원으로 즉시 경기 편성 및 시작
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action Footer: Only shown if bench players are selected */}
      {selectedBenchPlayersCount > 0 && onAssignSelectedToThisCourt && (
        <div className="p-3 bg-slate-950/70 border-t border-slate-800/80">
          <button
            type="button"
            data-bench-assign-btn="true"
            onClick={(e) => {
              e.stopPropagation();
              soundEffects.playWhistle();
              onAssignSelectedToThisCourt(court.courtNumber);
            }}
            className="w-full py-2 px-3 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-md shadow-emerald-500/20 active:scale-98"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{selectedBenchPlayersCount}명 이 코트에 배정</span>
          </button>
        </div>
      )}
    </div>
  );
};
