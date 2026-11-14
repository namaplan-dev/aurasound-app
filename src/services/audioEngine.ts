import { StreamingQuality, Track } from '../types/music';
import { EQ_FREQUENCIES } from '../data/seedLibrary';
import { getAudioBlobFromCache } from './offlineCacheService';
import { resolveNativePlaybackUrl } from './nativeScanner';

type ProgressListener = (state: { currentTime: number; duration: number }) => void;
type StatusListener = (state: { isPlaying: boolean; isLoading: boolean; error: string | null }) => void;
type TrackEndListener = () => void;

const synthBlobCache = new Map<string, string>();
const liveObjectUrls = new Map<string, string>();

/**
 * Generates a real, warm, musical 16-bit stereo PCM WAV audio stream (24 seconds seamless loop)
 * for built-in studio tracks or preview-less imports so playback and 10-band EQ work instantaneously.
 */
function synthesizeMusicalWavUrl(track: Track): string {
  const cached = synthBlobCache.get(track.id);
  if (cached) return cached;

  const profile = track.synthProfile || {
    rootHz: 220,
    chord: [1, 1.2, 1.5, 1.875],
    tempoBpm: 72,
    timbre: 'warm-pad' as const,
  };

  const sampleRate = 22050; // lightweight & instantaneous synthesis (~700KB)
  const durationSec = 8;
  const numSamples = sampleRate * durationSec;
  const numChannels = 2;
  const buffer = new ArrayBuffer(44 + numSamples * numChannels * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * numChannels * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * numChannels * 2, true);

  const beatSec = 60 / profile.tempoBpm;
  const chordShiftPattern = [1, 1.12246, 0.8909, 1.0];

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Loop envelope for click-free start/end
    const fadeIn = Math.min(1, t / 0.12);
    const fadeOut = Math.min(1, (durationSec - t) / 0.12);
    const loopEnv = fadeIn * fadeOut;

    const barIndex = Math.floor(t / (beatSec * 4)) % chordShiftPattern.length;
    const harmonicShift = chordShiftPattern[barIndex];

    const beatPhase = (t % beatSec) / beatSec;
    const pluckEnv = Math.exp(-beatPhase * (profile.timbre === 'acoustic-pluck' ? 5.0 : 2.6));
    const arpIdx = Math.floor(t / beatSec) % profile.chord.length;

    let left = 0;
    let right = 0;

    // Warm fundamental + chord voices
    for (let c = 0; c < profile.chord.length; c++) {
      const freq = profile.rootHz * profile.chord[c] * harmonicShift;
      const detune = 1 + (c - 1.5) * 0.0018;
      const pan = 0.35 + (c / Math.max(1, profile.chord.length - 1)) * 0.3;
      const padLfo = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.18 * t + c);

      let wave =
        Math.sin(2 * Math.PI * freq * t) * 0.55 +
        Math.sin(2 * Math.PI * freq * 2 * t) * (profile.timbre === 'warm-pad' ? 0.12 : 0.22);

      if (profile.timbre === 'analog-bass' && c === 0) {
        wave += Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.5;
      }

      const amp = (0.14 / profile.chord.length) * padLfo;
      left += wave * amp * (1 - pan * 0.35);
      right += wave * amp * (0.65 + pan * 0.35);

      // Gentle melodic pulse on active arpeggio note
      if (c === arpIdx) {
        const leadFreq = freq * 2 * detune;
        const leadWave =
          Math.sin(2 * Math.PI * leadFreq * t) +
          0.3 * Math.sin(2 * Math.PI * leadFreq * 2 * t);
        const leadAmp = 0.08 * pluckEnv;
        left += leadWave * leadAmp * 0.85;
        right += leadWave * leadAmp * 1.15;
      }
    }

    // Subtle bass pulse
    const bassFreq = profile.rootHz * 0.5 * harmonicShift;
    const bassWave = Math.sin(2 * Math.PI * bassFreq * t) * (0.12 + 0.06 * pluckEnv);
    left += bassWave;
    right += bassWave;

    const sL = Math.max(-1, Math.min(1, left * loopEnv));
    const sR = Math.max(-1, Math.min(1, right * loopEnv));
    view.setInt16(offset, Math.round(sL * 32767), true);
    view.setInt16(offset + 2, Math.round(sR * 32767), true);
    offset += 4;
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  synthBlobCache.set(track.id, url);
  return url;
}

