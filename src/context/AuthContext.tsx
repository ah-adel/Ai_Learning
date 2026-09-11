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
  seedLocalDatabase,
  writeLocalSession,
  writeLocalUsers,
} from '@/lib/localDb';

type LocalSession = {
  userId: string;
  email: string;
};

type LocalUser = {
  id: string;
  email: string;
  role: UserRole;
};

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
      const users = readLocalUsers();
      const userMatch = users.find((user) => user.id === userId);
      const nextProfile = userMatch?.profile ?? null;
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      console.error('Failed to load local profile:', error);
      setProfile(null);
      return null;
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }

    try {
      seedLocalDatabase();
      const currentSession = readLocalSession();
      if (!currentSession?.userId) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      const users = readLocalUsers();
      const currentUser = users.find((user) => user.id === currentSession.userId);
      const nextProfile = currentUser?.profile ?? (currentUser ? buildProfile(currentUser.id, currentUser.name, currentUser.role) : null);
      setSession({ userId: currentSession.userId, email: currentSession.email });
      setProfile(nextProfile);
    } catch (error) {
      console.error('Failed to restore local session:', error);
      setSession(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  async function signIn(email: string, password: string) {
    if (typeof window === 'undefined') {
      return { error: 'Local auth is only available in the browser.' };
    }

    try {
      const users = readLocalUsers();
      const match = users.find(
        (user) => user.email.toLowerCase() === email.toLowerCase() && user.password === password,
      );

      if (!match) {
        return { error: 'Invalid email or password.' };
      }

      const nextSession = { userId: match.id, email: match.email };
      writeLocalSession(nextSession);
      setSession(nextSession);
      setProfile(match.profile ?? buildProfile(match.id, match.name, match.role));
      return { error: null };
    } catch (error) {
      console.error('Failed to sign in locally:', error);
      return { error: 'Unable to sign in with local storage.' };
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

      const users = readLocalUsers();
      const emailLower = email.toLowerCase();

      if (users.some((user) => user.email.toLowerCase() === emailLower)) {
        return { error: 'An account with that email already exists.' };
      }

      const userId = crypto.randomUUID();
      const profile = buildProfile(userId, fullName, role);
      const nextUser = {
        id: userId,
        name: fullName,
        email: emailLower,
        password,
        role,
        avatar: null,
        profile,
      };

      const nextUsers = [...users, nextUser];
      writeLocalUsers(nextUsers);

      const nextSession = { userId, email: emailLower };
      writeLocalSession(nextSession);
      setSession(nextSession);
      setProfile(profile);
      return { error: null };
    } catch (error) {
      console.error('Failed to sign up locally:', error);
      return { error: 'Unable to create the local account.' };
    }
  }

  async function signOut() {
    if (typeof window !== 'undefined') {
      writeLocalSession(null);
    }
    setProfile(null);
    setSession(null);
  }

  async function refreshProfile() {
    if (!session?.userId) return;
    await loadProfile(session.userId);
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
