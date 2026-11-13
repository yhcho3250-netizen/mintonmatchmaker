import {
  DEVICE_STORAGE_KEYS,
  getDeviceStorageItem,
  setDeviceStorageItem,
  subscribeDeviceStorageHydration,
} from './deviceStorage';

type SoundStateListener = (enabled: boolean) => void;

/**
 * Sound Controller - Web Audio API 효과음 및 전 메뉴 실시간 소리 ON/OFF 동기화 컨트롤러
 */
class SoundController {
  private enabled: boolean = true;
  private ctx: AudioContext | null = null;
  private listeners: Set<SoundStateListener> = new Set();
  private lastPlayedTimeMap: Map<string, number> = new Map();
  private lastGlobalPlayedTime: number = 0;

  constructor() {
    const saved = getDeviceStorageItem(DEVICE_STORAGE_KEYS.SOUND_ENABLED);
    if (saved !== null) {
      this.enabled = saved !== 'false';
    } else {
      this.enabled = true;
    }

    // 기기 내부 저장소(IndexedDB/OPFS) 복원 및 백업 파일 불러오기 시 소리 설정 동기화
    subscribeDeviceStorageHydration((restored) => {
      if (DEVICE_STORAGE_KEYS.SOUND_ENABLED in restored) {
        const nextEnabled = restored[DEVICE_STORAGE_KEYS.SOUND_ENABLED] !== 'false';
        if (this.enabled !== nextEnabled) {
          this.enabled = nextEnabled;
          this.notifyListeners();
        }
      }
    });
  }

  /**
   * 효과음 중복 및 동시 재생 시 소리 겹침(Overlapping) 방지를 위한 디바운스/쿨다운 가드
   */
  private shouldPlay(soundType: string, cooldownMs: number = 100): boolean {
    if (!this.enabled || typeof window === 'undefined') return false;
    const now = Date.now();
    const lastTypeTime = this.lastPlayedTimeMap.get(soundType) || 0;

    // 동일 효과음이 cooldownMs 이내 재요청되거나, 임의 효과음이 60ms 이내 동시에 연달아 호출될 때 차단
    if (now - lastTypeTime < cooldownMs || now - this.lastGlobalPlayedTime < 60) {
      return false;
    }

    this.lastPlayedTimeMap.set(soundType, now);
    this.lastGlobalPlayedTime = now;
    return true;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch {
          return null;
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.enabled);
      } catch {
        // ignore
      }
    });
  }

  public subscribe(listener: SoundStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    setDeviceStorageItem(DEVICE_STORAGE_KEYS.SOUND_ENABLED, String(enabled));
    if (!enabled && this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
    this.notifyListeners();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggle(): boolean {
    const next = !this.enabled;
    this.setEnabled(next);
    if (next) {
      this.playScorePoint();
    }
    return next;
  }

  /**
   * 셔틀콕 타구음 / 버튼 클릭 효과음 (경쾌한 타격음)
   */
  public playRacketHit(): void {
    if (!this.shouldPlay('racketHit', 100)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.055);

      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.06);
    } catch {
      // ignore audio context errors
    }
  }

  /**
   * 포인트 득점 / 대기열 추가 / 상태 변경 알림음 (밝은 2음 차임)
   */
  public playScorePoint(): void {
    if (!this.shouldPlay('scorePoint', 120)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [587.33, 880]; // D5 -> A5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + idx * 0.065;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.14, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.15);
      });
    } catch {
      // ignore
    }
  }

  /**
   * 코트 경기 투입 / 시작 휘슬 효과음
   */
  public playWhistle(): void {
    if (!this.shouldPlay('whistle', 150)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const pulses = [0, 0.09];
      pulses.forEach((offset, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + offset;
        const duration = idx === 0 ? 0.07 : 0.16;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1760, start);
        osc.frequency.linearRampToValueAtTime(2093, start + duration);

        gain.gain.setValueAtTime(0.13, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration + 0.01);
      });
    } catch {
      // ignore
    }
  }

  /**
   * 경기 완료 팡파레 효과음 (화음 아르페지오)
   */
  public playWinFanfare(): void {
    if (!this.shouldPlay('winFanfare', 200)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + idx * 0.06;
        const duration = idx === notes.length - 1 ? 0.24 : 0.12;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.14, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + duration + 0.01);
      });
    } catch {
      // ignore
    }
  }
}

export const soundEffects = new SoundController();

