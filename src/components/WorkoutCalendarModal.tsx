import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  RotateCcw,
  Users,
  Layers,
  History,
  LayoutGrid,
  CheckCircle2,
  ArrowRightCircle,
} from 'lucide-react';
import {
  DailyWorkoutRecord,
  formatDateKey,
  parseDateKey,
  formatKoreanDateLabel,
  getOneMonthCutoffDateKey,
  isWorkoutSnapshotNonEmpty,
} from '../utils/workoutHistoryStorage';
import { soundEffects } from '../utils/audio';

interface WorkoutCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  workoutRecords: Record<string, DailyWorkoutRecord>;
  todayLiveRecord: DailyWorkoutRecord;
  viewingWorkoutDate: string | null; // null 이면 오늘 운동 기록 열람 중
  onSelectDate: (dateKey: string) => void;
  onReturnToToday: () => void;
  snoozeUntil?: number | null;
  onTriggerFourAmPromptNow?: () => void;
}

export const WorkoutCalendarModal: React.FC<WorkoutCalendarModalProps> = ({
  isOpen,
  onClose,
  workoutRecords,
  todayLiveRecord,
  viewingWorkoutDate,
  onSelectDate,
  onReturnToToday,
  snoozeUntil,
  onTriggerFourAmPromptNow,
}) => {
  const now = new Date();
  const todayDateKey = formatDateKey(now);
  const cutoffDateKey = getOneMonthCutoffDateKey(now);

  // 현재 캘린더에 표시할 연/월 상태 및 선택된 날짜 상태
  const [viewYear, setViewYear] = useState<number>(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(() => now.getMonth()); // 0 ~ 11
  const [selectedDateKey, setSelectedDateKey] = useState<string>(
    () => viewingWorkoutDate || todayDateKey
  );

  // 모달이 열릴 때 현재 열람 중인 날짜(또는 오늘 날짜)를 기본 선택 상태로 설정하고 해당 월로 포커스 이동
  useEffect(() => {
    if (isOpen) {
      const initialKey = viewingWorkoutDate || formatDateKey(new Date());
      setSelectedDateKey(initialKey);
      const targetDate = parseDateKey(initialKey);
      setViewYear(targetDate.getFullYear());
      setViewMonth(targetDate.getMonth());
    }
  }, [isOpen, viewingWorkoutDate]);

  // 오늘 실시간 데이터를 포함한 통합 1개월 운동 기록 맵
  const mergedRecordsMap = useMemo(() => {
    const map: Record<string, DailyWorkoutRecord> = { ...workoutRecords };
    if (isWorkoutSnapshotNonEmpty(todayLiveRecord)) {
      map[todayDateKey] = todayLiveRecord;
    }
    return map;
  }, [workoutRecords, todayLiveRecord, todayDateKey]);

  // 최근 1개월 내 기록이 존재하는 날짜 수
  const recordedDaysCount = useMemo(() => {
    return Object.entries(mergedRecordsMap).filter(
      ([dateKey, rec]) =>
        dateKey >= cutoffDateKey &&
        dateKey <= todayDateKey &&
        isWorkoutSnapshotNonEmpty(rec)
    ).length;
  }, [mergedRecordsMap, cutoffDateKey, todayDateKey]);

  if (!isOpen) return null;

  const cutoffDateObj = parseDateKey(cutoffDateKey);
  const minAllowedMonthIndex = cutoffDateObj.getFullYear() * 12 + cutoffDateObj.getMonth();
  const maxAllowedMonthIndex = now.getFullYear() * 12 + now.getMonth();
  const currentViewMonthIndex = viewYear * 12 + viewMonth;

  const canGoPrevMonth = currentViewMonthIndex > minAllowedMonthIndex;
  const canGoNextMonth = currentViewMonthIndex < maxAllowedMonthIndex;

  const handlePrevMonth = () => {
    if (!canGoPrevMonth) return;
    soundEffects.playRacketHit();
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (!canGoNextMonth) return;
    soundEffects.playRacketHit();
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // 해당 월의 달력 그리드 생성
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
  const startDayOfWeek = firstDayOfMonth.getDay(); // 0(일) ~ 6(토)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const calendarCells: Array<{
    dateKey: string | null;
    dayNumber: number | null;
    dayOfWeek: number;
  }> = [];

  for (let i = 0; i < startDayOfWeek; i++) {
    calendarCells.push({ dateKey: null, dayNumber: null, dayOfWeek: i });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(viewYear, viewMonth, d);
    calendarCells.push({
      dateKey: formatDateKey(cellDate),
      dayNumber: d,
      dayOfWeek: cellDate.getDay(),
    });
  }

  const currentlyOpenDateKey = viewingWorkoutDate || todayDateKey;
  const activeSelectedDateKey = selectedDateKey || currentlyOpenDateKey;
  const activeSelectedRecord = mergedRecordsMap[activeSelectedDateKey];

  const handleOpenSelectedRecord = () => {
    soundEffects.playRacketHit();
    if (activeSelectedDateKey === todayDateKey) {
      if (viewingWorkoutDate !== null) {
        onReturnToToday();
      } else {
        onClose();
      }
    } else {
      onSelectDate(activeSelectedDateKey);
    }
  };

  const getCompletedMatchCount = (rec?: DailyWorkoutRecord): number => {
    if (!rec || !Array.isArray(rec.roundHistory)) return 0;
    return rec.roundHistory.reduce(
      (sum, r) => sum + (Array.isArray(r.matches) ? r.matches.length : 0),
      0
    );
  };

  return (
    <div
      data-court-modal="true"
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                기록 캘린더
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                최근 1개월 보관
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* 오늘 운동으로 이동 버튼 */}
            <button
              type="button"
              onClick={() => {
                soundEffects.playRacketHit();
                onReturnToToday();
              }}
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm whitespace-nowrap ${
                viewingWorkoutDate
                  ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-emerald-500/25 ring-2 ring-emerald-300/60'
                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
              }`}
              title="캘린더로 켜졌던 이전 운동 기록을 닫고 오늘(당일) 운동 기록으로 이동합니다"
            >
              <ArrowRightCircle className="w-4 h-4 shrink-0" />
              <span>오늘 운동으로 이동</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              aria-label="운동 기록 캘린더 닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Banner: 과거 운동 기록 열람 중일 때만 표시 (오늘 기록 실시간 저장 중 및 AM 04:00 자동 저장 · 1개월 보관 문구 숨김) */}
        {viewingWorkoutDate && (
          <div className="px-4 sm:px-5 py-2 border-b bg-amber-500/15 border-amber-500/30 text-amber-200 flex items-center gap-1.5 text-xs shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="font-semibold">
              <strong className="text-amber-300 font-extrabold">{formatKoreanDateLabel(viewingWorkoutDate)}</strong> 기록 열람 중
            </span>
          </div>
        )}

        {/* Fixed Month Selector Banner (상단 아래 고정 배너) */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePrevMonth}
            disabled={!canGoPrevMonth}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-center ${
              canGoPrevMonth
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer active:scale-95'
                : 'bg-slate-900/40 text-slate-600 border-slate-800/60 cursor-not-allowed'
            }`}
            title="이전 달 보기 (최근 1개월 내)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="text-center">
            <div className="text-sm sm:text-base font-extrabold text-white">
              {viewYear}년 {viewMonth + 1}월
            </div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 font-mono">
              {cutoffDateKey} ~ {todayDateKey}
            </div>
          </div>

          <button
            type="button"
            onClick={handleNextMonth}
            disabled={!canGoNextMonth}
            className={`p-1.5 rounded-lg border transition-all flex items-center justify-center ${
              canGoNextMonth
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer active:scale-95'
                : 'bg-slate-900/40 text-slate-600 border-slate-800/60 cursor-not-allowed'
            }`}
            title="다음 달 보기"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Calendar Body */}
        <div className="p-3.5 sm:p-5 overflow-y-auto space-y-4 flex-1">

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[11px] font-bold">
            {['일', '월', '화', '수', '목', '금', '토'].map((w, idx) => (
              <div
                key={w}
                className={`py-1 ${
                  idx === 0
                    ? 'text-rose-400'
                    : idx === 6
                    ? 'text-sky-400'
                    : 'text-slate-400'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Calendar Days Grid */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {calendarCells.map((cell, index) => {
              if (!cell.dateKey || cell.dayNumber === null) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="min-h-[52px] sm:min-h-[76px] rounded-xl bg-transparent sm:bg-slate-950/20 border border-transparent sm:border-slate-900/40"
                  />
                );
              }

              const dateKey = cell.dateKey;
              const isToday = dateKey === todayDateKey;
              const isBeforeCutoff = dateKey < cutoffDateKey;
              const isFuture = dateKey > todayDateKey;
              const isSelectable = !isBeforeCutoff && !isFuture;
              const isCurrentlyActive = dateKey === activeSelectedDateKey;
              const isCurrentlyOpenInApp = dateKey === currentlyOpenDateKey;

              const record = mergedRecordsMap[dateKey];
              const hasData = isWorkoutSnapshotNonEmpty(record);
              const playerCount = record?.players?.length || 0;
              const completedMatchCount = getCompletedMatchCount(record);
              const activeOrQueuedCount =
                (record?.activeMatches?.length || 0) +
                (record?.queuedMatches?.length || 0);

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={!isSelectable}
                  onClick={() => {
                    if (!isSelectable) return;
                    soundEffects.playRacketHit();
                    setSelectedDateKey(dateKey);
                  }}
                  className={`relative min-h-[52px] sm:min-h-[78px] py-1.5 px-1 sm:p-2 rounded-xl border text-center sm:text-left flex flex-col items-center sm:items-stretch justify-start sm:justify-between transition-all select-none ${
                    !isSelectable
                      ? 'bg-transparent sm:bg-slate-950/30 border-transparent sm:border-slate-900 text-slate-600 opacity-40 cursor-not-allowed'
                      : isCurrentlyActive
                      ? isToday
                        ? 'bg-slate-900/60 sm:bg-emerald-500/20 border-emerald-400/70 sm:border-emerald-400 ring-1 sm:ring-2 ring-emerald-400/50 text-white cursor-pointer sm:shadow-md sm:shadow-emerald-500/10'
                        : 'bg-amber-500/15 sm:bg-amber-500/20 border-amber-400/70 sm:border-amber-400 ring-1 sm:ring-2 ring-amber-400/50 text-white cursor-pointer shadow-md shadow-amber-500/10'
                      : hasData
                      ? 'bg-transparent sm:bg-slate-800/90 hover:bg-slate-800/60 sm:hover:bg-slate-800 border-transparent sm:border-emerald-500/40 sm:hover:border-emerald-400 text-slate-100 cursor-pointer active:scale-95'
                      : 'bg-transparent sm:bg-slate-950/70 hover:bg-slate-800/40 sm:hover:bg-slate-800/60 border-transparent sm:border-slate-800 sm:hover:border-slate-700 text-slate-300 cursor-pointer active:scale-95'
                  }`}
                  title={
                    !isSelectable
                      ? isBeforeCutoff
                        ? `${dateKey}: 1개월 보관 기간 경과 (자동 삭제됨)`
                        : `${dateKey}: 미래 날짜`
                      : `${dateKey} 선택 (하단 [기록 열기] 클릭 시 열람)`
                  }
                >
                  {/* Top Row: Day Number (with Circle on Today) & Desktop Today/Active Tag */}
                  <div className="flex items-center justify-center sm:justify-between gap-0.5 w-full">
                    <span
                      className={`w-7 h-7 sm:w-6 sm:h-6 rounded-full inline-flex items-center justify-center text-xs sm:text-sm font-extrabold font-mono leading-none transition-colors ${
                        isToday
                          ? 'bg-slate-200 text-slate-950 shadow-sm ring-2 ring-white/80'
                          : !isSelectable
                          ? 'text-slate-600'
                          : !isToday && isCurrentlyActive
                          ? 'bg-amber-400 text-slate-950 font-black'
                          : cell.dayOfWeek === 0
                          ? 'text-rose-400'
                          : cell.dayOfWeek === 6
                          ? 'text-sky-400'
                          : 'text-slate-200'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    {isToday && (
                      <span className="hidden sm:inline-block px-1 py-0.2 rounded text-[9px] font-extrabold bg-emerald-400 text-slate-950 leading-tight shrink-0">
                        오늘
                      </span>
                    )}
                    {!isToday && isCurrentlyOpenInApp && (
                      <span className="hidden sm:inline-block px-1 py-0.2 rounded text-[9px] font-extrabold bg-amber-400 text-slate-950 leading-tight shrink-0">
                        켜짐
                      </span>
                    )}
                    {!isToday && !isCurrentlyOpenInApp && isCurrentlyActive && (
                      <span className="hidden sm:inline-block px-1 py-0.2 rounded text-[9px] font-extrabold bg-amber-400/90 text-slate-950 leading-tight shrink-0">
                        선택됨
                      </span>
                    )}
                  </div>

                  {/* Mobile Only: Simple Dot Indicator for Recorded Workout Days (참조 이미지 스타일) */}
                  <div className="flex sm:hidden items-center justify-center mt-1.5 h-2">
                    {isSelectable && hasData && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          !isToday && isCurrentlyActive ? 'bg-amber-400' : 'bg-emerald-400'
                        }`}
                      />
                    )}
                  </div>

                  {/* Desktop/Tablet Only (sm 이상): Workout Summary Badges (모바일에서는 참가자n명/대진 코트n 숨김) */}
                  {isSelectable && hasData ? (
                    <div className="hidden sm:block mt-1 space-y-0.5 w-full">
                      <div className="px-1 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-[9px] sm:text-[10px] font-bold text-emerald-300 truncate leading-tight flex items-center justify-between">
                        <span>참가</span>
                        <span className="font-mono">{playerCount}명</span>
                      </div>
                      <div className="px-1 py-0.5 rounded bg-slate-900/90 text-[9px] sm:text-[10px] font-semibold text-slate-300 truncate leading-tight flex items-center justify-between">
                        <span>대진</span>
                        <span className="font-mono text-amber-300">
                          {completedMatchCount > 0
                            ? `${completedMatchCount}게임`
                            : activeOrQueuedCount > 0
                            ? `진행 ${activeOrQueuedCount}`
                            : `코트 ${record?.courts?.length || 0}`}
                        </span>
                      </div>
                    </div>
                  ) : isSelectable ? (
                    <div className="hidden sm:block mt-auto text-[9px] sm:text-[10px] text-slate-500 font-medium truncate">
                      기록 없음
                    </div>
                  ) : (
                    <div className="hidden sm:block mt-auto text-[8px] sm:text-[9px] text-slate-600 truncate">
                      {isBeforeCutoff ? '만료' : '-'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active Date Summary Card */}
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold ${
                    activeSelectedDateKey !== todayDateKey
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {activeSelectedDateKey !== todayDateKey ? '선택된 과거 운동 기록' : '오늘 실시간 운동 기록'}
                </span>
                <span className="text-xs sm:text-sm font-bold text-white">
                  {formatKoreanDateLabel(activeSelectedDateKey)}
                </span>
              </div>

              {snoozeUntil && snoozeUntil > Date.now() && (
                <span className="text-[11px] text-amber-300 font-semibold bg-amber-500/15 px-2 py-0.5 rounded border border-amber-500/30">
                  04:00 초기화 알림 보류 중 ({new Date(snoozeUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 재알림)
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <LayoutGrid className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>코트 현황</span>
                </div>
                <div className="text-xs sm:text-sm font-extrabold text-white font-mono">
                  {activeSelectedRecord?.courts?.length || 0}코트 / 진행{' '}
                  {activeSelectedRecord?.activeMatches?.length || 0}
                </div>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>게임 목록</span>
                </div>
                <div className="text-xs sm:text-sm font-extrabold text-white font-mono">
                  대기 {activeSelectedRecord?.queuedMatches?.length || 0}게임
                </div>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>참가자 명단</span>
                </div>
                <div className="text-xs sm:text-sm font-extrabold text-white font-mono">
                  {activeSelectedRecord?.players?.length || 0}명
                </div>
              </div>

              <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-2">
                <div className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>대진 기록</span>
                </div>
                <div className="text-xs sm:text-sm font-extrabold text-white font-mono">
                  {getCompletedMatchCount(activeSelectedRecord)}게임 완료
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between gap-2 flex-wrap shrink-0">
          {onTriggerFourAmPromptNow && snoozeUntil && snoozeUntil > Date.now() ? (
            <button
              type="button"
              onClick={() => {
                soundEffects.playRacketHit();
                onClose();
                onTriggerFourAmPromptNow();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              title="30분 보류 중인 오전 04:00 전체 초기화 알림을 지금 바로 실행합니다"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>보류 중인 04:00 초기화 알림 열기</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleOpenSelectedRecord}
              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-md shadow-emerald-500/20"
              title="캘린더에서 선택한 날짜의 운동 기록을 열고 창을 닫습니다"
            >
              <ArrowRightCircle className="w-4 h-4" />
              <span>기록 열기</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
