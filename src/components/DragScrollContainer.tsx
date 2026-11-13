import React, { useRef, useEffect } from 'react';

interface DragScrollContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  scrollToStartTrigger?: number;
  scrollToEndTrigger?: number;
}

/**
 * A horizontal scroll container that supports both native touch swiping and mouse click-and-drag scrolling.
 * Hides scrollbars cleanly across all browsers while allowing button clicks without interference.
 */
export const DragScrollContainer: React.FC<DragScrollContainerProps> = ({
  children,
  className = '',
  scrollToStartTrigger,
  scrollToEndTrigger,
  ...props
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevStartTriggerRef = useRef<number | undefined>(scrollToStartTrigger);
  const prevEndTriggerRef = useRef<number | undefined>(scrollToEndTrigger);

  useEffect(() => {
    if (
      scrollToStartTrigger !== undefined &&
      prevStartTriggerRef.current !== undefined &&
      scrollToStartTrigger > prevStartTriggerRef.current
    ) {
      containerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    }
    prevStartTriggerRef.current = scrollToStartTrigger;
  }, [scrollToStartTrigger]);

  useEffect(() => {
    if (
      scrollToEndTrigger !== undefined &&
      prevEndTriggerRef.current !== undefined &&
      scrollToEndTrigger > prevEndTriggerRef.current &&
      containerRef.current
    ) {
      containerRef.current.scrollTo({
        left: containerRef.current.scrollWidth,
        behavior: 'smooth',
      });
    }
    prevEndTriggerRef.current = scrollToEndTrigger;
  }, [scrollToEndTrigger]);

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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only primary (left) mouse button
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    dragStateRef.current = {
      isDown: true,
      startX: e.clientX,
      scrollLeft: container.scrollLeft,
      hasMoved: false,
    };

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      if (document.body.dataset.cardReorderDragging === 'true') {
        dragStateRef.current.isDown = false;
        dragStateRef.current.hasMoved = false;
        return;
      }
      if (!dragStateRef.current.isDown) return;
      const targetContainer = containerRef.current;
      if (!targetContainer) return;

      const deltaX = moveEvent.clientX - dragStateRef.current.startX;
      if (!dragStateRef.current.hasMoved && Math.abs(deltaX) > 6) {
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

  const handleClickCapture = (e: React.MouseEvent) => {
    if (dragStateRef.current.hasMoved) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onClickCapture={handleClickCapture}
      onDragStart={(e) => {
        // Prevent parent HTML5 drag-and-drop from hijacking horizontal scroll
        e.stopPropagation();
      }}
      className={`overflow-x-auto touch-manipulation no-scrollbar [scrollbar-width:none] [&::-webkit-scrollbar]:hidden select-none cursor-grab active:cursor-grabbing ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
