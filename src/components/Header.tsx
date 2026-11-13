import React, { useState, useEffect } from 'react';
import {
  SlidersHorizontal,
  LayoutGrid,
  Layers,
  Users,
  History,
  Maximize,
  Minimize,
  BookOpen,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { MatchOptions } from '../types';
import { UserGuideModal } from './UserGuideModal';

export type ActiveTab = 'courts' | 'games' | 'players' | 'history';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onOpenGenerateModal: () => void;
  onOpenResetModal?: () => void;
  onOpenWorkoutCalendar?: () => void;
  viewingWorkoutDate?: string | null;
  activeMatchCount: number;
  queuedMatchCount: number;
  totalPlayersCount: number;
  options?: MatchOptions;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenGenerateModal,
  onOpenWorkoutCalendar,
  viewingWorkoutDate,
  activeMatchCount,
  queuedMatchCount,
  totalPlayersCount,
  options,
}) => {
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
  });
  const [isTabletOrMobile, setIsTabletOrMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const isTouch =
      window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    return window.innerWidth < 1280 || (isTouch && window.innerWidth <= 1440);
  });

  useEffect(() => {
    const updateViewportMode = () => {
      const isTouch =
        window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
      setIsTabletOrMobile(
        window.innerWidth < 1280 || (isTouch && window.innerWidth <= 1440)
      );
    };
    updateViewportMode();
    window.addEventListener('resize', updateViewportMode);
    return () => window.removeEventListener('resize', updateViewportMode);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    soundEffects.playRacketHit();
    try {
      if (!document.fullscreenElement) {
        const docEl = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
          mozRequestFullScreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        } else if (docEl.mozRequestFullScreen) {
          await docEl.mozRequestFullScreen();
        } else if (docEl.msRequestFullscreen) {
          await docEl.msRequestFullscreen();
        }
      } else {
        const doc = document as Document & {
          webkitExitFullscreen?: () => Promise<void>;
          mozCancelFullScreen?: () => Promise<void>;
          msExitFullscreen?: () => Promise<void>;
        };
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
    } catch (err) {
      console.error('Fullscreen toggle failed:', err);
    }
  };

  const handleSelectTab = (tab: ActiveTab) => {
    soundEffects.playRacketHit();
    onTabChange(tab);
  };

  return (
    <>
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Zone 1: Brand Logo & Guide Booklet Button */}
          <div className="flex items-center gap-2 sm:gap-2.5 whitespace-nowrap shrink-0">
            <button
              type="button"
              onClick={() => handleSelectTab('courts')}
              className="group cursor-pointer py-0.5 flex items-center justify-center shrink-0 focus:outline-none"
              title="민턴매치메이커 (MintonMatchMaker) - 메인 화면으로 이동"
              aria-label="민턴매치메이커 메인 화면으로 이동"
            >
              <img
                src="/assets/aistudio/logo_398f6a86.png"
                alt="MintonMatchMaker"
                className="h-8 sm:h-9 md:h-10 w-auto object-contain transition-transform group-hover:scale-105"
              />
            </button>

            {/* 책자 모양 사용법 설명 버튼 (팜플렛 가이드 모달 실행) */}
            <button
              type="button"
              onClick={() => {
                soundEffects.playRacketHit();
                setShowGuideModal(true);
              }}
              title="민턴매치메이커 사용법 가이드 (이용 팜플렛 열기)"
              aria-label="민턴매치메이커 사용법 가이드 열기"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-700/80 hover:border-emerald-500/60 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-emerald-400 transition-all cursor-pointer shadow-sm active:scale-95 text-xs font-semibold group/guide"
            >
              <BookOpen className="w-4 h-4 text-emerald-400 group-hover/guide:scale-110 transition-transform shrink-0" />
              <span className="hidden xs:inline text-[11px] sm:text-xs font-bold text-slate-200 group-hover/guide:text-white">
                사용법
              </span>
            </button>

            {/* 운동 기록 버튼 (캘린더 및 최근 1개월간 운동 기록 열람) */}
            {onOpenWorkoutCalendar && (
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  onOpenWorkoutCalendar();
                }}
                title="운동 기록 캘린더 열기 (한 달간의 운동 기록 보기)"
                aria-label="운동 기록 캘린더 열기"
                className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border transition-all cursor-pointer shadow-sm active:scale-95 text-xs font-bold leading-tight ${
                  viewingWorkoutDate
                    ? 'bg-white hover:bg-slate-100 border-amber-400 text-slate-900 ring-2 ring-amber-400/60'
                    : 'bg-white hover:bg-slate-100 border-white text-slate-900'
                }`}
              >
                <span className="text-[11px] sm:text-xs font-extrabold text-slate-900 leading-tight">
                  운동 기록
                </span>
                {viewingWorkoutDate && (
                  <span className="hidden sm:inline-block px-1.5 py-0 rounded bg-amber-400 text-slate-950 text-[10px] font-extrabold font-mono leading-tight">
                    {viewingWorkoutDate.slice(5).replace('-', '/')}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Zone 2: Navigation Links & Actions */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Desktop Navigation Links (데스크톱 대형 화면 전용, 모바일 및 태블릿에서는 하단 네비게이션 사용) */}
            {!isTabletOrMobile && (
              <nav className="hidden xl:flex items-center gap-2 lg:gap-3 text-xs sm:text-sm font-medium">
                <button
                  data-keep-conflict-nav="true"
                  onClick={() => handleSelectTab('courts')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'courts'
                      ? 'bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                  <span>코트 현황</span>
                  {activeMatchCount > 0 && (
                    <span className="ml-0.5 text-[10px] tabular-nums font-mono px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded">
                      {activeMatchCount}코트
                    </span>
                  )}
                </button>

                <button
                  data-keep-conflict-nav="true"
                  onClick={() => handleSelectTab('games')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'games'
                      ? 'bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>게임 목록</span>
                  {queuedMatchCount > 0 && (
                    <span className="ml-0.5 text-[10px] tabular-nums font-mono px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                      대기 {queuedMatchCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => handleSelectTab('players')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'players'
                      ? 'bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Users
                    className={`w-3.5 h-3.5 shrink-0 ${
                      totalPlayersCount === 0 ? 'animate-empty-players-icon' : ''
                    }`}
                  />
                  <span className={totalPlayersCount === 0 ? 'animate-empty-players-text font-bold' : ''}>
                    참가자 명단
                  </span>
                  <span className="ml-0.5 text-[10px] tabular-nums font-mono px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded">
                    {totalPlayersCount}
                  </span>
                </button>

                <button
                  onClick={() => handleSelectTab('history')}
                  className={`px-2.5 lg:px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'history'
                      ? 'bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <History className="w-3.5 h-3.5 shrink-0" />
                  <span>대진 기록</span>
                </button>
              </nav>
            )}

            {/* Utility & Option Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={handleToggleFullscreen}
                title={isFullscreen ? '풀스크린 해제 (전체화면 종료)' : '풀스크린 모드 (전체화면으로 크게 보기)'}
                aria-label={isFullscreen ? '풀스크린 해제' : '풀스크린'}
                aria-pressed={isFullscreen}
                className={`px-2 sm:px-2.5 py-1.5 sm:py-2 text-xs font-semibold rounded-lg border transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 min-h-[36px] sm:min-h-[40px] active:scale-95 ${
                  isFullscreen
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-400/60 shadow-sm shadow-amber-500/20 animate-pulse'
                    : 'bg-slate-900/90 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 border-slate-700/80 hover:border-emerald-500/50'
                }`}
              >
                {isFullscreen ? (
                  <Minimize className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Maximize className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </button>

              <button
                onClick={() => {
                  soundEffects.playRacketHit();
                  onOpenGenerateModal();
                }}
                title={`매칭 옵션 설정 (현재: ${
                  options?.mode === 'random'
                    ? '완전 랜덤'
                    : options?.mode === 'doubles_only'
                    ? '복식 우선'
                    : options?.mode === 'mixed_preference'
                    ? '혼복 우선'
                    : '실력 밸런스'
                })`}
                className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 active:scale-98 rounded-lg shadow-sm shadow-emerald-500/20 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer min-h-[36px] sm:min-h-[40px]"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span>옵션 설정</span>
                <span className="hidden xs:inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/25 text-emerald-950 font-black border border-emerald-900/20">
                  {options?.mode === 'random'
                    ? '완전랜덤'
                    : options?.mode === 'doubles_only'
                    ? '복식우선'
                    : options?.mode === 'mixed_preference'
                    ? '혼복우선'
                    : '실력밸런스'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile & Tablet Fixed Bottom Navigation Bar (모바일 및 태블릿 하단 고정 메뉴: 코트현황 / 게임목록 / 참가자명단 / 대진기록) */}
      <nav
        className={`${
          isTabletOrMobile ? 'grid' : 'xl:hidden grid'
        } fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 grid-cols-4 items-center h-16 sm:h-[68px] pb-safe px-1 sm:px-4 shadow-2xl shadow-black/60`}
      >
        <button
          type="button"
          data-keep-conflict-nav="true"
          onClick={() => handleSelectTab('courts')}
          className={`relative flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
            activeTab === 'courts'
              ? 'text-emerald-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {activeTab === 'courts' && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 sm:w-14 h-0.5 bg-emerald-400 rounded-b-full" />
          )}
          <div className="relative">
            <LayoutGrid className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
            {activeMatchCount > 0 && (
              <span className="absolute -top-1 -right-2.5 min-w-[15px] h-3.5 px-1 bg-emerald-500 text-slate-950 text-[9px] font-black rounded-full flex items-center justify-center">
                {activeMatchCount}
              </span>
            )}
          </div>
          <span className="text-[11px] sm:text-xs mt-1 tracking-tight whitespace-nowrap">
            코트 현황
          </span>
        </button>

        <button
          type="button"
          data-keep-conflict-nav="true"
          onClick={() => handleSelectTab('games')}
          className={`relative flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
            activeTab === 'games'
              ? 'text-emerald-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {activeTab === 'games' && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 sm:w-14 h-0.5 bg-emerald-400 rounded-b-full" />
          )}
          <div className="relative">
            <Layers className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
            {queuedMatchCount > 0 && (
              <span className="absolute -top-1 -right-2.5 min-w-[15px] h-3.5 px-1 bg-amber-400 text-slate-950 text-[9px] font-black rounded-full flex items-center justify-center">
                {queuedMatchCount}
              </span>
            )}
          </div>
          <span className="text-[11px] sm:text-xs mt-1 tracking-tight whitespace-nowrap">
            게임 목록
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectTab('players')}
          className={`relative flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
            activeTab === 'players'
              ? 'text-emerald-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {activeTab === 'players' && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 sm:w-14 h-0.5 bg-emerald-400 rounded-b-full" />
          )}
          <div className="relative">
            <Users
              className={`w-5 h-5 sm:w-5.5 sm:h-5.5 ${
                totalPlayersCount === 0 ? 'animate-empty-players-icon' : ''
              }`}
            />
            <span className="absolute -top-1 -right-3 text-[9px] font-mono font-bold text-slate-300 bg-slate-800 px-1 rounded-full border border-slate-700">
              {totalPlayersCount}
            </span>
          </div>
          <span
            className={`text-[11px] sm:text-xs mt-1 tracking-tight whitespace-nowrap ${
              totalPlayersCount === 0 ? 'animate-empty-players-text font-bold' : ''
            }`}
          >
            참가자 명단
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectTab('history')}
          className={`relative flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
            activeTab === 'history'
              ? 'text-emerald-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {activeTab === 'history' && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 sm:w-14 h-0.5 bg-emerald-400 rounded-b-full" />
          )}
          <History className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
          <span className="text-[11px] sm:text-xs mt-1 tracking-tight whitespace-nowrap">
            대진 기록
          </span>
        </button>
      </nav>

      {/* User Guide Pamphlet Modal (사용법 설명 팜플렛 모달) */}
      <UserGuideModal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
      />

    </>
  );
};
