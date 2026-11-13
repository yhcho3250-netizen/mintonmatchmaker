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
  HeartHandshake,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Flag,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type GuideTab = 'quick' | 'courts' | 'games' | 'players' | 'tips';

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
                  핵심요약
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 text-xs sm:text-sm text-slate-300">
          {/* TAB 1: 3단계 빠른 시작 */}
          {activeTab === 'quick' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-400 font-black text-xs flex items-center justify-center">1</span>
                    <h4 className="font-bold text-white text-xs sm:text-sm">참가자 등록 &amp; 출석</h4>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <strong>[일괄 등록]</strong>으로 명단 등록 후 도착순으로 <strong>[출석]</strong> 클릭 시 오름차순 등록
                    <br />
                    <span className="text-emerald-400 font-mono text-[11px]">예: 홍길동 12, 박지성 남 A</span>
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-400 font-black text-xs flex items-center justify-center">2</span>
                    <h4 className="font-bold text-white text-xs sm:text-sm">코트 &amp; 대진 생성</h4>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <strong>[코트 생성]</strong> 후 <strong>[자동/연속/남복/여복/혼복/참가순]</strong> 클릭 시 맞춤 알고리즘 편성
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-black text-xs flex items-center justify-center">3</span>
                    <h4 className="font-bold text-white text-xs sm:text-sm">코트 투입 &amp; 완료</h4>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    게임목록 <strong>[n코트]</strong> 터치 후 대기열 <strong>[선택]</strong>으로 투입, 경기 후 코트 중앙 <strong>[완료]</strong> 클릭
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div><strong className="text-emerald-400">🏟️ 코트 현황:</strong> 타이머, 중앙 [완료], 예상 매칭 미리보기, 꼬깔 순환</div>
                <div><strong className="text-amber-300">📋 게임 목록:</strong> [n코트] 꼬깔 실시간 연동, 선택 인원 대기열 생성, 1:1 교체</div>
                <div><strong className="text-blue-300">👥 참가자 명단:</strong> 일괄등록 [출석체크], 꼬깔확인·콕제출, 0.5초 상태 메뉴</div>
                <div><strong className="text-purple-300">📊 기록 &amp; 옵션:</strong> 이전 배정 경기 중복 방지, 휴식자 우선 출전 설정</div>
              </div>
            </div>
          )}

          {/* TAB 2: 코트 현황 */}
          {activeTab === 'courts' && (
            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-purple-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>꼬깔(턴) 순환 &amp; 게임목록 실시간 연동</span>
                </div>
                <p className="text-slate-300">
                  • <strong>빨강(우리클럽) ↔ 회색(타클럽)</strong>: 경기 완료 시 1번째 → 2번째 꼬깔 순으로 자동 회전합니다.
                  <br />
                  • 각 코트 <code className="text-emerald-300">n코트</code> 왼쪽의 꼬깔은 <strong>[게임 목록]의 n코트 버튼 왼쪽 꼬깔과 실시간 연동</strong>됩니다.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>빈 코트 예상 매칭 &amp; 자동 생성</span>
                </div>
                <p className="text-slate-300">
                  • 빈 코트와 <strong>[배정선수관리]</strong>의 <strong>예상 매칭 4명</strong>은 <strong>[이 코트 경기 자동 생성]</strong> 클릭 시 100% 동일하게 배정됩니다. (미출석 선수는 제외)
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>중앙 [완료] &amp; [되돌리기] / 1:1 교체</span>
                </div>
                <p className="text-slate-300">
                  • 선수 중앙 동그라미 <strong>[완료]</strong>로 원클릭 종료 (실수 시 <strong>[되돌리기]</strong>로 복구)
                  <br />
                  • 코트 선수를 터치하여 다른 선수와 1:1 교체할 수 있으며, <strong>[교체 취소]</strong> 버튼 또는 해당 선수를 다시 터치하면 해제됩니다.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                <div className="font-bold text-rose-300 flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5" />
                  <span>선수 0.5초 길게 누르기 (부채꼴 상태 메뉴)</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 font-semibold">
                  <div className="p-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded text-[11px] text-center">☕ 휴식</div>
                  <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded text-[11px] text-center">🎓 레슨중</div>
                  <div className="p-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded text-[11px] text-center">🚩 막판!</div>
                  <div className="p-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded text-[11px] text-center">🚪 퇴장</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 게임 목록 */}
          {activeTab === 'games' && (
            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>대기열 생성 &amp; 선택 선수 대기열 생성</span>
                </div>
                <p className="text-slate-300">
                  • 상단 <strong>[자동 / 연속 / 남복 / 여복 / 혼복 / 참가순]</strong> 버튼에 설정된 매칭 옵션이 자동 반영됩니다.
                  <br />
                  • 하단 참가자 명단에서 선수를 터치하면 배너 전체 폭의 <strong>[선택한 n명으로 대기열 생성]</strong> 버튼이 나타나며, 버튼 외 다른 영역을 터치하면 선택이 해제됩니다.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  <span>[n코트] 발광 버튼 &amp; 왼쪽 꼬깔 연동</span>
                </div>
                <ul className="text-slate-300 space-y-1 list-disc pl-4">
                  <li><strong className="text-purple-300">n코트 왼쪽 꼬깔:</strong> 코트 현황의 꼬깔과 실시간 연동되며 터치하여 클럽 턴을 즉시 변경할 수 있습니다.</li>
                  <li><strong className="text-emerald-400">초록 [n코트] (빈 코트):</strong> 터치 시 발광 → 대기열 <strong>[선택]</strong> 시 4명 선수 박스와 함께 즉시 투입</li>
                  <li><strong className="text-rose-300">빨강 [n코트] (진행 중):</strong> 완료된 경기 선수 확인 후 다음 대기열 연속 배정</li>
                  <li><strong className="text-slate-300">회색 [n코트] (타 클럽):</strong> 터치 시 다음 꼬깔로 회전 (우리클럽 전환 시 배정 안내)</li>
                </ul>
              </div>

              <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 space-y-1">
                <div className="font-bold text-orange-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>선수 교체 &amp; 중복 선수 감지</span>
                </div>
                <p className="text-slate-200">
                  • 대기열 선수를 터치하여 다른 선수와 1:1 교체할 수 있으며, <strong>[교체 취소]</strong> 버튼 또는 해당 선수를 다시 터치하면 해제됩니다.
                  <br />
                  • 타 코트 운동 중 선수 포함 시 투입 차단 / 좌측 핸들 드래그로 대기열 순서 변경
                </p>
              </div>
            </div>
          )}

          {/* TAB 4: 참가자 관리 */}
          {activeTab === 'players' && (
            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-1">
                <div className="font-bold text-cyan-300 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5" />
                  <span>[일괄 등록] 출석체크 &amp; 오름차순 참가 순서 등록</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-slate-200">
                  <li><strong className="text-cyan-300">[출석체크] 체크 시:</strong> 일괄 등록된 선수는 이름에 <strong>반투명 빗금</strong>이 표시되고 <code className="text-cyan-300">[출석]</code> 버튼이 먼저 나타납니다.</li>
                  <li><strong className="text-emerald-300">[출석] 버튼 터치:</strong> 클릭한 순서대로 <strong>1, 2, 3... 오름차순 참가 순서</strong>로 등록되며 <code className="text-amber-300">[🏸 콕제출]</code> 버튼으로 전환됩니다.</li>
                  <li><strong className="text-amber-300">꼬깔확인 &amp; 미출석 분리:</strong> <code className="text-amber-300">[꼬깔확인]</code> 체크 시 출석 직후 꼬깔 번호 입력창이 열리며, 미출석(빗금) 선수는 코트 현황·게임 목록에서 제외됩니다.</li>
                </ul>
              </div>

              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>[일괄 등록] 띄어쓰기 간편 입력</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-slate-200">
                  <li><strong className="text-purple-300">기존 회원:</strong> <code>홍길동, 김철수</code> (급수·성별 자동 매칭)</li>
                  <li><strong className="text-amber-300">꼬깔 번호:</strong> <code>홍길동 12</code> (번호표 12번 함께 등록)</li>
                  <li><strong className="text-emerald-300">신규 회원:</strong> <code>박지성 남 A</code>, <code>손흥민 7 남 S</code></li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5" />
                    <span>꼬깔번호 &amp; 콕제출</span>
                  </div>
                  <p className="text-slate-300">[꼬깔확인]으로 번호 입력·표시 / [🏸 콕제출]로 제출 인원 집계</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                  <div className="font-bold text-purple-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>전체회원 .json 백업</span>
                  </div>
                  <p className="text-slate-300">[전체회원] → [기기 파일 저장]으로 명부 백업 및 복원</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: 옵션 & 꿀팁 */}
          {activeTab === 'tips' && (
            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5" />
                  <span>⚖️ 4가지 복식 조편성 방식 &amp; 매칭 세부 옵션</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-300">
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-emerald-300">• 실력 밸런스:</strong> 급수 균형 맞춤 편성</div>
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-amber-300">• 완전 랜덤:</strong> 급수 무관 무작위 추첨</div>
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-blue-300">• 복식 우선:</strong> 남복(4남)·여복(4여)만 편성</div>
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800"><strong className="text-pink-300">• 혼복 우선:</strong> 혼복(2남2여) 최우선 편성</div>
                </div>
                <div className="pt-1 space-y-1 text-[11px] text-slate-300">
                  <div>• <strong className="text-cyan-300">직전 경기 휴식자 우선 출전 (연속 대기 방지):</strong> 쉬고 있는 대기 인원을 우선 배정하여 연속 대기를 방지합니다.</div>
                  <div>• <strong className="text-purple-300">이전 배정 경기와 중복 방지:</strong> 직전 배정된 경기의 4명 중 2명 이상이 다시 같은 경기에 겹치지 않도록 편성합니다.</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-amber-300">⏱️ 지각 20분 보정:</strong> 첫 배정 20분 뒤 등록·출석 선수의 연속 배정 독점 방지
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-pink-400">💗 고정 파트너:</strong> 지정한 두 선수를 같은 코트/팀 우선 배정
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-blue-300">🖥️ 화면 &amp; 효과음:</strong> 상단 전체화면 전환 및 타구음/휘슬 ON·OFF
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <strong className="text-purple-300">🧪 안전한 초기화:</strong> [초기화] 시에도 [전체회원] 명부는 영구 보존
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
