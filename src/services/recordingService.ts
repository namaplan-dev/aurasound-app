import { Capacitor } from '@capacitor/core';
import { RecordingCategory, Track } from '../types/music';
import {
  AiQuotaExhaustedError,
  buildAiQuotaStateFromPayload,
  resolveApiUrl,
  setActiveAiQuotaState,
} from './aiAssistantService';
import {
  readWebAudioBlobForTrack,
  saveTextFileNearTrack,
} from './localFileHandleService';
import {
  isNativeAndroidApp,
  readNativeAudioFileBase64,
  saveNativeTranscriptNearSource,
} from './nativeScanner';

export const RECORDINGS_PIN = '4194';

export interface RecordingCategoryInfo {
  id: RecordingCategory;
  label: string;
  shortLabel: string;
}

export const RECORDING_CATEGORIES: RecordingCategoryInfo[] = [
  { id: 'phone-call', label: 'Phone Call', shortLabel: 'Call' },
  { id: 'voice-memo', label: 'Voice Recording', shortLabel: 'Voice' },
  { id: 'cam-audio', label: 'Cam Audio', shortLabel: 'Cam' },
  { id: 'meeting', label: 'Meeting', shortLabel: 'Meeting' },
  { id: 'voice-note', label: 'Voice Note', shortLabel: 'Note' },
];

export function getRecordingCategoryLabel(cat?: RecordingCategory): string {
  return (
    RECORDING_CATEGORIES.find((c) => c.id === cat)?.label || 'Voice Recording'
  );
}

const DEFAULT_RECORDING_SEGMENTS = new Set([
  'recordings',
  'recording',
  'call',
  'calls',
  'callrecordings',
  'call recordings',
  'soundrecorder',
  'sound_recorder',
  'voicerecorder',
  'voice_recorder',
  'phonerecord',
  'audiorecorder',
  'voice memos',
  'voice notes',
  'dcim',
]);

export function isDefaultRecordingFolderPath(folderPath?: string): boolean {
  if (!folderPath) return false;
  const parts = folderPath
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.some((seg) => DEFAULT_RECORDING_SEGMENTS.has(seg));
}

export function classifyRecordingFromMeta(input: {
  fileName?: string;
  folderPath?: string;
  title?: string;
  duration?: number;
}): {
  recordingCategory: RecordingCategory;
  cleanTitle: string;
  participants: string[];
  tags: string[];
} {
  const fileName = String(input.fileName || '').trim();
  const folderPath = String(input.folderPath || '').trim();
  const rawTitle = String(input.title || '').trim();
  const baseName = fileName.replace(/\.[^/.]+$/, '').trim();
  const combined = `${folderPath} ${fileName} ${rawTitle}`.toLowerCase();
  const duration = Number(input.duration || 0);

  let recordingCategory: RecordingCategory = 'voice-memo';
  if (
    /\b(call|callrec|acr|phone|incoming|outgoing|tel|dial|conversation)\b/i.test(combined) ||
    /\+?\d{7,15}/.test(combined)
  ) {
    recordingCategory = 'phone-call';
  } else if (/\b(dcim|cam|camera|camcorder|vid_|video|gopro|dji|screenrec)\b/i.test(combined)) {
    recordingCategory = 'cam-audio';
  } else if (/\b(meeting|interview|zoom|teams|conference|lecture)\b/i.test(combined)) {
    recordingCategory = 'meeting';
  } else if (duration > 0 && duration <= 60) {
    recordingCategory = 'voice-note';
  } else if (/\b(note|memo|dict|reminder)\b/i.test(combined)) {
    recordingCategory = 'voice-note';
  }

  // Extract phone numbers / caller tokens from file name when present
  const participants: string[] = [];
  const phoneMatches = fileName.match(/\+?\d[\d\s\-()]{6,16}\d/g) || [];
  for (const pm of phoneMatches) {
    const cleanPhone = pm.trim();
    if (cleanPhone && !participants.includes(cleanPhone)) {
      participants.push(cleanPhone);
    }
  }

  const tags: string[] = [getRecordingCategoryLabel(recordingCategory)];
  const folderLeaf = folderPath.split(/[\\/]/).filter(Boolean).pop();
  if (folderLeaf && !tags.includes(folderLeaf)) {
    tags.push(folderLeaf);
  }
  const dateMatch = fileName.match(/\b(20\d{2})[-_]?(\d{2})[-_]?(\d{2})\b/);
  if (dateMatch) {
    tags.push(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
  }

  const cleanTitle =
    rawTitle && rawTitle !== 'Unknown' && rawTitle !== 'Voice Recording'
      ? rawTitle
      : baseName || 'Voice Recording';

  return {
    recordingCategory,
    cleanTitle,
    participants,
    tags: Array.from(new Set(tags)).slice(0, 6),
  };
}

export function normalizeAsRecordingTrack(track: Track): Track {
  const info = classifyRecordingFromMeta({
    fileName: track.fileName,
    folderPath: track.folderPath,
    title: track.title,
    duration: track.duration,
  });

  const existingCategory = track.recordingCategory || info.recordingCategory;
  const existingTags =
    Array.isArray(track.transcriptTags) && track.transcriptTags.length > 0
      ? track.transcriptTags
      : info.tags;
  const existingParticipants =
    Array.isArray(track.recordingParticipants) && track.recordingParticipants.length > 0
      ? track.recordingParticipants
      : info.participants;

  return {
    ...track,
    isRecording: true,
    title: track.title || info.cleanTitle,
    artist: getRecordingCategoryLabel(existingCategory),
    album: track.folderPath || 'Private Vault',
    genre: getRecordingCategoryLabel(existingCategory),
    recordingCategory: existingCategory,
    recordingParticipants: existingParticipants,
    transcriptTags: existingTags,
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function encodeMono16BitWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function inferMimeType(fileName?: string, blobType?: string): string {
  const cleanType = String(blobType || '').trim().toLowerCase();
  if (cleanType && cleanType.startsWith('audio/') && !cleanType.includes('amr')) {
    return cleanType === 'audio/x-wav' ? 'audio/wav' : cleanType;
  }
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mp3';
  if (lower.endsWith('.wav') || lower.endsWith('.wave')) return 'audio/wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.opus')) return 'audio/opus';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/mp3';
}

const GEMINI_INLINE_SUPPORTED = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/mp4',
  'audio/m4a',
  'audio/webm',
]);

