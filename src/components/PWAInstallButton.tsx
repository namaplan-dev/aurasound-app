import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { tactile } from '../services/tactileFeedback';
import { isNativeAndroidApp } from '../services/nativeScanner';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || isNativeAndroidApp()) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          tactile.tap();
          void install().then((accepted) => {
            if (accepted) tactile.success();
          });
        }}
        className="min-h-[40px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 active:scale-95 transition-transform duration-100"
      >
        <Download className="w-3.5 h-3.5 accent-text" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            tactile.sheet(true);
            setShowIOSGuide(true);
          }}
          className="min-h-[40px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 active:scale-95 transition-transform duration-100"
        >
          <Download className="w-3.5 h-3.5 accent-text" />
          <span>Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                  Install AuraSound on iOS
                </h3>
                <button
                  type="button"
                  aria-label="Close install guide"
                  onClick={() => {
                    tactile.sheet(false);
                    setShowIOSGuide(false);
                  }}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 list-decimal list-inside">
                <li>
                  Tap the <Share className="w-4 h-4 inline mx-0.5 align-text-bottom" />{' '}
                  <strong>Share</strong> button in Safari.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => {
                  tactile.sheet(false);
                  setShowIOSGuide(false);
                }}
                className="w-full min-h-[42px] rounded-xl accent-bg text-sm font-medium active:scale-95 transition-transform duration-100"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
