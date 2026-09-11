import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { ProtectedRoute } from '@/components/dashboard/ProtectedRoute';
import { LandingPage } from '@/pages/LandingPage';
import { SignInPage } from '@/pages/auth/SignInPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { DashboardRedirect } from '@/pages/dashboard/DashboardRedirect';
import { StudentDashboardPage } from '@/pages/dashboard/StudentDashboardPage';
import { InstructorDashboardPage } from '@/pages/dashboard/InstructorDashboardPage';
import { AdminDashboardPage } from '@/pages/dashboard/AdminDashboardPage';
import { AdminCoursesPage } from '@/pages/dashboard/AdminCoursesPage';
import { CoursesPage } from '@/pages/dashboard/CoursesPage';
import { CourseDetailPage } from '@/pages/dashboard/CourseDetailPage';
import { BrowseCoursesPage } from '@/pages/dashboard/BrowseCoursesPage';
import { StudentsPage } from '@/pages/dashboard/StudentsPage';
import { InstructorsPage } from '@/pages/dashboard/InstructorsPage';
import { AiModelsPage } from '@/pages/dashboard/AiModelsPage';
import { SettingsPage } from '@/pages/dashboard/SettingsPage';

function GuestRoute({ children }: { children: React.ReactNode }) {
  // Redirect authenticated users away from auth pages
  // SignInPage/SignUpPage handle their own auth redirect logic internally
  return <>{children}</>;
}

function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.search]);

  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<LandingPage />} />

            {/* Auth routes */}
            <Route
              path="/auth/sign-in"
              element={
                <GuestRoute>
                  <SignInPage />
                </GuestRoute>
              }
            />
            <Route
              path="/auth/sign-up"
              element={
                <GuestRoute>
                  <SignUpPage />
                </GuestRoute>
              }
            />

            {/* Dashboard routes — wrapped in shared layout */}
            <Route element={<DashboardLayout />}>
              {/* Role-aware dashboard root */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['student', 'instructor', 'admin']}>
                    <DashboardRedirect />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/student"
                element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <StudentDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/instructor"
                element={
                  <ProtectedRoute allowedRoles={['instructor']}>
                    <InstructorDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard/admin/courses"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminCoursesPage />
                  </ProtectedRoute>
                }
              />
              {/* Student routes */}
              <Route
                path="/student"
                element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <StudentDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/browse"
                element={
                  <ProtectedRoute allowedRoles={['student']}>
                    <BrowseCoursesPage />
                  </ProtectedRoute>
                }
              />
              {/* Instructor routes */}
              <Route
                path="/instructor"
                element={
                  <ProtectedRoute allowedRoles={['instructor']}>
                    <InstructorDashboardPage />
                  </ProtectedRoute>
                }
              />
              {/* Admin routes */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminDashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/courses"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminCoursesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/instructors"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <InstructorsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/ai-models"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AiModelsPage />
                  </ProtectedRoute>
                }
              />
              {/* Shared routes */}
              <Route
                path="/courses"
                element={
                  <ProtectedRoute allowedRoles={['student', 'instructor']}>
                    <CoursesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courses/:courseId"
                element={
                  <ProtectedRoute allowedRoles={['student', 'instructor']}>
                    <CourseDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/students"
                element={
                  <ProtectedRoute allowedRoles={['instructor', 'admin']}>
                    <StudentsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute allowedRoles={['student', 'instructor', 'admin']}>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Root redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
