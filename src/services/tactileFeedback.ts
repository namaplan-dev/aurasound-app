/**
 * Precision acoustic micro-sounds & Web Vibration API haptics
 * Crafted for audiophile hardware feel (damped clicks, rotary detents, warm harmonics).
 */

class TactileFeedbackEngine {
  private ctx: AudioContext | null = null;
  private soundsEnabled = true;
  private hapticsEnabled = true;
  private lastDetentAt = 0;

  public configure(soundsEnabled: boolean, hapticsEnabled: boolean): void {
    this.soundsEnabled = soundsEnabled;
    this.hapticsEnabled = hapticsEnabled;
  }

  private getContext(): AudioContext | null {
    if (!this.soundsEnabled) return null;
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.hapticsEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore on unsupported browsers
      }
    }
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    gainPeak: number,
    type: OscillatorType = 'sine',
    delaySec = 0
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + durationSec);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  /** Soft mechanical switch tap for tabs, buttons, list selection */
  public tap(): void {
    this.vibrate(5);
    this.playTone(680, 420, 0.016, 0.028, 'triangle');
  }

  /** Crisp toggle switch click */
  public toggle(on: boolean): void {
    this.vibrate(on ? 9 : 6);
    if (on) {
      this.playTone(520, 790, 0.022, 0.032, 'triangle');
    } else {
      this.playTone(620, 390, 0.022, 0.028, 'triangle');
    }
  }

  /** Synchronously prime/resume AudioContext inside pointerdown gesture */
  public unlock(): void {
    this.getContext();
  }

  /** Precision handle grab on right-side A-Z / А-Я slider */
  public sliderGrab(): void {
    this.unlock();
    this.vibrate(8);
    this.playTone(240, 140, 0.02, 0.038, 'sine');
  }

  /** Crisp, brief acoustic tick & haptic pulse whenever a new letter pops during scroll */
  public letterPop(ratio: number, isBoundary = false): void {
    this.vibrate(isBoundary ? 9 : 6);
    const clamped = Math.max(0, Math.min(1, ratio));
    const baseFreq = isBoundary ? 1240 : 780 + clamped * 420;
    this.playTone(
      baseFreq,
      baseFreq * 0.68,
      isBoundary ? 0.022 : 0.015,
      isBoundary ? 0.055 : 0.045,
      'triangle'
    );
  }

  /** Intelligent throttled notch detent as slider crosses steps */
  public sliderDetent(ratio: number, isBoundary = false): void {
    const now = performance.now();
    if (!isBoundary && now - this.lastDetentAt < 22) {
      return;
    }
    this.lastDetentAt = now;

    this.vibrate(isBoundary ? 11 : 6);
    const clamped = Math.max(0, Math.min(1, ratio));
    const baseFreq = isBoundary ? 1320 : 760 + clamped * 460;
    this.playTone(baseFreq, baseFreq * 0.72, isBoundary ? 0.024 : 0.015, isBoundary ? 0.042 : 0.03, 'triangle');
  }

  /** Soft settle tap when releasing slider handle */
  public sliderRelease(): void {
    this.vibrate(5);
    this.playTone(280, 170, 0.018, 0.024, 'sine');
  }

  /** Center 0.0 dB / mechanical detent snap for EQ sliders */
  public eqDetent(): void {
    this.vibrate(8);
    this.playTone(980, 720, 0.018, 0.028, 'triangle');
  }

  /** Play / Pause / Skip relay response (subtle so it complements music) */
  public playAction(starting = true): void {
    this.vibrate(9);
    if (starting) {
      this.playTone(340, 480, 0.024, 0.024, 'sine');
    } else {
      this.playTone(420, 290, 0.022, 0.022, 'sine');
    }
  }

  /** Warm harmonic chime for favorite heart */
  public favorite(liked: boolean): void {
    this.vibrate(liked ? [8, 18, 10] : 6);
    if (liked) {
      this.playTone(523.25, 523.25, 0.045, 0.032, 'sine', 0);
      this.playTone(783.99, 783.99, 0.065, 0.034, 'sine', 0.032);
    } else {
      this.playTone(440, 311, 0.03, 0.024, 'sine');
    }
  }

  /** Pentatonic glass-bell tap for 1-5 star ratings */
  public star(rating: number): void {
    if (rating <= 0) {
      this.tap();
      return;
    }
    const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
    const freq = notes[Math.min(4, Math.max(0, rating - 1))];
    this.vibrate(7);
    this.playTone(freq, freq * 1.01, 0.055, 0.034, 'sine');
  }

  /** Airy open/close gesture feedback for Now Playing / Modals */
  public sheet(open: boolean): void {
    this.vibrate(7);
    if (open) {
      this.playTone(280, 460, 0.035, 0.026, 'sine');
    } else {
      this.playTone(440, 240, 0.032, 0.024, 'sine');
    }
  }

  /** Gentle major triad shimmer for Backup, Restore, AI Mix & Tag Apply completion */
  public success(): void {
    this.vibrate([10, 24, 14]);
    this.playTone(523.25, 523.25, 0.07, 0.028, 'sine', 0);
    this.playTone(659.25, 659.25, 0.08, 0.028, 'sine', 0.045);
    this.playTone(783.99, 783.99, 0.11, 0.03, 'sine', 0.09);
  }
}

export const tactile = new TactileFeedbackEngine();
