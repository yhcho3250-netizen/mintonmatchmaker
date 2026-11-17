import React from 'react';

export interface CrossedRacketsIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * 배드민턴 라켓 두 자루가 X자로 교차(크로스)된 파트너 전용 아이콘
 */
export const CrossedRacketsIcon: React.FC<CrossedRacketsIconProps> = ({
  className = 'w-4 h-4',
  style,
  ...rest
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      {...rest}
    >
      {/* 첫 번째 라켓: 좌측 상단 헤드 -> 우측 하단 손잡이 (\ 방향) */}
      <g transform="rotate(-42 12 14)">
        {/* 라켓 헤드 (타원형 프레임) */}
        <ellipse cx="12" cy="6" rx="3.5" ry="4.4" strokeWidth="2" />
        {/* 라켓 거트(스트링) 십자 격자 */}
        <line x1="12" y1="2" x2="12" y2="10" strokeWidth="1.1" strokeOpacity="0.7" />
        <line x1="8.8" y1="4.7" x2="15.2" y2="4.7" strokeWidth="1.1" strokeOpacity="0.7" />
        <line x1="8.8" y1="7.3" x2="15.2" y2="7.3" strokeWidth="1.1" strokeOpacity="0.7" />
        {/* 라켓 샤프트 (대) */}
        <line x1="12" y1="10.4" x2="12" y2="17" strokeWidth="1.9" />
        {/* 그립 칼라 & 손잡이 */}
        <line x1="10.7" y1="17" x2="13.3" y2="17" strokeWidth="1.6" />
        <line x1="12" y1="17" x2="12" y2="21.5" strokeWidth="3" />
      </g>

      {/* 두 번째 라켓: 우측 상단 헤드 -> 좌측 하단 손잡이 (/ 방향) */}
      <g transform="rotate(42 12 14)">
        {/* 라켓 헤드 (타원형 프레임) */}
        <ellipse cx="12" cy="6" rx="3.5" ry="4.4" strokeWidth="2" />
        {/* 라켓 거트(스트링) 십자 격자 */}
        <line x1="12" y1="2" x2="12" y2="10" strokeWidth="1.1" strokeOpacity="0.7" />
        <line x1="8.8" y1="4.7" x2="15.2" y2="4.7" strokeWidth="1.1" strokeOpacity="0.7" />
        <line x1="8.8" y1="7.3" x2="15.2" y2="7.3" strokeWidth="1.1" strokeOpacity="0.7" />
        {/* 라켓 샤프트 (대) */}
        <line x1="12" y1="10.4" x2="12" y2="17" strokeWidth="1.9" />
        {/* 그립 칼라 & 손잡이 */}
        <line x1="10.7" y1="17" x2="13.3" y2="17" strokeWidth="1.6" />
        <line x1="12" y1="17" x2="12" y2="21.5" strokeWidth="3" />
      </g>
    </svg>
  );
};
