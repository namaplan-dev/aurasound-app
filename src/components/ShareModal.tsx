import React, { useState } from 'react';
import { Check, Copy, Download, Share2, X } from 'lucide-react';
import { Track } from '../types/music';
import { CoverArt } from './CoverArt';
import { tactile } from '../services/tactileFeedback';

interface ShareModalProps {
  open: boolean;
  track: Track | null;
  mode?: 'track' | 'app';
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  open,
  track,
  mode = 'track',
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (!open) return null;

  const isAppShare = mode === 'app' || !track;
  const shareText = isAppShare
    ? `Check out AuraSound — Hi-Res FLAC/WAV music player with 10-band EQ, smart metadata cleanup, and cloud sync.`
    : `Listening to "${track.title}" by ${track.artist} (${track.format} ${track.bitDepth}-bit/${Math.round(
        track.sampleRate / 1000
      )}kHz) on AuraSound`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        isAppShare ? `${shareText} ${window.location.href}` : shareText
      );
      tactile.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus('Clipboard access denied.');
    }
  };

  const handleNativeShare = async () => {
    tactile.tap();
    if (navigator.share) {
      try {
        await navigator.share({
          title: isAppShare ? 'AuraSound Hi-Res Audio Player' : `${track.title} — ${track.artist}`,
          text: shareText,
          url: window.location.href,
        });
        tactile.success();
      } catch {
        // User cancelled share sheet
      }
    } else {
      await handleCopy();
      setStatus('Share caption copied to clipboard.');
    }
  };

  const handleDownloadCard = () => {
    if (!track) return;
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

    ctx.fillStyle = '#d97706';
    ctx.font = '600 18px sans-serif';
    ctx.fillText('AURASOUND · NOW PLAYING', 56, 84);

    ctx.fillStyle = '#fafafa';
    ctx.font = '700 40px sans-serif';
    ctx.fillText(track.title.slice(0, 32), 56, 175);

    ctx.fillStyle = '#a1a1aa';
    ctx.font = '500 26px sans-serif';
    ctx.fillText(`${track.artist} — ${track.album}`.slice(0, 48), 56, 225);

    ctx.fillStyle = '#71717a';
    ctx.font = '500 20px monospace';
    ctx.fillText(
      `${track.format} · ${track.bitDepth}-bit / ${(track.sampleRate / 1000).toFixed(1)} kHz · ${track.genre}`,
      56,
      335
    );

    const link = document.createElement('a');
    link.download = `${track.title.replace(/[^a-z0-9]/gi, '_')}_aurasound.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    tactile.success();
    setStatus('Shareable Now Playing card downloaded.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 accent-text" />
            <h3 className="text-base font-display font-semibold">
              {isAppShare ? 'Share AuraSound' : 'Broadcast Current Track'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share modal"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!isAppShare && track ? (
            <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <CoverArt src={track.coverUrl} alt={track.title} className="w-16 h-16 rounded-lg" />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{track.title}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {track.artist} · {track.album}
                </div>
                <div className="text-xs font-mono-tabular text-zinc-500 mt-1">
                  {track.format} · {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}kHz
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {shareText}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleNativeShare}
              className="min-h-[44px] px-4 rounded-xl accent-bg text-sm font-medium flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Now</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm font-medium flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied' : 'Copy Link'}</span>
            </button>
          </div>

          {!isAppShare && track && (
            <button
              type="button"
              onClick={handleDownloadCard}
              className="w-full min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm font-medium flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Download Share Card (PNG)</span>
            </button>
          )}

          {status && <p className="text-xs text-zinc-500 text-center">{status}</p>}
        </div>
      </div>
    </div>
  );
};
