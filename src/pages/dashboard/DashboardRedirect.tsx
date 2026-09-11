import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { StudentDashboardPage } from '@/pages/dashboard/StudentDashboardPage';
import { InstructorDashboardPage } from '@/pages/dashboard/InstructorDashboardPage';
import { AdminDashboardPage } from '@/pages/dashboard/AdminDashboardPage';

export function DashboardRedirect() {
  const { profile } = useAuth();

  if (!profile) return <Navigate to="/auth/sign-in" replace />;

  switch (profile.role) {
    case 'student':
      return <StudentDashboardPage />;
    case 'instructor':
      return <InstructorDashboardPage />;
    case 'admin':
      return <AdminDashboardPage />;
    default:
      return <Navigate to="/auth/sign-in" replace />;
  }
}
