import React from 'react';
import { X } from 'lucide-react';
import { AppTaskProgress } from '../types/music';
import { ProgressBar } from './ProgressBar';

interface TaskProgressDockProps {
  tasks: AppTaskProgress[];
  onDismiss: (taskId: string) => void;
}

export const TaskProgressDock: React.FC<TaskProgressDockProps> = ({
  tasks,
  onDismiss,
}) => {
  if (tasks.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed left-3 right-3 sm:left-auto sm:right-5 sm:w-[400px] z-[60] space-y-2 pointer-events-none"
      style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
    >
      {tasks.map((task) => (
        <div
          key={task.id}
          className="relative pointer-events-auto rounded-xl bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.28)]"
        >
          <ProgressBar
            compact
            label={task.title}
            detail={task.detail}
            current={task.current}
            total={task.total}
            percent={task.percent}
            itemLabel={task.itemLabel}
            itemCurrent={task.itemCurrent}
            itemTotal={task.itemTotal}
            itemPercent={task.itemPercent}
            status={task.status}
          />
          <button
            type="button"
            onClick={() => onDismiss(task.id)}
            aria-label={`Dismiss ${task.title}`}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
