import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  GraduationCap,
  Briefcase,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { isValidEmail, sanitizeEmail, sanitizeText, validateDisplayName, validatePassword } from '@/lib/validation';
import type { UserRole } from '@/types/database.types';

type PublicSignupRole = 'student' | 'instructor';

const ROLE_OPTIONS: {
  value: PublicSignupRole;
  label: string;
  description: string;
  icon: typeof GraduationCap;
}[] = [
  {
    value: 'student',
    label: 'Student',
    description: 'Enroll in courses and learn',
    icon: GraduationCap,
  },
  {
    value: 'instructor',
    label: 'Instructor',
    description: 'Create and manage courses',
    icon: Briefcase,
  },
];

export function SignUpPage() {
  const { signUp, user, loading: authLoading } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<PublicSignupRole>('student');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const sanitizedName = validateDisplayName(fullName);
    const sanitizedEmail = sanitizeEmail(email);
    const passwordError = validatePassword(password);

    if (!sanitizedName) {
      setError('Please enter a valid full name with at least 2 characters.');
      return;
    }

    if (!isValidEmail(sanitizedEmail)) {
      setError('Please provide a valid email address.');
      return;
    }

    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    const { error: signUpError } = await signUp(
      sanitizedEmail,
      password.trim(),
      sanitizedName,
      selectedRole,
    );

    if (signUpError) {
      setError(signUpError);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (!authLoading && user) return <Navigate to="/dashboard" replace />;

  if (success) {
    return (
      <AuthLayout
        title="Account created"
        subtitle="You're all set to start learning"
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-100 dark:bg-success-900/30">
            <ShieldCheck className="h-7 w-7 text-success-600 dark:text-success-400" />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your account has been created successfully. You can now sign in with
            your credentials.
          </p>
          <Link to="/auth/sign-in" className="btn-primary mt-6 w-full">
            Continue to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join the platform as a student or instructor"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-start gap-2.5 rounded-lg bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-300">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Role selection */}
        <div>
          <span className="label-text">I want to join as</span>
          <div className="grid grid-cols-3 gap-2.5">
            {ROLE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = selectedRole === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedRole(option.value)}
                  className={`group flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                    isSelected
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500/20 dark:border-primary-500 dark:bg-primary-950/30'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 transition-colors ${
                      isSelected
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-gray-400 group-hover:text-gray-500 dark:group-hover:text-gray-300'
                    }`}
                  />
                  <span
                    className={`text-xs font-semibold ${
                      isSelected
                        ? 'text-primary-700 dark:text-primary-300'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            {ROLE_OPTIONS.find((r) => r.value === selectedRole)?.description}
          </p>
        </div>

        <div>
          <label htmlFor="fullName" className="label-text">
            Full name
          </label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className="input-field pl-10"
              autoComplete="name"
              autoFocus
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="label-text">
            Email address
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input-field pl-10"
              autoComplete="email"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="label-text">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="input-field pl-10 pr-10"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating account...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              Create account
              <ArrowRight className="h-4 w-4" />
            </span>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Already have an account?{' '}
        <Link
          to="/auth/sign-in"
          className="font-semibold text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
