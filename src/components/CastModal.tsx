import React, { useEffect, useState } from 'react';
import { Cast, Check, RefreshCw, Speaker, X } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { tactile } from '../services/tactileFeedback';

interface CastModalProps {
  open: boolean;
  onClose: () => void;
}

export const CastModal: React.FC<CastModalProps> = ({ open, onClose }) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>('default');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setStatusMsg('Audio device enumeration is not supported in this browser.');
        return;
      }
      const list = await navigator.mediaDevices.enumerateDevices();
      const outputs = list.filter((d) => d.kind === 'audiooutput');
      setDevices(outputs);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to inspect audio outputs.');
    }
  };

  useEffect(() => {
    if (open) {
      setStatusMsg(null);
      void loadDevices();
    }
  }, [open]);

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Cast className="w-5 h-5 accent-text" />
            <h3 className="text-base font-display font-semibold">Cast & Audio Output</h3>
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

        <div className="p-5 space-y-4">
          <button
            type="button"
            onClick={handleCastPrompt}
            className="w-full min-h-[46px] px-4 rounded-xl accent-bg text-sm font-medium flex items-center justify-center gap-2"
          >
            <Cast className="w-4 h-4" />
            <span>Cast to Smart Speaker / Chromecast</span>
          </button>

          <div className="flex items-center justify-between pt-2">
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

          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {devices.length === 0 ? (
              <div className="text-xs text-zinc-500 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                System Default Output active. Connect a Bluetooth speaker or USB DAC to switch outputs.
              </div>
            ) : (
              devices.map((dev, idx) => {
                const active = selectedId === dev.deviceId;
                return (
                  <button
                    key={dev.deviceId || idx}
                    type="button"
                    onClick={() => handleSelectDevice(dev.deviceId)}
                    className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                      active
                        ? 'border-amber-500/60 bg-amber-500/10'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Speaker className="w-4 h-4 text-zinc-500 shrink-0" />
                      <span className="text-sm truncate">
                        {dev.label || `Audio Output ${idx + 1}`}
                      </span>
                    </div>
                    {active && <Check className="w-4 h-4 accent-text shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {statusMsg && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">{statusMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
};
