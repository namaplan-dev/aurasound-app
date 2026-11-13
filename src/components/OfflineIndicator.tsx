import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-24 left-4 z-30 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-zinc-900/95 px-3 py-2 text-xs font-medium text-amber-300 shadow-lg backdrop-blur-md">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline — Playing cached library</span>
    </div>
  );
};
