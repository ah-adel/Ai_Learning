import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, LogOut, User as UserIcon, ChevronDown } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';

interface TopBarProps {
  onOpenMobile: () => void;
}

export function TopBar({ onOpenMobile }: TopBarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = (profile?.full_name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white/80 px-4 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/80 lg:px-6">
      {/* Left: mobile menu button */}
      <button
        onClick={onOpenMobile}
        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Right: theme toggle + profile menu */}
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg p-1.5 pr-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="User menu"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">
              {initials}
            </div>
            <span className="hidden text-sm font-medium text-gray-700 dark:text-gray-200 sm:block">
              {profile?.full_name ?? 'User'}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transition-transform ${
                menuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg shadow-gray-900/5 animate-scale-in dark:border-gray-700 dark:bg-gray-800 dark:shadow-gray-950/30">
              <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {profile?.full_name ?? 'User'}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                  {profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : ''}
                </p>
              </div>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
              >
                <UserIcon className="h-4 w-4 text-gray-400" />
                Profile settings
              </button>

              <div className="my-1 border-t border-gray-100 dark:border-gray-700" />

              <button
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-error-600 transition-colors hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-950/30"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