class HiFiAudioEngine {
  private ctx: AudioContext | null = null;
  private deckA: HTMLAudioElement;
  private deckB: HTMLAudioElement;
  private activeDeck: 'A' | 'B' = 'A';

  private sourceA: MediaElementAudioSourceNode | null = null;
  private sourceB: MediaElementAudioSourceNode | null = null;
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private preampNode: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private qualityFilter: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  private currentTrack: Track | null = null;
  private nextTrack: Track | null = null;
  private isPlaying = false;
  private isLoading = false;
  private lastError: string | null = null;

  private crossfadeSeconds = 2;
  private gaplessPlayback = true;
  private masterVolume = 0.8;
  private eqEnabled = true;
  private eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  private eqPreampDb = 0;
  private streamingQuality: StreamingQuality = 'lossless-hires';

  private isCrossfading = false;
  private preloadedTrackId: string | null = null;
  private progressRaf: number | null = null;
  private lastProgressEmit = 0;

  private progressListeners = new Set<ProgressListener>();
  private statusListeners = new Set<StatusListener>();
  private trackEndListeners = new Set<TrackEndListener>();

  private mediaControlsBound = false;
  private onPrevHandler: (() => void) | null = null;
  private onNextHandler: (() => void) | null = null;

  constructor() {
    this.deckA = new Audio();
    this.deckB = new Audio();
    this.deckA.preload = 'auto';
    this.deckB.preload = 'auto';

    this.attachDeckEvents(this.deckA, 'A');
    this.attachDeckEvents(this.deckB, 'B');
  }

  private attachDeckEvents(deck: HTMLAudioElement, deckId: 'A' | 'B') {
    deck.addEventListener('ended', () => {
      if (this.activeDeck !== deckId) return;
      // Built-in synthesized WAV loops smoothly up to track.duration unless real local file ended
      if (this.currentTrack?.source === 'builtin') {
        return;
      }
      this.isPlaying = false;
      this.emitStatus();
      this.trackEndListeners.forEach((cb) => cb());
    });

    deck.addEventListener('error', () => {
      if (this.activeDeck !== deckId) return;
      this.isPlaying = false;
      this.isLoading = false;
      this.lastError = 'Unable to decode this audio stream in the browser.';
      this.emitStatus();
    });
  }