async function prepareBlobForTranscription(
  blob: Blob,
  fileName?: string
): Promise<{ base64: string; mimeType: string }> {
  const guessedMime = inferMimeType(fileName, blob.type);
  const MAX_DIRECT_BYTES = 16 * 1024 * 1024;

  if (blob.size <= MAX_DIRECT_BYTES && GEMINI_INLINE_SUPPORTED.has(guessedMime)) {
    const ab = await blob.arrayBuffer();
    return {
      base64: arrayBufferToBase64(ab),
      mimeType: guessedMime === 'audio/m4a' ? 'audio/mp4' : guessedMime,
    };
  }

  // Re-encode to 16kHz mono 16-bit PCM WAV when oversized (>16MB) or legacy container
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    if (blob.size <= MAX_DIRECT_BYTES) {
      const ab = await blob.arrayBuffer();
      return { base64: arrayBufferToBase64(ab), mimeType: guessedMime };
    }
    throw new Error('Recording exceeds 16 MB and Web Audio resampling is unavailable in this browser.');
  }

  const ctx = new AudioCtx();
  try {
    const rawBuf = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(rawBuf.slice(0));
    const targetRate = 16000;
    // Fit comfortably within ~17 MB WAV (approx 530 seconds at 16kHz mono 16-bit)
    const maxDurationSec = 520;
    const effectiveDur = Math.min(decoded.duration, maxDurationSec);
    const frameCount = Math.max(1, Math.floor(effectiveDur * targetRate));

    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0, 0, effectiveDur);
    const rendered = await offline.startRendering();
    const wavBuf = encodeMono16BitWav(rendered.getChannelData(0), targetRate);
    return {
      base64: arrayBufferToBase64(wavBuf),
      mimeType: 'audio/wav',
    };
  } finally {
    void ctx.close();
  }
}

export interface TranscriptionResult {
  transcript: string;
  recordingCategory: RecordingCategory;
  suggestedTitle: string;
  participants: string[];
  summary: string;
  tags: string[];
}

