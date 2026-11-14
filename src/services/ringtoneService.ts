import { Track } from '../types/music';
import { getAudioBlobFromCache } from './offlineCacheService';
import { isNativeAndroidApp, setNativeRingtone } from './nativeScanner';

function encodeAudioBufferAsWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // linear PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

async function renderClipRingtoneWav(track: Track): Promise<Blob> {
  const clipDurationSec = Math.min(30, Math.max(8, track.duration || 30));
  const targetSampleRate = 44100;

  if (track.source === 'local') {
    const cachedBlob = await getAudioBlobFromCache(track.id);
    if (cachedBlob) {
      const rawBytes = await cachedBlob.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const decodeCtx = new AudioCtx();
      try {
        const decoded = await decodeCtx.decodeAudioData(rawBytes.slice(0));
        const lenFrames = Math.min(
          decoded.length,
          Math.floor(clipDurationSec * decoded.sampleRate)
        );
        const outChannels = Math.min(2, decoded.numberOfChannels);
        const offline = new OfflineAudioContext(outChannels, lenFrames, decoded.sampleRate);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        const gain = offline.createGain();
        const actualSec = lenFrames / decoded.sampleRate;
        gain.gain.setValueAtTime(0.01, 0);
        gain.gain.linearRampToValueAtTime(1, Math.min(0.35, actualSec * 0.1));
        gain.gain.setValueAtTime(1, Math.max(0.5, actualSec - 1.2));
        gain.gain.linearRampToValueAtTime(0.01, actualSec);
        src.connect(gain);
        gain.connect(offline.destination);
        src.start(0);
        const rendered = await offline.startRendering();
        return encodeAudioBufferAsWav(rendered);
      } finally {
        await decodeCtx.close().catch(() => undefined);
      }
    }
  }

  // Synthesize a clean ringtone clip from built-in track harmonic profile if source audio is unavailable
  const rootHz = track.synthProfile?.rootHz || 220;
  const chord = track.synthProfile?.chord || [1, 1.25, 1.5, 2];
  const frameCount = Math.floor(clipDurationSec * targetSampleRate);
  const offline = new OfflineAudioContext(2, frameCount, targetSampleRate);
  const master = offline.createGain();
  master.gain.setValueAtTime(0.01, 0);
  master.gain.linearRampToValueAtTime(0.38, 0.25);
  master.gain.setValueAtTime(0.38, Math.max(1, clipDurationSec - 1.2));
  master.gain.linearRampToValueAtTime(0.001, clipDurationSec);
  master.connect(offline.destination);

  for (const ratio of chord) {
    const osc = offline.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = rootHz * ratio;
    const oscGain = offline.createGain();
    oscGain.gain.value = 1 / chord.length;
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(0);
    osc.stop(clipDurationSec);
  }

  const rendered = await offline.startRendering();
  return encodeAudioBufferAsWav(rendered);
}

export async function applyTrackAsRingtone(
  track: Track
): Promise<{ ok: boolean; cancelled?: boolean; message: string }> {
  if (isNativeAndroidApp()) {
    if (!track.nativeUri && !track.nativePath) {
      // Built-in or non-MediaStore track on Android: generate & download 30s ringtone clip
      const wavBlob = await renderClipRingtoneWav(track);
      triggerDownload(wavBlob, track.title);
      return {
        ok: true,
        message: `Exported 30s ringtone clip for "${track.title}".`,
      };
    }
    const res = await setNativeRingtone(track);
    if (res.cancelled) {
      return {
        ok: false,
        cancelled: true,
        message: 'Allow "Modify system settings" for AuraSound to set the Android ringtone.',
      };
    }
    return {
      ok: res.success,
      message: res.success
        ? `"${track.title}" set as default Android ringtone.`
        : 'Unable to update Android system ringtone.',
    };
  }

  const wavBlob = await renderClipRingtoneWav(track);
  triggerDownload(wavBlob, track.title);
  return {
    ok: true,
    message: `Downloaded 30s fade-in/out ringtone clip for "${track.title}".`,
  };
}

function triggerDownload(blob: Blob, title: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safe = title.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'ringtone';
  link.href = url;
  link.download = `${safe}_ringtone.wav`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
