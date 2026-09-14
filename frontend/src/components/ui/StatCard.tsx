import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  hint: string;
  icon: ReactNode;
  accent?: 'primary' | 'emerald' | 'violet';
}

const accentStyles: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary: 'text-primary-600 bg-primary-100 dark:bg-primary-950/30 dark:text-primary-300',
  emerald: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300',
  violet: 'text-violet-600 bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300',
};

export function StatCard({ label, value, hint, icon, accent = 'primary' }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accentStyles[accent]}`}>
          {icon}
        </div>
      </div>
      <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{hint}</p>
    </div>
  );
}
