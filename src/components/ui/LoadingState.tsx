import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  label: string;
  className?: string;
}

export function LoadingState({ label, className = '' }: LoadingStateProps) {
  return (
    <div className={`flex min-h-[32vh] items-center justify-center ${className}`}>
      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
        <span>{label}</span>
      </div>
    </div>
  );
}
