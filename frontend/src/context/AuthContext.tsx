import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Profile, UserRole } from '@/types/database.types';
import {
  isPublicSignupRole,
  readLocalSession,
  readLocalUsers,
  writeLocalSession,
  writeLocalUsers,
} from '@/lib/localDb';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      cache: 'no-store',
      signal: options.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.detail ?? 'Authentication request failed.');
  }

  return (payload?.data ?? payload) as T;
}

type LocalSession = {
  userId: string;
  email: string;
};

type LocalUser = {
  id: string;
  email: string;
  role: UserRole;
};

interface UserListRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended';
  avatar?: string | null;
  joined_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface AdminStats {
  total_users: number;
  total_students: number;
  total_instructors: number;
  total_courses: number;
  published_courses: number;
  total_enrollments: number;
}

interface AdminCourseRow {
  id: string;
  instructor_id: string;
  title: string;
  description: string;
  thumbnail_url?: string | null;
  is_published: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  status?: 'draft' | 'published' | 'review';
}

interface AuthContextValue {
  session: LocalSession | null;
  user: LocalUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: UserRole
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  fetchUsers: () => Promise<UserListRow[]>;
  fetchAdminStats: () => Promise<AdminStats>;
  fetchAdminCourses: () => Promise<AdminCourseRow[]>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function buildProfile(userId: string, fullName: string, role: UserRole): Profile {
  const now = new Date().toISOString();

  return {
    id: userId,
    full_name: fullName,
    role,
    avatar_url: null,
    bio: null,
    created_at: now,
    updated_at: now,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string): Promise<Profile | null> {
    if (!userId || typeof window === 'undefined') return null;

    try {
      const authSession = await apiRequest<{ user: { id: string; email: string; role: UserRole }; profile: Profile | null }>(`/api/auth/me?user_id=${encodeURIComponent(userId)}`);
      const nextProfile = authSession?.profile ?? null;
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      console.error('Failed to load backend profile:', error);
      setProfile(null);
      return null;
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }

    const restoreSession = async () => {
      try {
        const currentSession = readLocalSession();
        if (!currentSession?.userId) {
          setSession(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        const profileFromBackend = await loadProfile(currentSession.userId);
        setSession({ userId: currentSession.userId, email: currentSession.email });
        setProfile(profileFromBackend ?? null);
      } catch (error) {
        console.error('Failed to restore backend session:', error);
        setSession(null);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    void restoreSession();
  }, []);

  async function signIn(email: string, password: string) {
    if (typeof window === 'undefined') {
      return { error: 'Local auth is only available in the browser.' };
    }

    try {
      const authResponse = await apiRequest<{ user: { id: string; email: string; role: UserRole }; session: { user_id: string; email: string; authenticated: boolean }; profile: Profile | null }>(`/api/auth/sign-in`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      const user = authResponse?.user;
      if (!user) {
        return { error: 'Invalid email or password.' };
      }

      const nextSession = { userId: user.id, email: user.email };
      window.sessionStorage.setItem('learnflow_session_token', user.id);
      writeLocalSession(nextSession);
      setSession(nextSession);
      setProfile(authResponse?.profile ?? buildProfile(user.id, user.email, user.role));
      return { error: null };
    } catch (error) {
      console.error('Failed to sign in with backend:', error);
      return { error: error instanceof Error ? error.message : 'Unable to sign in.' };
    }
  }

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    role: UserRole
  ) {
    if (typeof window === 'undefined') {
      return { error: 'Local auth is only available in the browser.' };
    }

    try {
      if (!isPublicSignupRole(role)) {
        return { error: 'Public signup is limited to student and instructor accounts.' };
      }

      const authResponse = await apiRequest<{ user: { id: string; email: string; role: UserRole }; session: { user_id: string; email: string; authenticated: boolean }; profile: Profile | null }>(`/api/auth/sign-up`, {
        method: 'POST',
        body: JSON.stringify({ email, password, full_name: fullName, role }),
      });

      const user = authResponse?.user;
      if (!user) {
        return { error: 'Unable to create the account.' };
      }

      const nextSession = { userId: user.id, email: user.email };
      window.sessionStorage.setItem('learnflow_session_token', user.id);
      writeLocalSession(nextSession);
      setSession(nextSession);
      setProfile(authResponse?.profile ?? buildProfile(user.id, fullName, user.role));
      return { error: null };
    } catch (error) {
      console.error('Failed to sign up with backend:', error);
      return { error: error instanceof Error ? error.message : 'Unable to create the account.' };
    }
  }

  async function signOut() {
    if (typeof window === 'undefined') {
      return;
    }

    const localKeys = ['learnflow_session', 'learnflow_session_token', 'access_token', 'token'];
    localKeys.forEach((key) => {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    });

    writeLocalSession(null);
    setProfile(null);
    setSession(null);

    try {
      void fetch(`${API_BASE_URL}/api/auth/sign-out`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      }).catch((error) => {
        console.warn('Sign-out request failed; continuing local logout.', error);
      });
    } finally {
      window.location.href = '/';
    }
  }

  async function refreshProfile() {
    if (!session?.userId) return;
    await loadProfile(session.userId);
  }

  async function fetchUsers(): Promise<UserListRow[]> {
    const users = await apiRequest<UserListRow[]>(`/api/users`, {
      method: 'GET',
    });
    return Array.isArray(users) ? users : [];
  }

  async function fetchAdminStats(): Promise<AdminStats> {
    const stats = await apiRequest<AdminStats>(`/api/admin/stats`, {
      method: 'GET',
    });
    return {
      total_users: Number(stats?.total_users ?? 0),
      total_students: Number(stats?.total_students ?? 0),
      total_instructors: Number(stats?.total_instructors ?? 0),
      total_courses: Number(stats?.total_courses ?? 0),
      published_courses: Number(stats?.published_courses ?? 0),
      total_enrollments: Number(stats?.total_enrollments ?? 0),
    };
  }

  async function fetchAdminCourses(): Promise<AdminCourseRow[]> {
    const courses = await apiRequest<AdminCourseRow[]>(`/api/admin/courses`, {
      method: 'GET',
    });
    return Array.isArray(courses) ? courses : [];
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session && profile ? { id: session.userId, email: session.email, role: profile.role } : null,
      profile,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      fetchUsers,
      fetchAdminStats,
      fetchAdminCourses,
    }),
    [loading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
