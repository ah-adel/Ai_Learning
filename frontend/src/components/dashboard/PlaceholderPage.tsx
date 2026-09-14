import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/types/database.types';

interface PlaceholderPageProps {
  title: string;
  description: string;
  roles: UserRole[];
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  const { profile } = useAuth();

  return (
    <div className="animate-fade-in-up">
      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold capitalize text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
        {profile?.role}
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
        {title}
      </h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">{description}</p>

      <div className="mt-8 flex items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white py-20 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          Content coming in the next step
        </p>
      </div>
    </div>
  );
}
