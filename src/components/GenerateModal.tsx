import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MatchOptions, MatchmakingMode, MasterMember, Player } from '../types';
import {
  X,
  Shuffle,
  Scale,
  Users2,
  Users,
  Check,
  SlidersHorizontal,
  RotateCcw,
  Volume2,
  VolumeX,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  Share2,
  FileJson,
  Trash2,
} from 'lucide-react';
import { soundEffects } from '../utils/audio';
import {
  exportDataToDeviceFile,
  shareDataFileOnDevice,
  getDefaultBackupFileName,
  parseAndRestoreDeviceBackupJson,
  saveBackupToAppSlot,
  fetchAppBackupSlots,
  loadBackupSlotJsonText,
  deleteAppBackupSlot,
  SavedBackupSlotMeta,
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
} from '../utils/deviceStorage';
import {
  saveMasterMembersToStorage,
  reconcilePlayersWithMasterMembers,
  loadMasterMembersFromStorage,
} from '../utils/masterMemberStorage';

interface GenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: MatchOptions;
  onOptionsChange: (newOptions: MatchOptions) => void;
  activePlayersCount: number;
  onGenerateTestPlayers?: () => void;
  onOpenResetModal?: () => void;
  masterMembers?: MasterMember[];
  onUpdateMasterMembers?: (members: MasterMember[]) => void;
  currentPlayers?: Player[];
  onUpdatePlayers?: (players: Player[]) => void;
}

