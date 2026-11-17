import React, { useState, useRef } from 'react';
import {
  X,
  BookOpen,
  LayoutGrid,
  Layers,
  Users,
  Sparkles,
  Clock,
  RotateCcw,
  CheckCircle2,
  Plus,
  Scale,
  Trophy,
  Hash,
  CheckSquare,
  ShieldCheck,
  Search,
  ListPlus,
  Volume2,
  Maximize2,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Flag,
  Calendar,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import { CrossedRacketsIcon } from './CrossedRacketsIcon';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type GuideTab = 'quick' | 'courts' | 'games' | 'players' | 'calendar' | 'tips';

export const UserGuideModal: React.FC<UserGuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<GuideTab>('quick');
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    isDown: boolean;
    startX: number;
    scrollLeft: number;
    hasMoved: boolean;
  }>({
    isDown: false,
    startX: 0,
    scrollLeft: 0,
    hasMoved: false,
  });

  if (!isOpen) return null;

  const handleTabChange = (tab: GuideTab) => {
    soundEffects.playRacketHit();
    setActiveTab(tab);
  };

  const handleClose = () => {
    soundEffects.playScorePoint();
    onClose();
  };

  const handleTabsMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = tabsContainerRef.current;
    if (!container) return;

    dragStateRef.current = {
      isDown: true,
      startX: e.clientX,
      scrollLeft: container.scrollLeft,
      hasMoved: false,
    };

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStateRef.current.isDown) return;
      const targetContainer = tabsContainerRef.current;
      if (!targetContainer) return;

      const deltaX = moveEvent.clientX - dragStateRef.current.startX;
      if (!dragStateRef.current.hasMoved && Math.abs(deltaX) > 4) {
        dragStateRef.current.hasMoved = true;
      }

      if (dragStateRef.current.hasMoved) {
        moveEvent.preventDefault();
        targetContainer.scrollLeft = dragStateRef.current.scrollLeft - deltaX;
      }
    };

    const handleWindowMouseUp = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);

      if (dragStateRef.current.isDown) {
        dragStateRef.current.isDown = false;
        if (dragStateRef.current.hasMoved) {
          setTimeout(() => {
            dragStateRef.current.hasMoved = false;
          }, 60);
        }
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  const handleTabsClickCapture = (e: React.MouseEvent) => {
    if (dragStateRef.current.hasMoved) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = tabsContainerRef.current;
    if (!container) return;
    if (e.deltaY !== 0) {
      container.scrollLeft += e.deltaY;
    }
  };

  const scrollTabsBy = (direction: 'left' | 'right') => {
    const container = tabsContainerRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction === 'left' ? -180 : 180,
      behavior: 'smooth',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white">
                  MATCHMAKER 사용법 가이드
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  최신 업데이트
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400">
                한눈에 보는 스마트 배드민턴 대진표 핵심 요점
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Horizontal Category Tabs */}
        <div className="relative flex items-center gap-1 px-2 py-2 bg-slate-950/40 border-b border-slate-800/80 shrink-0">
          <button
            type="button"
            onClick={() => scrollTabsBy('left')}
            title="왼쪽 스크롤"
            className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div
            ref={tabsContainerRef}
            onMouseDown={handleTabsMouseDown}
            onClickCapture={handleTabsClickCapture}
            onWheel={handleTabsWheel}
            className="flex-1 flex items-center gap-1.5 px-1 pb-1 overflow-x-auto overscroll-x-contain touch-manipulation select-none cursor-grab active:cursor-grabbing text-xs [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-slate-900/80 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 hover:[&::-webkit-scrollbar-thumb]:bg-emerald-500/80 [&::-webkit-scrollbar-thumb]:rounded-full"
          >
            <button
              type="button"
              onClick={() => handleTabChange('quick')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
                activeTab === 'quick'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>⚡ 3단계 시작</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('courts')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
                activeTab === 'courts'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>🏟️ 코트 현황</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('games')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
                activeTab === 'games'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>📋 게임 목록</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('players')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
                activeTab === 'players'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>👥 참가자 관리</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('calendar')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
                activeTab === 'calendar'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>📅 기록 캘린더</span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange('tips')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 shrink-0 ${
                activeTab === 'tips'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>💡 옵션 &amp; 꿀팁</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => scrollTabsBy('right')}
            title="오른쪽 스크롤"
            className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 text-xs text-slate-300">
          {/* TAB 1: 3단계 빠른 시작 */}
          {activeTab === 'quick' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-400 font-black text-xs flex items-center justify-center">1</span>
                    <h4 className="font-bold text-white">참가자 등록 &amp; 출석</h4>
                  </div>
                  <p className="text-slate-300 leading-snug">
                    <strong>[일괄 등록]</strong> → 상단 <strong>[일괄 등록하기]</strong> 후 도착순 <strong>[출석]</strong> 터치
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-400 font-black text-xs flex items-center justify-center">2</span>
                    <h4 className="font-bold text-white">코트 &amp; 대진 생성</h4>
                  </div>
                  <p className="text-slate-300 leading-snug">
                    <strong>[코트 생성]</strong> 후 <strong>[자동/연속/남복/여복/혼복/참가순]</strong>으로 편성
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-black text-xs flex items-center justify-center">3</span>
                    <h4 className="font-bold text-white">코트 투입 &amp; 완료</h4>
                  </div>
                  <p className="text-slate-300 leading-snug">
                    게임목록 <strong>[n코트]</strong> 터치 → 대기열 <strong>[선택]</strong> 투입 → 코트 중앙 <strong>[완료]</strong>
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div><strong className="text-emerald-400">🏟️ 코트 현황:</strong> 중앙 [완료], 예상 매칭, 꼬깔 순환, 1:1 교체</div>
                <div><strong className="text-amber-300">📋 게임 목록:</strong> [n코트] 꼬깔 연동, 선택 인원 대기열 생성</div>
                <div><strong className="text-blue-300">👥 참가자 명단:</strong> [출석체크], 꼬깔확인·콕제출, 0.5초 상태 메뉴</div>
                <div><strong className="text-purple-300">📅 기록 캘린더:</strong> 최근 1개월 보관·열기, AM 04:00 자동 저장</div>
              </div>
            </div>
          )}

          {/* TAB 2: 코트 현황 */}
          {activeTab === 'courts' && (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-purple-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>꼬깔(턴) 순환 &amp; 연동</span>
                </div>
                <p>• <strong>빨강(우리클럽) ↔ 회색(타클럽)</strong>: 경기 [완료] 시 자동 회전 (게임 목록 n코트 꼬깔과 실시간 연동)</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>빈 코트 예상 매칭 &amp; 중앙 [완료] / 교체</span>
                </div>
                <p>• <strong>예상 매칭 4명:</strong> [이 코트 경기 자동 생성] 시 동일 배정 (미출석·휴식·레슨·퇴장 제외)</p>
                <p>• <strong>중앙 [완료] &amp; 교체:</strong> 원클릭 경기 종료([되돌리기] 복구) / 선수 터치로 1:1 교체</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="font-bold text-rose-300 flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5" />
                  <span>선수 0.5초 길게 누르기 (부채꼴 상태 메뉴)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <strong className="text-amber-300">☕ 휴식:</strong> 배정 일시 제외 (복귀 시 대기 경기 수 자동 보정)
                  </div>
                  <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                    <strong className="text-indigo-300">🎓 레슨중:</strong> 레슨 종료 시까지 대진 배정 제외
                  </div>
                  <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                    <strong className="text-rose-300">🚩 막판!:</strong> 해당 경기 [완료] 즉시 자동 [퇴장] 전환
                  </div>
                  <div className="p-2 bg-slate-800/90 border border-slate-700 rounded-lg">
                    <strong className="text-slate-200">🚪 퇴장:</strong> 귀가 처리 (배정 제외 · 대진 기록 보존)
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 게임 목록 */}
          {activeTab === 'games' && (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>대기열 생성 &amp; 선택 인원 편성</span>
                </div>
                <p>• <strong>상단 버튼:</strong> [자동 / 연속 / 남복 / 여복 / 혼복 / 참가순]으로 맞춤 대기열 생성</p>
                <p>• <strong>선택 생성:</strong> 하단 명단에서 선수 터치 → <strong>[선택한 n명으로 대기열 생성]</strong> 클릭</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  <span>[n코트] 배정 &amp; 1:1 선수 교체</span>
                </div>
                <p>• <strong className="text-emerald-400">초록 [n코트] (빈 코트):</strong> 터치 후 대기열 <strong>[선택]</strong> 시 즉시 코트 투입</p>
                <p>• <strong className="text-rose-300">빨강 [n코트] (진행 중):</strong> 현재 경기 완료 처리 후 다음 대기열 연속 투입</p>
                <p>• <strong className="text-orange-300">선수 교체 &amp; 순서 변경:</strong> 선수 터치로 1:1 교체 / 좌측 핸들 드래그로 대기열 순서 이동</p>
              </div>
            </div>
          )}

          {/* TAB 4: 참가자 관리 */}
          {activeTab === 'players' && (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-1">
                <div className="font-bold text-cyan-300 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>[출석체크] &amp; 오름차순 참가 등록</span>
                </div>
                <p>• <strong>[출석체크] 활성:</strong> 일괄 등록 시 미출석(빗금) 상태로 등록 (배정 제외)</p>
                <p>• <strong>[출석] 터치:</strong> 누른 순서대로 1, 2, 3... 참가 순번 부여 후 <strong>[🏸 콕제출]</strong>로 전환</p>
              </div>

              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>[참가자 일괄 등록] &amp; [전체 회원 관리]</span>
                </div>
                <p>• <strong>상단 [일괄 등록하기]:</strong> 우측 상단(닫기 왼쪽) 버튼으로 즉시 등록 · 전체회원 자동 동기화</p>
                <p>• <strong>간편 입력:</strong> <code>홍길동 12</code> (꼬깔 12번) / <code>박지성 남 A</code> (신규·참가 동시 등록)</p>
                <p>• <strong>전체 회원 관리:</strong> 상단 <strong>[회원 직접 등록]</strong>, <strong>[테스트]</strong>(24명 생성), <strong>[.json 파일 백업/복원]</strong></p>
              </div>
            </div>
          )}

          {/* TAB 5: 기록 캘린더 & AM 04:00 자동 저장 */}
          {activeTab === 'calendar' && (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>기록 캘린더 (최근 1개월 보관)</span>
                </div>
                <p>• <strong>날짜 선택:</strong> 하단에 해당일의 <strong>코트 현황 · 게임 목록 · 참가자 명단 · 대진 기록</strong> 요약 표시</p>
                <p>• <strong>[기록 열기]:</strong> 선택한 날짜의 운동 기록을 전 메뉴에서 열람·수정 (<strong>[오늘 운동으로 복귀]</strong> 지원)</p>
                <p>• <strong>테스트 제외:</strong> [테스트]로 생성한 가상 선수 데이터는 캘린더 기록에서 자동 제외</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>매일 AM 04:00 자동 저장 · 초기화</span>
                </div>
                <p>• <strong>전날 기록 저장:</strong> 전날 00:00시 이전 운동 기록만 전날 날짜로 자동 저장 (1개월 초과분 자동 삭제)</p>
                <p>• <strong>자동 초기화:</strong> 일반 시간에 앱 실행 시 알림 없이 자동 처리 / 실제 04:00 사용 중일 때만 3분 알림 표시</p>
                <p>• <strong>새벽 운동 보호:</strong> 당일 00:00 ~ 04:00 사이 첫 운동 시작 시 04:00 초기화 자동 면제</p>
              </div>
            </div>
          )}

          {/* TAB 6: 옵션 & 꿀팁 */}
          {activeTab === 'tips' && (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5" />
                  <span>⚖️ 매칭 옵션 설정 (하단 고정 제어 바)</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-emerald-300">• 실력 밸런스:</strong> 급수 균형 편성</div>
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-amber-300">• 완전 랜덤:</strong> 무작위 추첨</div>
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-blue-300">• 복식 우선:</strong> 남복·여복 전용</div>
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-pink-300">• 혼복 우선:</strong> 2남2여 최우선</div>
                </div>
                <p className="text-[11px] pt-0.5">
                  • <strong>휴식자 우선 출전 · 이전 경기 중복 방지</strong> 체크 지원 / 하단 <strong>[초기화 · 소리 · 취소 · 저장]</strong> 고정 바
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-amber-300">⏱️ 지각 20분 보정:</strong> 지각 등록·출석 선수의 연속 배정 방지
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-pink-400 inline-flex items-center gap-1 align-middle"><CrossedRacketsIcon className="w-3.5 h-3.5 text-pink-400 shrink-0" />파트너 설정:</strong> 지정한 두 선수를 같은 팀 우선 배정
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-blue-300">🖥️ 화면 &amp; 효과음:</strong> 상단 전체화면 및 효과음 ON·OFF
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-purple-300">🛡️ 영구 보존:</strong> 초기화 시에도 [전체회원] · [기록 캘린더] 보존
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <span>MATCHMAKER 🏸 즐겁고 공정한 배드민턴 클럽 운영</span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
          >
            확인 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
