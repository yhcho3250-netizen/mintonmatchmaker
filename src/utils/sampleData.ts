import { Player, Gender, Tier } from '../types';

export const INITIAL_SAMPLE_PLAYERS: Player[] = [
  {
    id: 'p_1',
    name: '김민준',
    gender: 'M',
    tier: 'S',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 160000,
  },
  {
    id: 'p_2',
    name: '이수진',
    gender: 'F',
    tier: 'B',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 150000,
  },
  {
    id: 'p_3',
    name: '박지훈',
    gender: 'M',
    tier: 'B',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 140000,
  },
  {
    id: 'p_4',
    name: '최은지',
    gender: 'F',
    tier: 'C',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 130000,
  },
  {
    id: 'p_5',
    name: '정우성',
    gender: 'M',
    tier: 'A',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 120000,
  },
  {
    id: 'p_6',
    name: '강다은',
    gender: 'F',
    tier: 'C',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 110000,
  },
  {
    id: 'p_7',
    name: '조현우',
    gender: 'M',
    tier: 'C',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 100000,
  },
  {
    id: 'p_8',
    name: '송유진',
    gender: 'F',
    tier: 'D',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 90000,
  },
  {
    id: 'p_9',
    name: '윤도현',
    gender: 'M',
    tier: 'B',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 80000,
  },
  {
    id: 'p_10',
    name: '한소희',
    gender: 'F',
    tier: 'B',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 70000,
  },
  {
    id: 'p_11',
    name: '임태양',
    gender: 'M',
    tier: 'D',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 60000,
  },
  {
    id: 'p_12',
    name: '신아름',
    gender: 'F',
    tier: 'Beginner',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 50000,
  },
  {
    id: 'p_13',
    name: '오준서',
    gender: 'M',
    tier: 'C',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 40000,
  },
  {
    id: 'p_14',
    name: '배수지',
    gender: 'F',
    tier: 'A',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 30000,
  },
  {
    id: 'p_15',
    name: '황보건',
    gender: 'M',
    tier: 'Beginner',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 20000,
  },
  {
    id: 'p_16',
    name: '문채원',
    gender: 'F',
    tier: 'D',
    isActive: true,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsWon: 0,
    totalPointsLost: 0,
    consecutiveRestRounds: 0,
    partnerHistory: {},
    opponentHistory: {},
    createdAt: Date.now() - 10000,
  },
];

/**
 * Generates 24 random test players with realistic Korean names, genders, and varied tiers (including S tier).
 */
export function generateRandom24Players(): Player[] {
  const maleNames = [
    '김민준', '이서준', '박도윤', '최예준', '정시우', '강하준',
    '조주원', '윤지호', '장준우', '임건우', '한우진', '오선우',
    '서연우', '신민재', '권현우', '황지훈', '안승우', '송진우',
    '전문호', '홍동현', '배태양', '백성민', '유동혁', '고재원'
  ];

  const femaleNames = [
    '이서연', '김서윤', '박지우', '최서현', '정하은', '강하윤',
    '조민서', '윤지유', '장윤서', '임지민', '한채원', '오수아',
    '서지아', '신지원', '권소율', '황다은', '안예은', '송소은',
    '전유진', '홍수진', '배채은', '백나은', '유은서', '고예원'
  ];

  // Realistic tier & gender distribution across all 6 tiers (12M + 12F = 24 players):
  // Every tier from Beginner(초심) to S is present in both genders for mixed-tier matches,
  // and all 5 target tiers (A, B, C, D, Beginner) have >= 4 players with valid doubles gender splits:
  // - S: 2명 (남1, 여1)
  // - A: 4명 (남2, 여2)
  // - B: 5명 (남4, 여1)
  // - C: 5명 (남1, 여4)
  // - D: 4명 (남2, 여2)
  // - Beginner(초심): 4명 (남2, 여2)
  const maleTiers: Tier[] = [
    'S',
    'A', 'A',
    'B', 'B', 'B', 'B',
    'C',
    'D', 'D',
    'Beginner', 'Beginner',
  ];
  const femaleTiers: Tier[] = [
    'S',
    'A', 'A',
    'B',
    'C', 'C', 'C', 'C',
    'D', 'D',
    'Beginner', 'Beginner',
  ];

  // Shuffle pools
  const shuffledMales = [...maleNames].sort(() => Math.random() - 0.5);
  const shuffledFemales = [...femaleNames].sort(() => Math.random() - 0.5);
  const shuffledMaleTiers = [...maleTiers].sort(() => Math.random() - 0.5);
  const shuffledFemaleTiers = [...femaleTiers].sort(() => Math.random() - 0.5);

  const players: Player[] = [];
  const baseTime = Date.now() - 60000;

  // 12 Males, 12 Females -> Perfect for 6 doubles courts!
  for (let i = 0; i < 24; i++) {
    const isMale = i < 12;
    const name = isMale ? shuffledMales[i] : shuffledFemales[i - 12];
    const gender: Gender = isMale ? 'M' : 'F';
    const tier = isMale ? shuffledMaleTiers[i] : shuffledFemaleTiers[i - 12];
    const regTime = baseTime + i * 10;

    players.push({
      id: `p_test_${baseTime}_${i + 1}`,
      name,
      gender,
      tier,
      isActive: true,
      isTest: true,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      totalPointsWon: 0,
      totalPointsLost: 0,
      consecutiveRestRounds: 0,
      partnerHistory: {},
      opponentHistory: {},
      createdAt: regTime,
      registeredAt: regTime,
      initialAssignedOffset: 0,
      shuttlecockSubmitted: false,
    });
  }

  // Shuffle the final list so male and female players are naturally interspersed,
  // then reassign sequential registration timestamps in final roster order
  const finalPlayers = players.sort(() => Math.random() - 0.5);
  return finalPlayers.map((p, idx) => ({
    ...p,
    isTest: true,
    createdAt: baseTime + idx * 10,
    registeredAt: baseTime + idx * 10,
    initialAssignedOffset: 0,
  }));
}
