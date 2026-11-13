import React, { useEffect, useState } from 'react';
import { Disc3 } from 'lucide-react';

interface CoverArtProps {
  src?: string;
  alt: string;
  className?: string;
  isPlaying?: boolean;
}

export const CoverArt: React.FC<CoverArtProps> = React.memo(
  ({ src, alt, className = 'w-11 h-11 rounded-md', isPlaying = false }) => {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      setFailed(false);
    }, [src]);

    return (
      <div
        className={`relative overflow-hidden shrink-0 bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center ${className}`}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-400">
            <Disc3 className="w-1/2 h-1/2 opacity-70" />
          </div>
        )}
        {isPlaying && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/45 flex items-end justify-center gap-[3px] pb-2"
          >
            <span className="w-[3px] h-3.5 rounded-full bg-white eq-bar-1" />
            <span className="w-[3px] h-4 rounded-full bg-white eq-bar-2" />
            <span className="w-[3px] h-2.5 rounded-full bg-white eq-bar-3" />
          </div>
        )}
      </div>
    );
  }
);
