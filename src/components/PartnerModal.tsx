import React, { useState } from 'react';
import { Player, TIER_LABELS } from '../types';
import {
  X,
  UserPlus,
  Trash2,
  Sparkles,
  Link2,
  Unlink2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import {
  getUniquePartnerPairs,
  setPartnerPair,
  removePartnerPair,
  clearAllPartners,
  PARTNER_COLOR_PALETTE,
} from '../utils/partnerUtils';
import { PartnerDot } from './PartnerDot';
import { CrossedRacketsIcon } from './CrossedRacketsIcon';

interface PartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  players: Player[];
  onUpdatePlayers: (players: Player[]) => void;
}

export const PartnerModal: React.FC<PartnerModalProps> = ({
  isOpen,
  onClose,
  players,
  onUpdatePlayers,
}) => {
  const [selectedPlayer1Id, setSelectedPlayer1Id] = useState<string>('');
  const [selectedPlayer2Id, setSelectedPlayer2Id] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  if (!isOpen) return null;

  const pairs = getUniquePartnerPairs(players);
  const unpartneredPlayers = players.filter((p) => !p.partnerId);

  // Next available color for the new pair preview
  const nextColor = PARTNER_COLOR_PALETTE[pairs.length % PARTNER_COLOR_PALETTE.length];

  const handleCreatePair = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    if (!selectedPlayer1Id || !selectedPlayer2Id) {
      setErrorMessage('파트너로 연결할 두 선수를 모두 선택해주세요.');
      return;
    }

    if (selectedPlayer1Id === selectedPlayer2Id) {
      setErrorMessage('서로 다른 두 선수를 선택해야 합니다.');
      return;
    }

    soundEffects.playScorePoint();
    const updated = setPartnerPair(players, selectedPlayer1Id, selectedPlayer2Id);
    onUpdatePlayers(updated);

    setSelectedPlayer1Id('');
    setSelectedPlayer2Id('');
  };

  const handleRemovePair = (playerId: string) => {
    soundEffects.playRacketHit();
    const updated = removePartnerPair(players, playerId);
    onUpdatePlayers(updated);
  };

  const handleClearAll = () => {
    if (pairs.length === 0) return;
    soundEffects.playRacketHit();
    const updated = clearAllPartners(players);
    onUpdatePlayers(updated);
    setConfirmClearAll(false);
  };

  const p1 = players.find((p) => p.id === selectedPlayer1Id);
  const p2 = players.find((p) => p.id === selectedPlayer2Id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 flex items-center justify-between gap-2.5 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
              <CrossedRacketsIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white">파트너 설정</h2>
                <span className="text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 font-bold">
                  {pairs.length}쌍 설정됨
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400">
                지정된 두 선수는 자동 경기 생성 시 더 높은 확률로 같은 코트에 우선 배정됩니다.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 space-y-5 overflow-y-auto flex-1">
          {/* New Pair Creation Box */}
          <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-purple-400" />
                <span>새 파트너 연결</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>배정 색상:</span>
                <CrossedRacketsIcon
                  className="w-4 h-4 shrink-0 animate-partner-twinkle"
                  style={{ color: nextColor.glow, filter: `drop-shadow(0 0 6px ${nextColor.glow})` }}
                />
                <span className={`font-semibold ${nextColor.text}`}>{nextColor.name}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Player 1 Selector */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  첫 번째 선수
                </label>
                <select
                  value={selectedPlayer1Id}
                  onChange={(e) => {
                    setSelectedPlayer1Id(e.target.value);
                    setErrorMessage(null);
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-400"
                >
                  <option value="">선수 선택...</option>
                  {players.map((p) => {
                    const isPartnered = !!p.partnerId;
                    const partner = players.find((x) => x.id === p.partnerId);
                    return (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={p.id === selectedPlayer2Id}
                      >
                        {p.name} ({p.gender === 'M' ? '남' : '여'} / {p.tier}조)
                        {isPartnered ? ` [기존: ${partner?.name || '파트너'}]` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Player 2 Selector */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  두 번째 선수
                </label>
                <select
                  value={selectedPlayer2Id}
                  onChange={(e) => {
                    setSelectedPlayer2Id(e.target.value);
                    setErrorMessage(null);
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-400"
                >
                  <option value="">선수 선택...</option>
                  {players.map((p) => {
                    const isPartnered = !!p.partnerId;
                    const partner = players.find((x) => x.id === p.partnerId);
                    return (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={p.id === selectedPlayer1Id}
                      >
                        {p.name} ({p.gender === 'M' ? '남' : '여'} / {p.tier}조)
                        {isPartnered ? ` [기존: ${partner?.name || '파트너'}]` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Error Message if any */}
            {errorMessage && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Preview and Submit */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-slate-400 flex items-center gap-2">
                {p1 && p2 ? (
                  <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                    <span
                      className={`font-bold ${
                        p1.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                      }`}
                    >
                      {p1.name}
                    </span>
                    <CrossedRacketsIcon className="w-3.5 h-3.5 text-pink-400" />
                    <span
                      className={`font-bold ${
                        p2.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                      }`}
                    >
                      {p2.name}
                    </span>
                    <span className="text-slate-500 ml-1">연결 준비 완료</span>
                  </div>
                ) : (
                  <span>명단에서 두 선수를 선택해 연결하세요.</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleCreatePair()}
                disabled={!selectedPlayer1Id || !selectedPlayer2Id}
                className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 disabled:opacity-40 disabled:pointer-events-none text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md shadow-purple-500/20 cursor-pointer shrink-0"
              >
                <CrossedRacketsIcon className="w-3.5 h-3.5" />
                <span>파트너 연결하기</span>
              </button>
            </div>
          </div>

          {/* Current Partner Pairs List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>등록된 파트너 목록 ({pairs.length}쌍)</span>
              </span>
              {pairs.length > 0 &&
                (confirmClearAll ? (
                  <div className="flex items-center gap-1.5 animate-fadeIn">
                    <span className="text-[11px] text-rose-400 font-bold">전체 해제할까요?</span>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-400 text-white font-bold text-[10px] transition-colors cursor-pointer"
                    >
                      확인
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(false)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition-colors cursor-pointer"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(true)}
                    className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>전체 해제</span>
                  </button>
                ))}
            </div>

            {pairs.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40">
                <CrossedRacketsIcon className="w-7 h-7 text-slate-600 mx-auto mb-2" />
                <div className="text-xs font-semibold text-slate-400">
                  현재 설정된 파트너가 없습니다
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  위에서 두 선수를 선택하여 파트너로 연결하면, 같은 코트에 더 높은 확률로 배정됩니다.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pairs.map((pair, idx) => {
                  const meta1 = TIER_LABELS[pair.player1.tier] || TIER_LABELS.Beginner;
                  const meta2 = TIER_LABELS[pair.player2.tier] || TIER_LABELS.Beginner;

                  return (
                    <div
                      key={pair.pairKey}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                    >
                      {/* Left: Glowing Partner Icon + Pair Num + Color name */}
                      <div className="flex items-center gap-2 shrink-0">
                        <CrossedRacketsIcon
                          className="w-4 h-4 shrink-0 animate-partner-twinkle"
                          style={{
                            color: pair.color.glow,
                            filter: `drop-shadow(0 0 7px ${pair.color.glow})`,
                          }}
                        />
                        <span className="text-xs font-mono font-bold text-slate-400">
                          #{idx + 1}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-700/60 bg-slate-900 ${pair.color.text}`}
                        >
                          {pair.color.name}
                        </span>
                      </div>

                      {/* Middle: Player 1 & Player 2 */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 justify-center min-w-0">
                        {/* Player 1 */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-xs font-bold truncate ${
                              pair.player1.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                            }`}
                          >
                            {pair.player1.name}
                          </span>
                          <span
                            className={`text-[9px] px-1 py-0.2 rounded border ${meta1.bg} ${meta1.color} shrink-0`}
                          >
                            {meta1.short}
                          </span>
                        </div>

                        {/* Crossed rackets connector */}
                        <CrossedRacketsIcon className="w-3.5 h-3.5 text-pink-400 shrink-0" />

                        {/* Player 2 */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-xs font-bold truncate ${
                              pair.player2.gender === 'M' ? 'text-blue-400' : 'text-pink-400'
                            }`}
                          >
                            {pair.player2.name}
                          </span>
                          <span
                            className={`text-[9px] px-1 py-0.2 rounded border ${meta2.bg} ${meta2.color} shrink-0`}
                          >
                            {meta2.short}
                          </span>
                        </div>
                      </div>

                      {/* Right: Unlink Button */}
                      <button
                        type="button"
                        onClick={() => handleRemovePair(pair.player1.id)}
                        title="파트너 해제"
                        className="px-2 py-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30 text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer shrink-0"
                      >
                        <Unlink2 className="w-3 h-3" />
                        <span className="hidden sm:inline">해제</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-400">
            파트너 아이콘 색상은 파트너 쌍마다 각각 다르게 표시됩니다.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