export async function transcribeRecordingWithAi(
  recording: Track
): Promise<TranscriptionResult> {
  let audioBase64 = '';
  let mimeType = inferMimeType(recording.fileName);

  if (isNativeAndroidApp()) {
    const target = recording.nativeUri || recording.nativePath;
    let fetchedBlob: Blob | null = null;
    if (target) {
      try {
        const res = await fetch(Capacitor.convertFileSrc(target));
        if (res.ok) {
          fetchedBlob = await res.blob();
        }
      } catch {
        fetchedBlob = null;
      }
    }
    if (fetchedBlob && fetchedBlob.size > 0) {
      const prepared = await prepareBlobForTranscription(fetchedBlob, recording.fileName);
      audioBase64 = prepared.base64;
      mimeType = prepared.mimeType;
    } else {
      const nativeRes = await readNativeAudioFileBase64(recording);
      audioBase64 = nativeRes.base64;
    }
  } else {
    const blob = await readWebAudioBlobForTrack(recording.id);
    if (!blob) {
      throw new Error(
        'Recording audio bytes are not accessible in this browser session. Re-add the recordings folder to read the file.'
      );
    }
    const prepared = await prepareBlobForTranscription(blob, recording.fileName);
    audioBase64 = prepared.base64;
    mimeType = prepared.mimeType;
  }

  if (!audioBase64) {
    throw new Error('Could not read audio data from recording.');
  }

  const resp = await fetch(resolveApiUrl('/api/ai/transcribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      mimeType,
      fileName: recording.fileName || recording.title,
      folderPath: recording.folderPath || '',
      durationSec: recording.duration || 0,
    }),
  });

  if (!resp.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await resp.json()) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (resp.status === 429 || payload.code === 'AI_QUOTA_EXHAUSTED') {
      const quota = buildAiQuotaStateFromPayload(payload, resp.headers.get('Retry-After'));
      setActiveAiQuotaState(quota);
      throw new AiQuotaExhaustedError(quota);
    }
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : `Transcription failed (${resp.status}).`
    );
  }

  const data = (await resp.json()) as Partial<TranscriptionResult>;
  const fallback = classifyRecordingFromMeta({
    fileName: recording.fileName,
    folderPath: recording.folderPath,
    title: recording.title,
    duration: recording.duration,
  });

  return {
    transcript: String(data.transcript || '').trim(),
    recordingCategory: data.recordingCategory || fallback.recordingCategory,
    suggestedTitle: String(data.suggestedTitle || '').trim() || fallback.cleanTitle,
    participants:
      Array.isArray(data.participants) && data.participants.length > 0
        ? data.participants
        : fallback.participants,
    summary: String(data.summary || '').trim(),
    tags:
      Array.isArray(data.tags) && data.tags.length > 0
        ? Array.from(new Set(data.tags))
        : fallback.tags,
  };
}

export function buildTranscriptTxtFilename(recording: Track): string {
  const sourceName = (recording.fileName || recording.title || 'recording').trim();
  const base = sourceName.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'recording';
  return `${base}.transcript.txt`;
}

export function formatRecordingTranscriptTxt(recording: Track): string {
  const recordedDate = new Date(recording.addedAt || Date.now()).toLocaleString();
  const transcribedDate = recording.transcribedAt
    ? new Date(recording.transcribedAt).toLocaleString()
    : new Date().toLocaleString();
  const mins = Math.floor((recording.duration || 0) / 60);
  const secs = Math.floor((recording.duration || 0) % 60);
  const durText = `${mins}:${String(secs).padStart(2, '0')}`;
  const catLabel = getRecordingCategoryLabel(recording.recordingCategory);
  const tagsLine = (recording.transcriptTags || []).join(', ') || catLabel;
  const participantsLine =
    (recording.recordingParticipants || []).join(', ') || 'Not specified';

  return [
    '============================================================',
    `TITLE: ${recording.title}`,
    `CATEGORY: ${catLabel}`,
    `RECORDED / ADDED: ${recordedDate}`,
    `DURATION: ${durText}`,
    `SOURCE FILE: ${recording.fileName || recording.title}`,
    `SOURCE FOLDER: ${recording.folderPath || 'Recordings'}`,
    `PARTICIPANTS / CALLER: ${participantsLine}`,
    `TAGS: ${tagsLine}`,
    `TRANSCRIBED AT: ${transcribedDate}`,
    '============================================================',
    '',
    ...(recording.transcriptSummary
      ? ['SUMMARY:', recording.transcriptSummary.trim(), '']
      : []),
    'TRANSCRIPT:',
    (recording.transcript || '').trim() || '(No spoken text transcribed yet)',
    '',
  ].join('\n');
}

export async function saveRecordingTranscriptNearSource(recording: Track): Promise<{
  savedNearSource: boolean;
  fileName: string;
  savedPath: string;
  downloadedFallback?: boolean;
}> {
  const fileName = buildTranscriptTxtFilename(recording);
  const textContent = formatRecordingTranscriptTxt(recording);

  if (isNativeAndroidApp()) {
    const res = await saveNativeTranscriptNearSource(recording, fileName, textContent);
    return {
      savedNearSource: Boolean(res.nearSource),
      fileName,
      savedPath: res.savedPath || fileName,
    };
  }

  const webRes = await saveTextFileNearTrack(recording, textContent, fileName);
  return {
    savedNearSource: webRes.savedToDisk,
    fileName: webRes.fileName,
    savedPath: webRes.savedPath,
    downloadedFallback: webRes.downloadedFallback,
  };
}
