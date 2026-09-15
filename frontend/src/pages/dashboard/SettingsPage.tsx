import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, MoonStar, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  deleteLocalUserById,
  getMasterAdminEmail,
  isMasterAdminEmail,
  readLocalSettings,
  readLocalUsers,
  writeLocalSettings,
  writeLocalUsers,
  type LocalPlatformSettings,
  type LocalUserRecord,
} from '@/lib/localDb';
import { isValidEmail, normalizeSettingsText, sanitizeEmail } from '@/lib/validation';
import { AdminSettingsEnhancements } from '@/components/dashboard/AdminSettingsEnhancements';
import { useTranslation } from '@/context/I18nContext';

export function SettingsPage() {
  const { session, user, profile } = useAuth();
  const { t } = useTranslation();
  const currentUserEmail = (session?.email ?? user?.email ?? '').trim().toLowerCase();
  const isOwnerSession = currentUserEmail === getMasterAdminEmail().toLowerCase();
  const [settings, setSettings] = useState<LocalPlatformSettings>(readLocalSettings());
  const isAdmin = profile?.role === 'admin';
  const [profileForm, setProfileForm] = useState({
    fullName: user?.email ?? 'Platform Admin',
    email: user?.email ?? 'admin@learnflow.io',
    bio: 'Platform administrator and system owner.',
  });
  const [adminForm, setAdminForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const admins = useMemo(() => readLocalUsers().filter((entry) => entry.role === 'admin'), []);

  useEffect(() => {
    try {
      setLoading(true);
      setError(null);

      const nextSettings = readLocalSettings();
      const localUsers = readLocalUsers();
      const currentUser = session ? localUsers.find((entry) => entry.id === session.userId) : null;

      setSettings(nextSettings);
      setProfileForm({
        fullName: currentUser?.profile.full_name ?? user?.email ?? nextSettings.adminName,
        email: currentUser?.email ?? user?.email ?? nextSettings.adminEmail,
        bio: currentUser?.profile.bio ?? 'Platform administrator and system owner.',
      });
    } catch (loadError) {
      console.error('Failed to load settings:', loadError);
      setError('Unable to load your settings from the local platform database.');
    } finally {
      setLoading(false);
    }
  }, [session, user]);

  const updateSetting = <K extends keyof LocalPlatformSettings>(key: K, value: LocalPlatformSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const saveSettings = () => {
    try {
      setError(null);

      const nextFullName = normalizeSettingsText(profileForm.fullName, 80);
      const nextBio = normalizeSettingsText(profileForm.bio, 250);
      const nextEmail = sanitizeEmail(profileForm.email);

      if (!nextFullName || nextFullName.length < 2) {
        setError('Full name must contain at least 2 characters.');
        return;
      }

      if (!isValidEmail(nextEmail)) {
        setError('Please provide a valid email address for the profile.');
        return;
      }

      setProfileForm((current) => ({
        ...current,
        fullName: nextFullName,
        email: nextEmail,
        bio: nextBio,
      }));

      writeLocalSettings({
        ...settings,
        adminName: normalizeSettingsText(settings.adminName, 80),
        adminEmail: sanitizeEmail(settings.adminEmail),
        companyName: normalizeSettingsText(settings.companyName, 80),
        siteName: normalizeSettingsText(settings.siteName, 80),
        supportEmail: sanitizeEmail(settings.supportEmail),
      });

      if (session && user) {
        const users = readLocalUsers();
        const nextUsers = users.map((entry) =>
          entry.id === session.userId
            ? {
                ...entry,
                email: nextEmail,
                profile: {
                  ...entry.profile,
                  full_name: nextFullName,
                  bio: nextBio,
                  updated_at: new Date().toISOString(),
                },
              }
            : entry,
        );
        writeLocalUsers(nextUsers);
      }

      setSaved('Settings saved successfully.');
    } catch (saveError) {
      console.error('Failed to save settings:', saveError);
      setSaved(null);
      setError('Failed to persist the configuration locally.');
    }
  };

  const handleCreateAdmin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isAdmin) {
      setError('Only the master admin can create secondary administrators.');
      return;
    }

    const trimmedName = adminForm.name.trim();
    const trimmedEmail = sanitizeEmail(adminForm.email);
    const password = adminForm.password.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError('Administrator name must contain at least 2 characters.');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setError('Please provide a valid admin email address.');
      return;
    }

    if (!password || password.length < 6) {
      setError('Admin password must be at least 6 characters long.');
      return;
    }

    const users = readLocalUsers();
    const duplicate = users.some((user) => user.email.toLowerCase() === trimmedEmail.toLowerCase());
    if (duplicate) {
      setError('An account with that admin email already exists.');
      return;
    }

    const nextUsers: LocalUserRecord[] = [
      ...users,
      {
        id: crypto.randomUUID(),
        name: trimmedName,
        email: trimmedEmail,
        password,
        role: 'admin',
        avatar: null,
        status: 'active',
        joinedAt: new Date().toISOString(),
        profile: {
          id: crypto.randomUUID(),
          full_name: trimmedName,
          role: 'admin',
          avatar_url: null,
          bio: 'Secondary platform administrator.',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        permissions: {
          manageCourses: true,
          moderateStudents: true,
          viewAnalytics: true,
        },
        courseIds: [],
      },
    ];

    writeLocalUsers(nextUsers);
    setAdminForm({ name: '', email: '', password: '' });
    setSaved('Secondary admin account created successfully.');
    setError(null);
  };

  const handleDeleteAdmin = (adminId: string, adminEmail: string) => {
    if (!isAdmin || !isOwnerSession) {
      setError('Only the master admin can manage administrator access.');
      return;
    }

    if (isMasterAdminEmail(adminEmail) && currentUserEmail !== getMasterAdminEmail().toLowerCase()) {
      setError('The master admin account cannot be deleted by another user.');
      return;
    }

    const confirmed = window.confirm(
      isMasterAdminEmail(adminEmail)
        ? t('common.deleteConfirm')
        : t('common.deleteConfirm'),
    );
    if (!confirmed) return;

    try {
      const nextUsers = deleteLocalUserById(adminId, currentUserEmail);
      const targetWasMaster = isMasterAdminEmail(adminEmail);
      setSaved(targetWasMaster ? 'Master admin account removed from the local store.' : 'Secondary admin removed.');
      setError(null);
      if (currentUserEmail !== getMasterAdminEmail().toLowerCase()) {
        return;
      }
      if (targetWasMaster) {
        const localUsers = readLocalUsers();
        const fallbackOwner = localUsers.find((entry) => isMasterAdminEmail(entry.email));
        if (fallbackOwner) {
          setSaved('Master admin account removed.');
        }
      }
      if (targetWasMaster && adminId === session?.userId) {
        setSaved('Your master admin account has been deleted.');
      }
      if (!targetWasMaster) {
        setSaved('Secondary admin removed.');
      }
    } catch (deleteError) {
      console.error('Failed to delete admin:', deleteError);
      setError('The master admin account can only be deleted by the owner session.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          Loading settings…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
          {t('settings.platformSettings')}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
          {saved}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-950/30 dark:text-primary-300">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">{t('common.profile')}</p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('common.adminProfile')}</h2>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="label-text">{t('common.fullName')}</label>
              <input
                value={profileForm.fullName}
                onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))}
                className="input-field"
              />
            </div>

            <div>
              <label className="label-text">{t('common.email')}</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))}
                className="input-field"
              />
            </div>

            <div>
              <label className="label-text">{t('common.bio')}</label>
              <textarea
                rows={4}
                value={profileForm.bio}
                onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
                className="input-field resize-none"
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {isAdmin && (
            <div className="card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Preferences</p>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Platform preferences</h2>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label-text">Site name</label>
                    <input
                      value={settings.siteName}
                      onChange={(event) => updateSetting('siteName', event.target.value)}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label-text">Company name</label>
                    <input
                      value={settings.companyName}
                      onChange={(event) => updateSetting('companyName', event.target.value)}
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label-text">Support email</label>
                    <input
                      type="email"
                      value={settings.supportEmail}
                      onChange={(event) => updateSetting('supportEmail', event.target.value)}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label-text">Timezone</label>
                    <input
                      value={settings.timezone}
                      onChange={(event) => updateSetting('timezone', event.target.value)}
                      className="input-field"
                    />
                  </div>
                </div>

                <div>
                  <label className="label-text">Default theme</label>
                  <select
                    value={settings.defaultTheme}
                    onChange={(event) => updateSetting('defaultTheme', event.target.value as LocalPlatformSettings['defaultTheme'])}
                    className="input-field"
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Performance platform references</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Enable performance references for institutional reporting and dashboards.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.performancePlatformReferences}
                    onChange={(event) => updateSetting('performancePlatformReferences', event.target.checked)}
                    className="h-4 w-4 accent-primary-600"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">{t('common.systemConfig')}</p>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('common.accessAutomation')}</h2>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('common.allowSignup')}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.publicRegistration')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.allowStudentSignup}
                  onChange={(event) => updateSetting('allowStudentSignup', event.target.checked)}
                  className="h-4 w-4 accent-primary-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('common.requireVerification')}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.verifyNewAccounts')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.requireEmailVerification}
                  onChange={(event) => updateSetting('requireEmailVerification', event.target.checked)}
                  className="h-4 w-4 accent-primary-600"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('common.autoPublish')}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.publishImmediately')}</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoPublishCourses}
                  onChange={(event) => updateSetting('autoPublishCourses', event.target.checked)}
                  className="h-4 w-4 accent-primary-600"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-950/30 dark:text-primary-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Access control</p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Manage Administrator Access</h2>
            </div>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
            <form onSubmit={handleCreateAdmin} className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <div>
                <label className="label-text">Admin name</label>
                <input
                  value={adminForm.name}
                  onChange={(event) => setAdminForm((current) => ({ ...current, name: event.target.value }))}
                  className="input-field"
                  placeholder="New Platform Admin"
                />
              </div>

              <div>
                <label className="label-text">Admin email</label>
                <input
                  type="email"
                  value={adminForm.email}
                  onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
                  className="input-field"
                  placeholder="admin@company.com"
                />
              </div>

              <div>
                <label className="label-text">Temporary password</label>
                <input
                  type="text"
                  value={adminForm.password}
                  onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))}
                  className="input-field"
                  placeholder="SecurePass123"
                />
              </div>

              <button type="submit" className="btn-primary w-full">
                <ShieldCheck className="h-4 w-4" />
                Add admin
              </button>
            </form>

            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Master Admin / Owner</p>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{readLocalUsers().find((entry) => isMasterAdminEmail(entry.email))?.name ?? 'Platform Admin'}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{getMasterAdminEmail()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                      Protected
                    </span>
                    {isOwnerSession && (
                      <button
                        type="button"
                        className="btn-secondary border-red-200 px-2.5 py-2 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                        onClick={() => handleDeleteAdmin(readLocalUsers().find((entry) => isMasterAdminEmail(entry.email))?.id ?? '', getMasterAdminEmail())}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Secondary administrators</p>
                {readLocalUsers().filter((entry) => entry.role === 'admin' && !isMasterAdminEmail(entry.email)).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    No secondary admins yet.
                  </div>
                ) : (
                  readLocalUsers()
                    .filter((entry) => entry.role === 'admin' && !isMasterAdminEmail(entry.email))
                    .map((admin) => (
                      <div key={admin.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{admin.name}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{admin.email}</p>
                        </div>
                        {isOwnerSession && (
                          <button
                            type="button"
                            className="btn-secondary border-red-200 px-2.5 py-2 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                            onClick={() => handleDeleteAdmin(admin.id, admin.email)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={saveSettings} className="btn-primary">
          <Save className="h-4 w-4" />
          {t('common.saveSettings')}
        </button>
      </div>

      {isAdmin && <AdminSettingsEnhancements />}
    </div>
  );
}
