import React, { useRef, useEffect } from 'react';
import { ConeItem, getNormalizedTurnQueue } from '../types';
import { ConeIcon } from './ConeIcon';

interface HeaderConeScrollProps {
  cones: ConeItem[];
  currentIdx: number;
}

/**
 * 코트 헤더 내 꼬깔 순서 표시 컴포넌트
 * - 꼬깔 3개까지는 한눈에 표시
 * - 꼬깔 3개 이후(4개 이상)부터 좌우 스크롤 활성화 (모바일 터치 스와이프 및 마우스 드래그 지원)
 * - <, > 이동 버튼 및 스크롤바 모양 완전히 숨김
 * - 순환 매커니즘 반영: (1번째 → 2번째 → 3번째) -> 1번째 종료 시 (2번째 → 3번째 → 1번째) -> 신규 + 시 뒤에서부터 생성되며 (2번째 → 3번째 → 1번째 → 4번째) 순환
 */
export const HeaderConeScroll: React.FC<HeaderConeScrollProps> = ({
  cones,
  currentIdx,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragStateRef = useRef({
    isDown: false,
    startX: 0,
    scrollLeft: 0,
    hasMoved: false,
  });

  const normalizedCones = getNormalizedTurnQueue(cones, currentIdx);
  const activeId = normalizedCones[0]?.id;
  const prevConesLengthRef = useRef(normalizedCones.length);
  const isScrollable = normalizedCones.length > 3;

  // 현재 활성 꼬깔(턴)이 바뀌거나 꼬깔이 추가되면 해당 위치로 부드럽게 자동 스크롤
  useEffect(() => {
    const wasAdded = normalizedCones.length > prevConesLengthRef.current;
    prevConesLengthRef.current = normalizedCones.length;

    if (!isScrollable) return;
    const container = scrollRef.current;
    if (!container) return;

    // 신규 꼬깔이 + 추가된 경우 맨 뒤(맨 오른쪽)에 생성된 꼬깔이 보이도록 스크롤 이동
    if (wasAdded) {
      container.scrollTo({
        left: container.scrollWidth,
        behavior: 'smooth',
      });
      return;
    }

    const activeEl = itemRefs.current[0];
    if (!activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const offset =
      activeRect.left -
      containerRect.left +
      container.scrollLeft -
      containerRect.width / 2 +
      activeRect.width / 2;

    container.scrollTo({
      left: Math.max(0, offset),
      behavior: 'smooth',
    });
  }, [activeId, normalizedCones.length, isScrollable]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isScrollable || e.button !== 0) return;
    e.stopPropagation();
    const container = scrollRef.current;
    if (!container) return;

    dragStateRef.current = {
      isDown: true,
      startX: e.clientX,
      scrollLeft: container.scrollLeft,
      hasMoved: false,
    };

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStateRef.current.isDown) return;
      const target = scrollRef.current;
      if (!target) return;

      const deltaX = moveEvent.clientX - dragStateRef.current.startX;
      if (!dragStateRef.current.hasMoved && Math.abs(deltaX) > 3) {
        dragStateRef.current.hasMoved = true;
      }
      if (dragStateRef.current.hasMoved) {
        moveEvent.preventDefault();
        target.scrollLeft = dragStateRef.current.scrollLeft - deltaX;
      }
    };

    const handleWindowMouseUp = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      if (dragStateRef.current.isDown) {
        dragStateRef.current.isDown = false;
        setTimeout(() => {
          dragStateRef.current.hasMoved = false;
        }, 50);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  if (normalizedCones.length === 0) {
    return <span className="text-[10px] text-slate-500 italic">미설정</span>;
  }

  return (
    <div
      ref={scrollRef}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        if (isScrollable) {
          e.stopPropagation();
        }
      }}
      className={`flex items-center gap-1 px-0.5 py-0.5 shrink-0 select-none touch-manipulation no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        isScrollable
          ? 'max-w-[64px] sm:max-w-[68px] overflow-x-auto cursor-grab active:cursor-grabbing'
          : 'overflow-visible'
      }`}
    >
      {normalizedCones.map((cone, idx) => {
        const isActive = idx === 0;
        const displayNum = cone.orderNumber ?? idx + 1;
        return (
          <div
            key={cone.id || idx}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            className={`p-0.5 rounded transition-transform shrink-0 ${
              isActive
                ? 'ring-1 ring-emerald-400 bg-slate-900 scale-105'
                : 'opacity-50'
            }`}
            title={`${displayNum}번째: ${cone.color === 'red' ? '우리클럽' : '다른클럽'}${isActive ? ' (현재 차례)' : ''}`}
          >
            <ConeIcon color={cone.color} size="xs" isActive={isActive} />
          </div>
        );
      })}
    </div>
  );
};

