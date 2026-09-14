import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getDashboardPathForRole } from '@/config/navigation';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/types/database.types';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!allowedRoles.includes(profile.role)) {
    const fallback = getDashboardPathForRole(profile.role);
    if (typeof window !== 'undefined') {
      window.alert(`Access denied for ${profile.role}. Redirecting to your authorized dashboard.`);
    }
    return <Navigate to={fallback} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
