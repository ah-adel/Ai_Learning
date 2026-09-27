import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { ProtectedRoute } from '@/components/dashboard/ProtectedRoute';
const LandingPage = lazy(() => import('@/pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const SignInPage = lazy(() => import('@/pages/auth/SignInPage').then((module) => ({ default: module.SignInPage })));
const SignUpPage = lazy(() => import('@/pages/auth/SignUpPage').then((module) => ({ default: module.SignUpPage })));
const DashboardRedirect = lazy(() => import('@/pages/dashboard/DashboardRedirect').then((module) => ({ default: module.DashboardRedirect })));
const StudentDashboardPage = lazy(() => import('@/pages/dashboard/StudentDashboardPage').then((module) => ({ default: module.StudentDashboardPage })));
const InstructorDashboardPage = lazy(() => import('@/pages/dashboard/InstructorDashboardPage').then((module) => ({ default: module.InstructorDashboardPage })));
const AdminDashboardPage = lazy(() => import('@/pages/dashboard/AdminDashboardPage').then((module) => ({ default: module.AdminDashboardPage })));
const AdminCoursesPage = lazy(() => import('@/pages/dashboard/AdminCoursesPage').then((module) => ({ default: module.AdminCoursesPage })));
const CoursesPage = lazy(() => import('@/pages/dashboard/CoursesPage').then((module) => ({ default: module.CoursesPage })));
const CourseDetailPage = lazy(() => import('@/pages/dashboard/CourseDetailPage').then((module) => ({ default: module.CourseDetailPage })));
const BrowseCoursesPage = lazy(() => import('@/pages/dashboard/BrowseCoursesPage').then((module) => ({ default: module.BrowseCoursesPage })));
const AdminStudentsPage = lazy(() => import('@/pages/dashboard/AdminStudentsPage').then((module) => ({ default: module.AdminStudentsPage })));
const InstructorsPage = lazy(() => import('@/pages/dashboard/InstructorsPage').then((module) => ({ default: module.InstructorsPage })));
const AiModelsPage = lazy(() => import('@/pages/dashboard/AiModelsPage').then((module) => ({ default: module.AiModelsPage })));
const SettingsPage = lazy(() => import('@/pages/dashboard/SettingsPage').then((module) => ({ default: module.SettingsPage })));

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

function RootRoute() {
  const { loading, user, profile } = useAuth();

  if (loading || (user && !profile)) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950" />;
  }

  if (user && profile) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950" aria-label="Loading page" />}>
          <Routes>
            <Route path="/" element={<RootRoute />} />

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
                  <ProtectedRoute allowedRoles={['student', 'admin']}>
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
                  <ProtectedRoute allowedRoles={['student', 'instructor', 'admin']}>
                    <CoursesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courses/:courseId"
                element={
                  <ProtectedRoute allowedRoles={['student', 'instructor', 'admin']}>
                    <CourseDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/students"
                element={
                  <ProtectedRoute allowedRoles={['instructor', 'admin']}>
                    <AdminStudentsPage />
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
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