export const GenerateModal: React.FC<GenerateModalProps> = ({
  isOpen,
  onClose,
  options,
  onOptionsChange,
  activePlayersCount,
  onOpenResetModal,
  onUpdateMasterMembers,
  currentPlayers,
  onUpdatePlayers,
}) => {
  // Local draft options so changes are only committed when clicking 저장 (Save)
  // and discarded when clicking 취소 (Cancel) or closing the modal
  const [draftOptions, setDraftOptions] = useState<MatchOptions>(options);

  // Fullscreen state synced with browser events across all menus
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
  });

  // Sound state synced with soundEffects controller & deviceStorage across all menus
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    return soundEffects.isEnabled();
  });
  const initialSoundEnabledRef = useRef<boolean>(soundEffects.isEnabled());
  const prevIsOpenRef = useRef<boolean>(false);
  const [testPlayersNotice, setTestPlayersNotice] = useState<string | null>(null);

  // Device File Save & Load Modal States
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modalAlert, setModalAlert] = useState<{
    title: string;
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [showSaveFileModal, setShowSaveFileModal] = useState(false);
  const [showLoadFileModal, setShowLoadFileModal] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');
  const [isSavingBackup, setIsSavingBackup] = useState(false);
  const [savedBackupSlots, setSavedBackupSlots] = useState<SavedBackupSlotMeta[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setDraftOptions(options);
      setIsFullscreen(Boolean(document.fullscreenElement));
      const currentSound = soundEffects.isEnabled();
      setIsSoundEnabled(currentSound);
      initialSoundEnabledRef.current = currentSound;
      setTestPlayersNotice(null);
    }
    if (!isOpen) {
      setModalAlert(null);
      setShowSaveFileModal(false);
      setShowLoadFileModal(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, options]);

  useEffect(() => {
    if (isOpen) {
      setDraftOptions((prev) =>
        prev.courtCount !== options.courtCount
          ? { ...prev, courtCount: options.courtCount }
          : prev
      );
    }
  }, [isOpen, options.courtCount]);

  useEffect(() => {
    return soundEffects.subscribe((enabled) => {
      setIsSoundEnabled(enabled);
    });
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

  const handleCancel = useCallback(() => {
    if (soundEffects.isEnabled() !== initialSoundEnabledRef.current) {
      soundEffects.setEnabled(initialSoundEnabledRef.current);
      setIsSoundEnabled(initialSoundEnabledRef.current);
    }
    setDraftOptions(options);
    setTestPlayersNotice(null);
    soundEffects.playRacketHit();
    onClose();
  }, [options, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (modalAlert) {
          setModalAlert(null);
          return;
        }
        if (showSaveFileModal) {
          setShowSaveFileModal(false);
          return;
        }
        if (showLoadFileModal) {
          setShowLoadFileModal(false);
          return;
        }
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel, modalAlert, showSaveFileModal, showLoadFileModal]);

  const applyRestoredBackupText = (text: string) => {
    const res = parseAndRestoreDeviceBackupJson(text);
    if (res.success) {
      const reloadedMembers = loadMasterMembersFromStorage();
      saveMasterMembersToStorage(reloadedMembers);
      if (onUpdateMasterMembers) {
        onUpdateMasterMembers(reloadedMembers);
      }
      if (
        onUpdatePlayers &&
        currentPlayers &&
        !(DEVICE_STORAGE_KEYS.PLAYERS in res.restoredKeys)
      ) {
        const reconciled = reconcilePlayersWithMasterMembers(currentPlayers, reloadedMembers);
        if (reconciled.hasChanges) {
          onUpdatePlayers(reconciled.updatedPlayers);
        }
      }
      if (DEVICE_STORAGE_KEYS.OPTIONS in res.restoredKeys) {
        try {
          const rawOpts = getDeviceStorageItem(DEVICE_STORAGE_KEYS.OPTIONS);
          if (rawOpts) {
            const restoredOpts = JSON.parse(rawOpts) as Partial<MatchOptions>;
            if (restoredOpts && typeof restoredOpts === 'object') {
              setDraftOptions((prev) => ({
                ...prev,
                ...restoredOpts,
              }));
            }
          }
        } catch {
          // ignore
        }
      }
      if (DEVICE_STORAGE_KEYS.SOUND_ENABLED in res.restoredKeys) {
        const currentSound = soundEffects.isEnabled();
        setIsSoundEnabled(currentSound);
        initialSoundEnabledRef.current = currentSound;
      }
      soundEffects.playWinFanfare();
      setShowLoadFileModal(false);
      setModalAlert({
        title: '백업 파일 불러오기 완료',
        message: res.message,
        type: 'success',
      });
    } else {
      soundEffects.playScorePoint();
      setModalAlert({
        title: '백업 파일 불러오기 실패',
        message: res.message,
        type: 'error',
      });
    }
  };

  const handleOpenSaveModal = () => {
    soundEffects.playRacketHit();
    setSaveFileName(getDefaultBackupFileName());
    setShowSaveFileModal(true);
  };

  const handleSaveToAppSlot = async () => {
    if (isSavingBackup) return;
    setIsSavingBackup(true);
    soundEffects.playRacketHit();
    try {
      const res = await saveBackupToAppSlot(saveFileName);
      setShowSaveFileModal(false);
      if (res.success) {
        soundEffects.playWhistle();
        setModalAlert({
          title: '백업 저장 완료',
          message: `'${res.fileName}' 이름으로 앱 내부 백업함에 안전하게 저장되었습니다. (회원 ${res.memberCount}명 · 참가자 ${res.playerCount}명)`,
          type: 'success',
        });
      } else {
        soundEffects.playScorePoint();
        setModalAlert({
          title: '백업 저장 실패',
          message: '백업 저장 중 오류가 발생했습니다.',
          type: 'error',
        });
      }
    } finally {
      setIsSavingBackup(false);
    }
  };

  const handleDownloadFileToDevice = async () => {
    if (isSavingBackup) return;
    setIsSavingBackup(true);
    soundEffects.playRacketHit();
    try {
      const ok = await exportDataToDeviceFile(saveFileName);
      setShowSaveFileModal(false);
      if (ok) {
        soundEffects.playWhistle();
        setModalAlert({
          title: '기기 파일 저장 완료',
          message: '기기의 다운로드 폴더(및 앱 내부 백업함)에 백업 파일(.json)이 저장되었습니다.',
          type: 'success',
        });
      } else {
        soundEffects.playScorePoint();
        setModalAlert({
          title: '기기 파일 저장 안내',
          message: '파일 저장이 취소되었거나 앱 내부 백업함에만 보관되었습니다.',
          type: 'error',
        });
      }
    } finally {
      setIsSavingBackup(false);
    }
  };

  const handleShareBackupFile = async () => {
    if (isSavingBackup) return;
    setIsSavingBackup(true);
    soundEffects.playRacketHit();
    try {
      const res = await shareDataFileOnDevice(saveFileName);
      setShowSaveFileModal(false);
      if (res.success) {
        soundEffects.playWhistle();
      } else if (!res.cancelled) {
        soundEffects.playScorePoint();
        setModalAlert({
          title: '공유 안내',
          message: '현재 기기에서 공유 창을 열 수 없어 앱 내부 백업함에 저장했습니다.',
          type: 'error',
        });
      }
    } finally {
      setIsSavingBackup(false);
    }
  };

  const handleOpenLoadModal = async () => {
    soundEffects.playRacketHit();
    setShowLoadFileModal(true);
    setIsLoadingSlots(true);
    try {
      const slots = await fetchAppBackupSlots();
      setSavedBackupSlots(slots);
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleSelectSlotToRestore = async (slotId: string) => {
    soundEffects.playRacketHit();
    const jsonText = await loadBackupSlotJsonText(slotId);
    if (!jsonText) {
      soundEffects.playScorePoint();
      setModalAlert({
        title: '불러오기 실패',
        message: '선택한 백업 데이터를 읽을 수 없습니다.',
        type: 'error',
      });
      return;
    }
    applyRestoredBackupText(jsonText);
  };

  const handleDeleteSlot = async (e: React.MouseEvent, slotId: string) => {
    e.stopPropagation();
    soundEffects.playRacketHit();
    await deleteAppBackupSlot(slotId);
    const next = await fetchAppBackupSlots();
    setSavedBackupSlots(next);
  };

  const handleFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '');
      applyRestoredBackupText(text);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  if (!isOpen) return null;

  const maxPlayableCourts = Math.floor(activePlayersCount / 4);

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

  const handleToggleSound = () => {
    const next = soundEffects.toggle();
    setIsSoundEnabled(next);
  };

  const handleModeChange = (mode: MatchmakingMode) => {
    soundEffects.playRacketHit();
    setDraftOptions((prev) => ({ ...prev, mode }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const committedOptions: MatchOptions = {
      ...draftOptions,
      courtCount: options.courtCount,
    };
    initialSoundEnabledRef.current = soundEffects.isEnabled();
    onOptionsChange(committedOptions);
    setTestPlayersNotice(null);
    soundEffects.playWhistle();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fadeIn"
      onClick={handleCancel}
    >
      <div
        className="w-full max-w-lg max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">
                매칭 옵션 설정
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400">
                복식 조 편성 알고리즘 및 코트 운영 방식을 설정합니다
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Device Storage & Backup Banner (Moved directly under Modal Header) */}
        <div className="px-3 sm:px-6 py-2.5 bg-emerald-950/30 border-b border-emerald-500/20 flex flex-row flex-nowrap items-center justify-between gap-1.5 sm:gap-2 shrink-0 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-emerald-300 whitespace-nowrap shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 shrink-0" />
            <strong className="font-bold text-emerald-200 whitespace-nowrap">앱 데이터 저장</strong>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 flex-nowrap shrink-0 ml-auto">
            <button
              type="button"
              onClick={handleOpenSaveModal}
              className="px-2 sm:px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10.5px] sm:text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              title="현재 기기에 전체 데이터 백업 파일(.json) 저장"
            >
              <Download className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>기기 파일 저장</span>
            </button>
            <button
              type="button"
              onClick={handleOpenLoadModal}
              className="px-2 sm:px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10.5px] sm:text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              title="기기에 저장된 백업 파일(.json) 불러오기"
            >
              <Upload className="w-3 h-3 text-sky-400 shrink-0" />
              <span>기기 파일 불러오기</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json,text/plain,*/*"
              onChange={handleFileRestore}
              className="hidden"
            />
          </div>
        </div>

        {/* Modal Content & Fixed Footer */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
            {/* Active Player & Court Sync Status Alert */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">현재 출전 가능 인원</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white tabular-nums font-mono">
                    {activePlayersCount}명
                  </span>
                  {activePlayersCount >= 4 && (
                    <>
                      <span className="text-slate-600">·</span>
                      <span className="text-emerald-400 font-semibold">
                        최대 {maxPlayableCourts}코트 동시 운영 가능
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                <span className="text-slate-400">실시간 연동 운영 코트</span>
                <span className="text-amber-300 font-semibold font-mono">
                  {options.courtCount}개 코트
                </span>
              </div>
            </div>

            {/* Mode Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                복식 조 편성 방식 (알고리즘)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Random Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange('random')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    draftOptions.mode === 'random'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white ring-1 ring-emerald-400 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Shuffle className="w-3.5 h-3.5 text-emerald-400" />
                        <span>완전 랜덤</span>
                      </div>
                      {draftOptions.mode === 'random' && (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      무작위 추첨 (성비 불균형 시 3:1 경기 허용)
                    </div>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-800/80">
                    <span className="inline-block text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                      혼복 비율: 15게임당 3~4.5게임 (약 25%)
                    </span>
                  </div>
                </button>

                {/* Balanced Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange('balanced')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    draftOptions.mode === 'balanced'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white ring-1 ring-emerald-400 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Scale className="w-3.5 h-3.5 text-emerald-400" />
                        <span>실력 밸런스</span>
                      </div>
                      {draftOptions.mode === 'balanced' && (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      급수(A~E조)를 고려해 박빙 경기
                    </div>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-800/80">
                    <span className="inline-block text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                      급수 균형: 팀 합산 점수 차이 최소화
                    </span>
                  </div>
                </button>

                {/* Doubles Only Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange('doubles_only')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    draftOptions.mode === 'doubles_only'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white ring-1 ring-emerald-400 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Users className="w-3.5 h-3.5 text-emerald-400" />
                        <span>복식 우선</span>
                      </div>
                      {draftOptions.mode === 'doubles_only' && (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      남복 및 여복만 편성 (혼합복식 배제)
                    </div>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-800/80">
                    <span className="inline-block text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                      남복·여복 전용 (혼복 없음)
                    </span>
                  </div>
                </button>

                {/* Mixed Preference Mode */}
                <button
                  type="button"
                  onClick={() => handleModeChange('mixed_preference')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    draftOptions.mode === 'mixed_preference'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white ring-1 ring-emerald-400 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Users2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>혼복 우선</span>
                      </div>
                      {draftOptions.mode === 'mixed_preference' && (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      남녀 혼합복식(남녀 vs 남녀) 최우선 편성
                    </div>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-slate-800/80">
                    <span className="inline-block text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                      혼복 비율: 남녀 매칭 최우선 편성
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Additional Options */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800">
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftOptions.avoidConsecutiveRests}
                  onChange={(e) => {
                    soundEffects.playRacketHit();
                    setDraftOptions((prev) => ({
                      ...prev,
                      avoidConsecutiveRests: e.target.checked,
                    }));
                  }}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-400"
                />
                <span>직전 경기 휴식자 우선 출전 (연속 대기 방지)</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftOptions.avoidDuplicatePartners}
                  onChange={(e) => {
                    soundEffects.playRacketHit();
                    setDraftOptions((prev) => ({
                      ...prev,
                      avoidDuplicatePartners: e.target.checked,
                    }));
                  }}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-400"
                />
                <span>이전 배정 경기와 중복 방지</span>
              </label>
            </div>

            {testPlayersNotice && (
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2">
                <span>{testPlayersNotice}</span>
                <button
                  type="button"
                  onClick={() => setTestPlayersNotice(null)}
                  className="text-amber-300 hover:text-white p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Fixed Footer Actions: Single-row alignment for Reset + Sound (Left) & Cancel + Save (Right) */}
          <div className="px-4 sm:px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex flex-row flex-nowrap items-center justify-between gap-2 shrink-0 overflow-x-auto no-scrollbar">
            {/* Bottom-left: Reset Button + Sound Button */}
            <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
              {/* 초기화 버튼 */}
              {onOpenResetModal && (
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playRacketHit();
                    onClose();
                    onOpenResetModal();
                  }}
                  title="데이터 초기화"
                  aria-label="데이터 초기화"
                  className="px-3 h-9 text-xs font-bold text-slate-300 hover:text-rose-400 bg-slate-800/90 hover:bg-rose-500/15 border border-slate-700/80 hover:border-rose-500/40 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>초기화</span>
                </button>
              )}

              {/* 소리 켜기/끄기 버튼 (초기화 버튼 오른쪽) */}
              <button
                type="button"
                onClick={handleToggleSound}
                title={isSoundEnabled ? '소리 켜짐 (클릭하여 소리 끄기)' : '소리 꺼짐 (클릭하여 소리 켜기)'}
                aria-label={isSoundEnabled ? '소리 끄기' : '소리 켜기'}
                aria-pressed={isSoundEnabled}
                className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                  isSoundEnabled
                    ? 'bg-slate-800/90 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 border-slate-700/80 hover:border-emerald-500/50'
                    : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border-rose-500/40'
                }`}
              >
                {isSoundEnabled ? (
                  <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <VolumeX className="w-4 h-4 text-rose-400 shrink-0" />
                )}
              </button>
            </div>

            {/* Bottom-right: Cancel & Save Buttons */}
            <div className="flex items-center justify-end gap-1 sm:gap-2 flex-nowrap shrink-0">
              <button
                type="button"
                onClick={handleCancel}
                className="px-2.5 sm:px-3.5 h-9 text-[11px] sm:text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-3.5 sm:px-5 h-9 text-[11px] sm:text-xs font-bold rounded-xl shadow-lg active:scale-98 transition-all flex items-center justify-center gap-1 cursor-pointer bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-emerald-500/20 whitespace-nowrap shrink-0"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                <span>저장</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Custom In-App Alert Modal */}
      {modalAlert && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            e.stopPropagation();
            setModalAlert(null);
          }}
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  modalAlert.type === 'success'
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                }`}
              >
                {modalAlert.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <AlertCircle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{modalAlert.title}</h3>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{modalAlert.message}</p>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  soundEffects.playRacketHit();
                  setModalAlert(null);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Backup File Modal (Simplified) */}
      {showSaveFileModal && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            e.stopPropagation();
            setShowSaveFileModal(false);
          }}
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <FileJson className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-white">기기 파일 저장</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSaveFileModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                파일 이름 (.json 자동 추가)
              </label>
              <input
                type="text"
                value={saveFileName}
                onChange={(e) => setSaveFileName(e.target.value)}
                placeholder="minton-backup-2026-01-01"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div className="space-y-2">
              <button
                type="button"
                disabled={isSavingBackup}
                onClick={handleSaveToAppSlot}
                className="w-full py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-lg shadow-emerald-500/10"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>앱 내부 백업함에 즉시 저장</span>
              </button>

              <button
                type="button"
                disabled={isSavingBackup}
                onClick={handleDownloadFileToDevice}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>기기 다운로드 폴더에 파일(.json) 저장</span>
              </button>

              <button
                type="button"
                disabled={isSavingBackup}
                onClick={handleShareBackupFile}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 text-sky-400" />
                <span>다른 앱(카카오톡·메모장 등)으로 백업 공유</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Backup File Modal (Simplified) */}
      {showLoadFileModal && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            e.stopPropagation();
            setShowLoadFileModal(false);
          }}
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-white">기기 파일 불러오기</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLoadFileModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-emerald-300">
                저장된 백업 목록 ({savedBackupSlots.length}개)
              </span>

              {isLoadingSlots ? (
                <div className="py-5 text-center text-xs text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
                  백업 목록을 불러오는 중...
                </div>
              ) : savedBackupSlots.length === 0 ? (
                <div className="py-5 px-3 text-center text-xs text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
                  저장된 백업이 없습니다.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {savedBackupSlots.map((slot) => {
                    const dateStr = new Date(slot.createdAt).toLocaleString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <div
                        key={slot.id}
                        onClick={() => handleSelectSlotToRestore(slot.id)}
                        className="p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/40 flex items-center justify-between gap-2 cursor-pointer transition-all group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-white truncate group-hover:text-emerald-300">
                            {slot.fileName}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                            <span>{dateStr}</span>
                            <span>·</span>
                            <span className="text-emerald-400 font-semibold">
                              회원 {slot.memberCount}명
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                            복원
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSlot(e, slot.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                            title="백업 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                soundEffects.playRacketHit();
                fileInputRef.current?.click();
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>기기 폴더에서 백업 파일(.json) 선택</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