  private ensureAudioGraph(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();

    this.sourceA = this.ctx.createMediaElementSource(this.deckA);
    this.sourceB = this.ctx.createMediaElementSource(this.deckB);

    this.gainA = this.ctx.createGain();
    this.gainB = this.ctx.createGain();
    this.gainA.gain.value = this.activeDeck === 'A' ? 1 : 0;
    this.gainB.gain.value = this.activeDeck === 'B' ? 1 : 0;

    this.preampNode = this.ctx.createGain();
    this.applyPreampGain();

    this.eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
      const filter = this.ctx!.createBiquadFilter();
      filter.type = idx === 0 ? 'lowshelf' : idx === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.25;
      filter.gain.value = this.eqEnabled ? this.eqBands[idx] || 0 : 0;
      return filter;
    });

    this.qualityFilter = this.ctx.createBiquadFilter();
    this.qualityFilter.type = 'lowpass';
    this.applyStreamingQuality();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.82;

    this.sourceA.connect(this.gainA);
    this.sourceB.connect(this.gainB);
    this.gainA.connect(this.preampNode);
    this.gainB.connect(this.preampNode);

    let chain: AudioNode = this.preampNode;
    for (const eq of this.eqFilters) {
      chain.connect(eq);
      chain = eq;
    }
    chain.connect(this.qualityFilter);
    this.qualityFilter.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  private getActiveElement(): HTMLAudioElement {
    return this.activeDeck === 'A' ? this.deckA : this.deckB;
  }

  private getInactiveElement(): HTMLAudioElement {
    return this.activeDeck === 'A' ? this.deckB : this.deckA;
  }

  public registerLocalUrl(trackId: string, fileOrBlob: Blob): string {
    const existing = liveObjectUrls.get(trackId);
    if (existing) return existing;
    const url = URL.createObjectURL(fileOrBlob);
    liveObjectUrls.set(trackId, url);
    return url;
  }

  private getSyncCachedUrl(track: Track): string | null {
    if (track.source === 'local') {
      const nativeUrl = resolveNativePlaybackUrl(track);
      if (nativeUrl) return nativeUrl;
      return liveObjectUrls.get(track.id) || null;
    }
    return synthBlobCache.get(track.id) || synthesizeMusicalWavUrl(track);
  }

  private async resolveTrackUrl(track: Track): Promise<string> {
    if (track.source === 'local') {
      const nativeUrl = resolveNativePlaybackUrl(track);
      if (nativeUrl) return nativeUrl;
      const existing = liveObjectUrls.get(track.id);
      if (existing) return existing;
      const cachedBlob = await getAudioBlobFromCache(track.id);
      if (cachedBlob) {
        return this.registerLocalUrl(track.id, cachedBlob);
      }
      return synthesizeMusicalWavUrl(track);
    }

    return synthesizeMusicalWavUrl(track);
  }

  public prewarmTracks(tracks: Track[]): void {
    const builtIns = tracks.filter((t) => t.source === 'builtin' && !synthBlobCache.has(t.id));
    if (builtIns.length === 0) return;

    let idx = 0;
    const step = () => {
      if (idx >= builtIns.length) return;
      synthesizeMusicalWavUrl(builtIns[idx++]);
      if (idx < builtIns.length) {
        const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
          .requestIdleCallback;
        if (typeof ric === 'function') {
          ric(step);
        } else {
          window.setTimeout(step, 40);
        }
      }
    };

    window.setTimeout(step, 180);
  }

  public async loadAndPlay(track: Track, nextTrack?: Track | null): Promise<void> {
    this.ensureAudioGraph();
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.currentTrack = track;
    this.nextTrack = nextTrack || null;
    this.isCrossfading = false;
    this.preloadedTrackId = null;
    this.virtualOffsetSec = 0;
    this.pendingRestoreTimeSec = null;
    this.lastError = null;

    const syncUrl = this.getSyncCachedUrl(track);
    if (!syncUrl) {
      this.isLoading = true;
      this.emitStatus();
    }

    try {
      const url = syncUrl || (await this.resolveTrackUrl(track));
      const active = this.getActiveElement();
      const inactive = this.getInactiveElement();

      // Stop inactive deck cleanly
      inactive.pause();
      inactive.currentTime = 0;

      if (this.ctx && this.gainA && this.gainB) {
        const now = this.ctx.currentTime;
        this.gainA.gain.cancelScheduledValues(now);
        this.gainB.gain.cancelScheduledValues(now);
        this.gainA.gain.setValueAtTime(this.activeDeck === 'A' ? 1 : 0, now);
        this.gainB.gain.setValueAtTime(this.activeDeck === 'B' ? 1 : 0, now);
      }

      active.loop = track.source === 'builtin';
      active.src = url;
      active.currentTime = 0;
      await active.play();

      this.isPlaying = true;
      this.isLoading = false;
      this.updateMediaSession(track);
      this.emitStatus();
      this.startProgressLoop();
    } catch (err) {
      this.isPlaying = false;
      this.isLoading = false;
      this.lastError = err instanceof Error ? err.message : 'Playback blocked or unsupported format.';
      this.emitStatus();
    }
  }

  public async restoreTrackPosition(
    track: Track,
    positionSeconds: number,
    nextTrack?: Track | null,
    autoResume = false
  ): Promise<void> {
    this.currentTrack = track;
    this.nextTrack = nextTrack || null;
    this.isCrossfading = false;
    this.preloadedTrackId = null;
    this.lastError = null;

    const clampedPos = Math.max(0, Math.min(positionSeconds || 0, track.duration || 0));
    this.virtualOffsetSec = clampedPos;
    this.pendingRestoreTimeSec = clampedPos;
    this.emitProgress(true);

    try {
      const url = await this.resolveTrackUrl(track);
      if (this.currentTrack?.id !== track.id) return;

      const active = this.getActiveElement();
      const inactive = this.getInactiveElement();

      inactive.pause();
      inactive.currentTime = 0;

      if (this.ctx && this.gainA && this.gainB) {
        const now = this.ctx.currentTime;
        this.gainA.gain.cancelScheduledValues(now);
        this.gainB.gain.cancelScheduledValues(now);
        this.gainA.gain.setValueAtTime(this.activeDeck === 'A' ? 1 : 0, now);
        this.gainB.gain.setValueAtTime(this.activeDeck === 'B' ? 1 : 0, now);
      }

      active.pause();
      active.loop = track.source === 'builtin';
      active.src = url;

      if (active.readyState < 1) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            active.removeEventListener('loadedmetadata', finish);
            active.removeEventListener('canplay', finish);
            active.removeEventListener('error', finish);
            resolve();
          };
          active.addEventListener('loadedmetadata', finish);
          active.addEventListener('canplay', finish);
          active.addEventListener('error', finish);
          window.setTimeout(finish, 3500);
        });
      }

      if (this.currentTrack?.id !== track.id) return;

      const applySeek = () => {
        try {
          if (track.source === 'builtin') {
            active.currentTime = clampedPos % 8;
            this.pendingRestoreTimeSec = null;
          } else if (active.readyState >= 1) {
            const target =
              Number.isFinite(active.duration) && active.duration > 0
                ? Math.min(clampedPos, active.duration)
                : clampedPos;
            active.currentTime = target;
            this.pendingRestoreTimeSec = null;
          }
        } catch {
          // Keep pendingRestoreTimeSec intact so deferred listener or UI fallback keeps exact position
        }
      };

      applySeek();

      if (track.source !== 'builtin' && active.readyState < 1) {
        const onLateMetadata = () => {
          if (this.currentTrack?.id !== track.id) return;
          applySeek();
          this.emitProgress(true);
        };
        active.addEventListener('loadedmetadata', onLateMetadata, { once: true });
      }

      this.updateMediaSession(track);
      this.emitProgress(true);

      if (autoResume) {
        try {
          this.ensureAudioGraph();
          if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
          }
          await active.play();
          applySeek();
          this.isPlaying = true;
          this.emitStatus();
          this.startProgressLoop();
        } catch {
          // Browser autoplay policy may block audio until first user gesture; keep exact restored position queued
          this.isPlaying = false;
          this.emitStatus();
        }
      } else {
        this.isPlaying = false;
        this.emitStatus();
      }
    } catch {
      this.isPlaying = false;
      this.emitProgress(true);
    }
  }

  public async togglePlayPause(): Promise<void> {
    this.ensureAudioGraph();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // ignore
      }
    }
    const active = this.getActiveElement();
    if (!active.src && this.currentTrack) {
      await this.loadAndPlay(this.currentTrack, this.nextTrack);
      return;
    }
    if (this.isPlaying) {
      active.pause();
      this.isPlaying = false;
      this.emitStatus();
      this.stopProgressLoop();
    } else {
      try {
        if (this.pendingRestoreTimeSec !== null && this.currentTrack) {
          const target = this.pendingRestoreTimeSec;
          if (this.currentTrack.source === 'builtin') {
            active.currentTime = target % 8;
            this.pendingRestoreTimeSec = null;
          } else if (active.readyState >= 1) {
            active.currentTime =
              Number.isFinite(active.duration) && active.duration > 0
                ? Math.min(target, active.duration)
                : target;
            this.pendingRestoreTimeSec = null;
          }
        }
        await active.play();
        this.isPlaying = true;
        this.lastError = null;
        this.emitStatus();
        this.startProgressLoop();
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : 'Unable to resume audio.';
        this.emitStatus();
      }
    }
  }

  public async resumeIfPaused(): Promise<void> {
    if (!this.isPlaying && this.currentTrack) {
      await this.togglePlayPause();
    }
  }

  public seek(seconds: number): void {
    const active = this.getActiveElement();
    const maxDur = this.currentTrack?.duration || active.duration || 0;
    const clamped = Math.max(0, Math.min(seconds, maxDur));
    this.pendingRestoreTimeSec = null;
    if (this.currentTrack?.source === 'builtin') {
      // Synthesized WAV loops every 8s while tracking virtual timeline
      this.virtualOffsetSec = clamped;
      active.currentTime = clamped % 8;
    } else if (Number.isFinite(active.duration) && active.duration > 0) {
      active.currentTime = Math.min(clamped, active.duration);
    } else {
      this.pendingRestoreTimeSec = clamped;
    }
    this.emitProgress(true);
  }

  private virtualOffsetSec = 0;
  private pendingRestoreTimeSec: number | null = null;
  private lastTickTimestamp = 0;

  private getCurrentTrackTime(): number {
    const active = this.getActiveElement();
    if (this.currentTrack?.source === 'builtin') {
      return this.virtualOffsetSec;
    }
    if (this.pendingRestoreTimeSec !== null) {
      return this.pendingRestoreTimeSec;
    }
    return Number.isFinite(active.currentTime) ? active.currentTime : 0;
  }

  private getCurrentTrackDuration(): number {
    const active = this.getActiveElement();
    if (this.currentTrack?.source === 'builtin') {
      return this.currentTrack.duration;
    }
    if (Number.isFinite(active.duration) && active.duration > 0) {
      return active.duration;
    }
    return this.currentTrack?.duration || 0;
  }

  private startProgressLoop(): void {
    this.stopProgressLoop();
    this.lastTickTimestamp = performance.now();
    const tick = (now: number) => {
      if (!this.isPlaying) return;

      const dt = (now - this.lastTickTimestamp) / 1000;
      this.lastTickTimestamp = now;

      if (this.currentTrack?.source === 'builtin') {
        this.virtualOffsetSec += dt;
        if (this.virtualOffsetSec >= this.currentTrack.duration) {
          this.virtualOffsetSec = 0;
          this.isPlaying = false;
          this.emitStatus();
          this.trackEndListeners.forEach((cb) => cb());
          return;
        }
      }

      const cur = this.getCurrentTrackTime();
      const dur = this.getCurrentTrackDuration();

      // Gapless preload & crossfade trigger
      if (this.nextTrack && dur > 8) {
        const remaining = dur - cur;
        if (remaining <= 4 && this.preloadedTrackId !== this.nextTrack.id) {
          this.preloadedTrackId = this.nextTrack.id;
          void this.preloadInactiveDeck(this.nextTrack);
        }
        if (
          this.crossfadeSeconds > 0 &&
          remaining <= this.crossfadeSeconds &&
          remaining > 0.15 &&
          !this.isCrossfading
        ) {
          void this.beginCrossfade();
        }
      }

      if (now - this.lastProgressEmit >= 200) {
        this.lastProgressEmit = now;
        this.emitProgress(false);
      }

      this.progressRaf = requestAnimationFrame(tick);
    };
    this.progressRaf = requestAnimationFrame(tick);
  }

  private stopProgressLoop(): void {
    if (this.progressRaf !== null) {
      cancelAnimationFrame(this.progressRaf);
      this.progressRaf = null;
    }
  }

  private async preloadInactiveDeck(track: Track): Promise<void> {
    try {
      const url = await this.resolveTrackUrl(track);
      const inactive = this.getInactiveElement();
      inactive.loop = track.source === 'builtin';
      inactive.src = url;
      inactive.load();
    } catch {
      // ignore preload failure
    }
  }

  private async beginCrossfade(): Promise<void> {
    if (this.isCrossfading || !this.nextTrack || !this.ctx || !this.gainA || !this.gainB) return;
    this.isCrossfading = true;
    const outgoingGain = this.activeDeck === 'A' ? this.gainA : this.gainB;
    const incomingGain = this.activeDeck === 'A' ? this.gainB : this.gainA;
    const incomingDeck = this.getInactiveElement();

    try {
      await incomingDeck.play();
      const now = this.ctx.currentTime;
      const dur = Math.max(0.5, this.crossfadeSeconds);
      outgoingGain.gain.setValueAtTime(1, now);
      outgoingGain.gain.linearRampToValueAtTime(0.001, now + dur);
      incomingGain.gain.setValueAtTime(0.001, now);
      incomingGain.gain.linearRampToValueAtTime(1, now + dur);
    } catch {
      this.isCrossfading = false;
    }
  }

  public setNextTrack(track: Track | null): void {
    this.nextTrack = track;
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
    }
  }

  public setEqBands(bands: number[], enabled: boolean, preampDb: number): void {
    this.eqBands = bands.slice(0, 10);
    this.eqEnabled = enabled;
    this.eqPreampDb = preampDb;

    if (this.ctx) {
      this.applyPreampGain();
      this.eqFilters.forEach((filter, i) => {
        const target = enabled ? this.eqBands[i] || 0 : 0;
        filter.gain.setTargetAtTime(target, this.ctx!.currentTime, 0.02);
      });
    }
  }

  private applyPreampGain(): void {
    if (!this.preampNode || !this.ctx) return;
    const db = this.eqEnabled ? this.eqPreampDb : 0;
    const linear = Math.pow(10, db / 20);
    this.preampNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.02);
  }

  public setCrossfade(seconds: number, gapless: boolean): void {
    this.crossfadeSeconds = Math.max(0, Math.min(12, seconds));
    this.gaplessPlayback = gapless;
  }

  public setStreamingQuality(quality: StreamingQuality): void {
    this.streamingQuality = quality;
    this.applyStreamingQuality();
  }

  private applyStreamingQuality(): void {
    if (!this.qualityFilter || !this.ctx) return;
    const freqMap: Record<StreamingQuality, number> = {
      'lossless-hires': 22000,
      'cd-lossless': 20000,
      'high-320': 17500,
      'data-saver': 13500,
    };
    this.qualityFilter.frequency.setTargetAtTime(
      freqMap[this.streamingQuality] || 22000,
      this.ctx.currentTime,
      0.03
    );
  }

  public getFrequencyData(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser || !this.isPlaying) return false;
    this.analyser.getByteFrequencyData(target);
    return true;
  }

  public async setOutputDevice(deviceId: string): Promise<void> {
    const dA = this.deckA as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    const dB = this.deckB as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof dA.setSinkId === 'function') await dA.setSinkId(deviceId);
    if (typeof dB.setSinkId === 'function') await dB.setSinkId(deviceId);
    const ctxWithSink = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (ctxWithSink && typeof ctxWithSink.setSinkId === 'function') {
      await ctxWithSink.setSinkId(deviceId);
    }
  }

  public async promptRemotePlayback(): Promise<void> {
    const active = this.getActiveElement() as HTMLAudioElement & {
      remote?: { prompt: () => Promise<void> };
    };
    if (active.remote && typeof active.remote.prompt === 'function') {
      await active.remote.prompt();
      return;
    }
    throw new Error('Remote Playback API is unavailable in this browser. Use Audio Output selector below.');
  }

  public setMediaHandlers(onPrev: () => void, onNext: () => void): void {
    this.onPrevHandler = onPrev;
    this.onNextHandler = onNext;
    if (!this.mediaControlsBound && 'mediaSession' in navigator) {
      this.mediaControlsBound = true;
      navigator.mediaSession.setActionHandler('play', () => void this.togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => void this.togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.onPrevHandler?.());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.onNextHandler?.());
    }
  }

  private updateMediaSession(track: Track): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  }

  public resetVirtualTime(): void {
    this.virtualOffsetSec = 0;
  }

  public getState() {
    return {
      isPlaying: this.isPlaying,
      isLoading: this.isLoading,
      error: this.lastError,
      currentTime: this.getCurrentTrackTime(),
      duration: this.getCurrentTrackDuration(),
    };
  }

  private emitProgress(force: boolean): void {
    if (force) this.lastProgressEmit = performance.now();
    const payload = {
      currentTime: this.getCurrentTrackTime(),
      duration: this.getCurrentTrackDuration(),
    };
    this.progressListeners.forEach((cb) => cb(payload));
  }

  private emitStatus(): void {
    const payload = {
      isPlaying: this.isPlaying,
      isLoading: this.isLoading,
      error: this.lastError,
    };
    this.statusListeners.forEach((cb) => cb(payload));
  }

  public subscribeProgress(cb: ProgressListener): () => void {
    this.progressListeners.add(cb);
    cb({
      currentTime: this.getCurrentTrackTime(),
      duration: this.getCurrentTrackDuration(),
    });
    return () => this.progressListeners.delete(cb);
  }

  public subscribeStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    cb({
      isPlaying: this.isPlaying,
      isLoading: this.isLoading,
      error: this.lastError,
    });
    return () => this.statusListeners.delete(cb);
  }

  public subscribeTrackEnd(cb: TrackEndListener): () => void {
    this.trackEndListeners.add(cb);
    return () => this.trackEndListeners.delete(cb);
  }
}

export const audioEngine = new HiFiAudioEngine();
