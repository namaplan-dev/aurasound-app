import React, { useEffect, useState } from 'react';
import { Cast, Check, Mic2, RefreshCw, Speaker, Tv, X } from 'lucide-react';
import { Track } from '../types/music';
import { audioEngine } from '../services/audioEngine';
import {
  getActiveCastConnectionCount,
  registerPresentationConnection,
} from '../services/karaokeCastChannel';
import { PaginationBar } from './PaginationBar';
import { tactile } from '../services/tactileFeedback';

interface CastModalProps {
  open: boolean;
  track?: Track | null;
  karaokeOffsetMs?: number;
  onLaunchTvStage?: () => void;
  onClose: () => void;
}

const DEVICES_PER_PAGE = 3;

export const CastModal: React.FC<CastModalProps> = ({
  open,
  track,
  karaokeOffsetMs = 0,
  onLaunchTvStage,
  onClose,
}) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>('default');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [connectedDisplays, setConnectedDisplays] = useState(0);

  const loadDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setStatusMsg('Audio device enumeration is not supported in this browser.');
        return;
      }
      const list = await navigator.mediaDevices.enumerateDevices();
      const outputs = list.filter((d) => d.kind === 'audiooutput');
      setDevices(outputs);
      setPage(0);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to inspect audio outputs.');
    }
  };

  useEffect(() => {
    if (open) {
      setStatusMsg(null);
      setConnectedDisplays(getActiveCastConnectionCount());
      void loadDevices();
    }
  }, [open]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(devices.length / DEVICES_PER_PAGE));
  const safePage = Math.max(0, Math.min(totalPages - 1, page));
  const pagedDevices = devices.slice(
    safePage * DEVICES_PER_PAGE,
    safePage * DEVICES_PER_PAGE + DEVICES_PER_PAGE
  );

  const handleSelectDevice = async (deviceId: string) => {
    try {
      await audioEngine.setOutputDevice(deviceId);
      setSelectedId(deviceId);
      tactile.success();
      setStatusMsg('Switched audio output device.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Output switching requires Chrome/Edge HTTPS.');
    }
  };

  const handleCastPrompt = async () => {
    tactile.tap();
    try {
      await audioEngine.promptRemotePlayback();
      tactile.success();
      setStatusMsg('Cast session initiated.');
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Cast prompt unavailable here.');
    }
  };

  const handleLaunchKaraokeDisplay = async () => {
    tactile.tap();
    const PresentationCtor = (
      window as unknown as {
        PresentationRequest?: new (urls: string[]) => {
          start: () => Promise<{
            readyState?: string;
            send?: (data: string) => void;
            close?: () => void;
            addEventListener?: (type: string, cb: () => void) => void;
          }>;
        };
      }
    ).PresentationRequest;

    if (PresentationCtor) {
      try {
        const displayUrl = `${window.location.origin}/?karaoke-display=1`;
        const req = new PresentationCtor([displayUrl]);
        const conn = await req.start();
        registerPresentationConnection(conn);
        setConnectedDisplays(getActiveCastConnectionCount());
        tactile.success();
        setStatusMsg('Karaoke TV Display connected & synchronized live!');
        return;
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'AbortError' || name === 'NotAllowedError') {
          setStatusMsg('Display picker dismissed. Launching in-app Karaoke Stage instead.');
        }
      }
    }

    if (onLaunchTvStage) {
      tactile.success();
      onClose();
      onLaunchTvStage();
    } else {
      setStatusMsg('Open Fullscreen Stage on Now Playing for TV-ready karaoke projection.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-hidden">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Cast className="w-5 h-5 accent-text" />
            <h3 className="text-base font-display font-semibold">Cast, Karaoke TV & Output</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Cast modal"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          <button
            type="button"
            onClick={handleLaunchKaraokeDisplay}
            className="w-full min-h-[44px] px-4 rounded-xl accent-bg text-sm font-medium flex items-center justify-center gap-2"
          >
            <Tv className="w-4 h-4" />
            <span>
              {connectedDisplays > 0
                ? `Karaoke TV Connected (${connectedDisplays}) · Launch Stage`
                : 'Cast / Launch Karaoke TV Display'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCastPrompt}
            className="w-full min-h-[40px] px-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs sm:text-sm font-medium flex items-center justify-center gap-2"
          >
            <Cast className="w-4 h-4 accent-text" />
            <span>Cast Audio to Smart Speaker / Chromecast</span>
          </button>

          {track && (
            <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-2.5 text-[11px] text-zinc-600 dark:text-zinc-300 flex items-start gap-2">
              <Mic2 className="w-4 h-4 accent-text shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {track.title} · {track.lyrics?.trim() ? 'Lyrics Ready' : 'No Embedded Lyrics'}
                </div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  Casting or using Bluetooth speakers? Use -0.5s / +0.5s sync in Karaoke Stage (offset:{' '}
                  {karaokeOffsetMs > 0
                    ? `+${(karaokeOffsetMs / 1000).toFixed(1)}s`
                    : `${(karaokeOffsetMs / 1000).toFixed(1)}s`}
                  ).
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Connected Audio Outputs (DAC / Bluetooth / Speakers)
            </span>
            <button
              type="button"
              onClick={() => {
                tactile.tap();
                void loadDevices();
              }}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              aria-label="Refresh output devices"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            {pagedDevices.length === 0 ? (
              <div className="text-xs text-zinc-500 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                System Default Output active. Connect a Bluetooth speaker or USB DAC to switch outputs.
              </div>
            ) : (
              pagedDevices.map((dev, idx) => {
                const active = selectedId === dev.deviceId;
                return (
                  <button
                    key={dev.deviceId || idx}
                    type="button"
                    onClick={() => handleSelectDevice(dev.deviceId)}
                    className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                      active
                        ? 'border-amber-500/60 bg-amber-500/10'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Speaker className="w-4 h-4 text-zinc-500 shrink-0" />
                      <span className="text-sm truncate">
                        {dev.label || `Audio Output ${safePage * DEVICES_PER_PAGE + idx + 1}`}
                      </span>
                    </div>
                    {active && <Check className="w-4 h-4 accent-text shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {devices.length > DEVICES_PER_PAGE && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              totalItems={devices.length}
              pageSize={DEVICES_PER_PAGE}
              onChangePage={setPage}
              itemLabel="outputs"
            />
          )}

          {statusMsg && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">{statusMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
};
