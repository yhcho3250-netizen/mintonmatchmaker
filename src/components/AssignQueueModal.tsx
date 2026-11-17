import React, { useMemo } from 'react';
import { CourtMatch, Player, MatchOptions, TIER_LABELS, isPlayerLastMatchCompleted, extractCourtNumberLabel, formatCourtName } from '../types';
import { X, Play, Clock, Sparkles, Users, AlertTriangle, Flag, Coffee, GraduationCap, DoorOpen, Scale, Shuffle, Users2, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { PartnerDot } from './PartnerDot';
import { DragScrollContainer } from './DragScrollContainer';
import { soundEffects } from '../utils/audio';
import { generateSingleCourtMatch, isSpecialMatchTurnReady } from '../utils/matchmaker';

interface AssignQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  courtNumber: number;
  courtName?: string;
  queuedMatches: CourtMatch[];
  activeMatches: CourtMatch[];
  playersMap: Map<string, Player>;
  allPlayers?: Player[];
  options?: MatchOptions;
  currentRound?: number;
  onOpenGenerateModal?: () => void;
  onSelectMatch: (matchId: string, courtNumber: number) => void;
  onAutoGenerateForCourt?: (courtNumber: number, pregeneratedMatch?: CourtMatch) => void;
}

export const AssignQueueModal: React.FC<AssignQueueModalProps> = ({
  isOpen,
  onClose,
  courtNumber,
  courtName,
  queuedMatches,
  activeMatches,
  playersMap,
  allPlayers = [],
  options,
  currentRound = 1,
  onOpenGenerateModal,
  onSelectMatch,
  onAutoGenerateForCourt,
}) => {
  if (!isOpen) return null;

  const displayCourtName = formatCourtName(extractCourtNumberLabel(courtName, courtNumber));

  const rosterForSpecial = useMemo(
    () =>
      (allPlayers.length > 0 ? allPlayers : Array.from(playersMap.values())).filter(
        (p) => !p.attendancePending
      ),
    [allPlayers, playersMap]
  );

  // 대기열에 정렬된 대기순서 그대로 일반 대기 경기 및 투입 차례가 도래한 스페셜 경기를 후보로 추출 (차례가 안 된 스페셜 대기 경기는 제외)
  const candidateMatches = useMemo(() => {
    return queuedMatches
      .filter(
        (m) =>
          !m.isSpecialMatch ||
          isSpecialMatchTurnReady(m, rosterForSpecial, activeMatches, queuedMatches, options)
      )
      .slice(0, 5);
  }, [queuedMatches, rosterForSpecial, activeMatches, options]);

  const expectedMatchPreview = useMemo(() => {
    if (!options || candidateMatches.length > 0) return null;
    const playerList = allPlayers.filter((p) => !p.attendancePending);
    if (playerList.length < 4) return null;

    const playingPlayerIds = new Set<string>();
    activeMatches.forEach(m => {
      if (m.status !== 'completed') {
        playingPlayerIds.add(m.teamA.player1Id);
        playingPlayerIds.add(m.teamA.player2Id);
        playingPlayerIds.add(m.teamB.player1Id);
        playingPlayerIds.add(m.teamB.player2Id);
      }
    });

    try {
      const res = generateSingleCourtMatch(
        playerList,
        options,
        (currentRound || 0) + 1,
        courtNumber,
        playingPlayerIds,
        queuedMatches,
        activeMatches,
        true
      );
      if (res && res.match) {
        const pA1 = playersMap.get(res.match.teamA.player1Id) || playerList.find(p => p.id === res.match.teamA.player1Id);
        const pA2 = playersMap.get(res.match.teamA.player2Id) || playerList.find(p => p.id === res.match.teamA.player2Id);
        const pB1 = playersMap.get(res.match.teamB.player1Id) || playerList.find(p => p.id === res.match.teamB.player1Id);
        const pB2 = playersMap.get(res.match.teamB.player2Id) || playerList.find(p => p.id === res.match.teamB.player2Id);
        if (pA1 && pA2 && pB1 && pB2) {
          return { pA1, pA2, pB1, pB2, match: res.match };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }, [allPlayers, playersMap, options, currentRound, courtNumber, activeMatches, queuedMatches, candidateMatches.length]);

  // 다른 코트에 이미 배정(진행) 중인지 확인하는 함수
  const isPlayerActiveOnOtherCourt = (playerId: string): boolean => {
    return activeMatches.some(
      (m) =>
        Number(m.courtNumber) !== Number(courtNumber) &&
        m.status !== 'completed' &&
        (m.teamA.player1Id === playerId ||
          m.teamA.player2Id === playerId ||
          m.teamB.player1Id === playerId ||
          m.teamB.player2Id === playerId)
    );
  };

  const renderPlayer = (playerId: string) => {
    const player = playersMap.get(playerId);
    if (!player) return <span className="text-slate-500 text-xs">미배정</span>;
    const tierMeta = TIER_LABELS[player.tier] || TIER_LABELS.Beginner;
    const isDuplicate = isPlayerActiveOnOtherCourt(player.id);
    const isLastMatchDone = isPlayerLastMatchCompleted(player);

    return (
      <div
        key={player.id}
        className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg border text-[11px] sm:text-xs transition-all shrink-0 ${
          isDuplicate
            ? 'border-orange-500 bg-orange-950/60 shadow-[0_0_12px_rgba(249,115,22,0.65)] ring-2 ring-orange-400/80 animate-pulse'
            : isLastMatchDone
            ? 'border-slate-400/60 ring-1 ring-slate-400/30 bg-slate-900/90 text-slate-200 animate-subtle-gray-glow'
            : 'border-slate-800 bg-slate-900/90 text-slate-200'
        }`}
        title={
          isDuplicate
            ? `${player.name} (현재 다른 코트에 배정되어 진행 중입니다)`
            : player.name
        }
      >
        <span
          className={`font-bold whitespace-nowrap ${
            isLastMatchDone
              ? 'text-slate-300'
              : player.gender === 'M'
              ? 'text-blue-400'
              : 'text-pink-400'
          }`}
        >
          {player.name}
        </span>
        <PartnerDot
          player={player}
          allPlayers={allPlayers.length > 0 ? allPlayers : Array.from(playersMap.values())}
          size="xs"
        />
        {player.specialStatus === 'last_match' && !isLastMatchDone && (
          <span
            title="마지막판!"
            className="inline-flex items-center justify-center p-0.5 rounded bg-rose-500/25 text-rose-300 border border-rose-400/60 animate-pulse shrink-0"
          >
            <Flag className="w-2.5 h-2.5 text-rose-300" />
          </span>
        )}
        {isLastMatchDone && (
          <span
            title="퇴장(마지막판 완료)"
            className="inline-flex items-center justify-center p-0.5 rounded bg-slate-800 text-slate-200 border border-slate-400/70 shadow-[0_0_8px_rgba(148,163,184,0.4)] shrink-0"
          >
            <DoorOpen className="w-2.5 h-2.5 text-slate-200" />
          </span>
        )}
        {player.specialStatus === 'resting' && (
          <span
            title="휴식"
            className="inline-flex items-center justify-center p-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-400/60 animate-pulse shrink-0"
          >
            <Coffee className="w-2.5 h-2.5 text-amber-300" />
          </span>
        )}
        {player.specialStatus === 'lesson' && (
          <span
            title="레슨"
            className="inline-flex items-center justify-center p-0.5 rounded bg-indigo-500/25 text-indigo-300 border border-indigo-400/60 animate-pulse shrink-0"
          >
            <GraduationCap className="w-2.5 h-2.5 text-indigo-300" />
          </span>
        )}
      </div>
    );
  };

  const handleSelect = (matchId: string) => {
    onSelectMatch(matchId, courtNumber);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-fit max-w-full max-h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50 gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Users className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 whitespace-nowrap">
                <span>배정선수관리</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                  {displayCourtName}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {options && (
              <button
                type="button"
                onClick={() => {
                  if (onOpenGenerateModal) {
                    onClose();
                    onOpenGenerateModal();
                  }
                }}
                title="클릭하여 복식 조 편성 방식 변경"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-white transition-all cursor-pointer text-[11px] whitespace-nowrap"
              >
                {options.mode === 'balanced' ? (
                  <>
                    <Scale className="w-3 h-3 text-emerald-400" />
                    <span className="font-bold text-emerald-400">실력 밸런스</span>
                  </>
                ) : options.mode === 'random' ? (
                  <>
                    <Shuffle className="w-3 h-3 text-emerald-400" />
                    <span className="font-bold text-emerald-400">완전 랜덤</span>
                  </>
                ) : options.mode === 'doubles_only' ? (
                  <>
                    <Users className="w-3 h-3 text-emerald-400" />
                    <span className="font-bold text-emerald-400">복식 우선</span>
                  </>
                ) : (
                  <>
                    <Users2 className="w-3 h-3 text-emerald-400" />
                    <span className="font-bold text-emerald-400">혼복 우선</span>
                  </>
                )}
                {onOpenGenerateModal && <SlidersHorizontal className="w-2.5 h-2.5 text-slate-400 ml-0.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer hover:bg-slate-800"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-3.5 sm:p-4 overflow-y-auto space-y-2.5 flex-1">
          {candidateMatches.length === 0 ? (
            <div className="p-5 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 w-fit max-w-full mx-auto">
              <Clock className="w-7 h-7 text-slate-600 mx-auto mb-2" />
              <div className="text-sm font-semibold text-slate-300">
                대기열에 대기 중인 경기가 없습니다
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                현재 대기 중인 참가자들을 기반으로 {displayCourtName}의 다음 복식 경기를 바로 자동 생성할 수 있습니다.
              </p>
              {onAutoGenerateForCourt && (
                <div className="mt-3.5 flex flex-col items-center gap-2.5">
                  {expectedMatchPreview && (
                    <div className="w-fit max-w-full bg-slate-900/90 border border-emerald-500/30 rounded-xl p-2.5 shadow-md text-center mx-auto">
                      <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-emerald-400 mb-1.5 pb-1 border-b border-emerald-500/20 whitespace-nowrap">
                        <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>이 코트 투입 예상 선수 (4명)</span>
                        <span className="text-[10px] text-slate-400 font-normal ml-0.5">(자동 편성 기준)</span>
                      </div>
                      <div className="w-fit mx-auto bg-slate-950/70 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center justify-center gap-2 text-xs font-bold whitespace-nowrap overflow-hidden">
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
                    onClick={() => {
                      onAutoGenerateForCourt(courtNumber, expectedMatchPreview?.match);
                      onClose();
                    }}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer inline-flex items-center gap-1.5 active:scale-95"
                    title={`${displayCourtName} 경기를 대기 인원으로 자동 편성하여 즉시 시작합니다`}
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-current" />
                    <span>이 코트 경기 자동 생성</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 w-fit max-w-full mx-auto">
              <div className="text-[11px] text-slate-400 flex items-center justify-between gap-4 px-1">
                <span>선택 가능한 대기 경기 (총 {candidateMatches.length}개)</span>
                <span className="text-[10px] text-orange-300 font-medium flex items-center gap-1 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
                  주황색 발광: 타 코트 진행 중 선수
                </span>
              </div>

              {candidateMatches.map((match, idx) => {
                const matchOrder = idx + 1;
                const isSpecial = Boolean(match.isSpecialMatch);
                const p1 = playersMap.get(match.teamA.player1Id);
                const p2 = playersMap.get(match.teamA.player2Id);
                const p3 = playersMap.get(match.teamB.player1Id);
                const p4 = playersMap.get(match.teamB.player2Id);

                const hasDuplicatePlayer = [p1, p2, p3, p4].some(
                  (p) => p && isPlayerActiveOnOtherCourt(p.id)
                );

                return (
                  <div
                    key={match.id}
                    className={`p-2.5 sm:p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm w-full ${
                      isSpecial
                        ? 'animate-rainbow-aurora-card'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    {/* Left: Match Info & Players */}
                    <div className="space-y-1.5 min-w-0 w-fit mx-auto sm:mx-0">
                      {(isSpecial || hasDuplicatePlayer) && (
                        <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                          {isSpecial && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-white font-black bg-slate-950/60 border border-white/30 px-2 py-0.5 rounded-full">
                              <Sparkles className="w-3 h-3 text-amber-200 animate-spin" style={{ animationDuration: '5s' }} />
                              <span>스페셜 대기 경기 (출전 차례 도착)</span>
                            </span>
                          )}
                          {hasDuplicatePlayer && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-orange-400 font-semibold bg-orange-500/10 border border-orange-500/25 px-1.5 py-0.5 rounded">
                              <AlertTriangle className="w-3 h-3 text-orange-400" />
                              타 코트 배정자 포함
                            </span>
                          )}
                        </div>
                      )}

                      {/* Teams: 4명의 선수 좌우 길이에 딱 맞게 한 줄로 나열 및 중앙 정렬 */}
                      <DragScrollContainer className="flex items-center justify-center gap-1 sm:gap-1.5 py-0.5 w-fit max-w-full mx-auto">
                        <div className="flex items-center justify-center gap-1 sm:gap-1.5 shrink-0">
                          {renderPlayer(match.teamA.player1Id)}
                          <span className="text-slate-600 text-xs font-bold shrink-0 mx-0.5">•</span>
                          {renderPlayer(match.teamA.player2Id)}
                          <span className="text-slate-600 text-xs font-bold shrink-0 mx-0.5">•</span>
                          {renderPlayer(match.teamB.player1Id)}
                          <span className="text-slate-600 text-xs font-bold shrink-0 mx-0.5">•</span>
                          {renderPlayer(match.teamB.player2Id)}
                        </div>
                      </DragScrollContainer>
                    </div>

                    {/* Right: Assign Button */}
                    <div className="flex items-center justify-center shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSelect(match.id)}
                        className={`w-full sm:w-auto px-3 py-1.5 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer whitespace-nowrap ${
                          isSpecial
                            ? 'animate-rainbow-aurora-btn text-white font-black'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                        }`}
                        title={
                          isSpecial
                            ? `스페셜 경기를 ${displayCourtName}에 즉시 투입합니다`
                            : `#${matchOrder} 경기를 ${displayCourtName}에 배정합니다`
                        }
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{isSpecial ? '스페셜 경기 즉시 투입' : '이 코트에 배정'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-xl transition-colors cursor-pointer w-full sm:w-auto text-center"
          >
            닫기 (코트 비워두기)
          </button>
        </div>
      </div>
    </div>
  );
};
