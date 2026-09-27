import { useEffect, useState } from 'react';
import { AlertCircle, Bell, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getMasterAdminEmail,
  isMasterAdminEmail,
  type LocalPlatformSettings,
} from '@/lib/localDb';
import { fetchAdminSettings, saveAdminSettings } from '@/lib/adminSettingsRepository';
import { createAdminAdministrator, deleteAdminUser, fetchAdminUsers, type AdminUser } from '@/lib/adminUserRepository';
import { errorMessage } from '@/lib/apiError';
import { isValidEmail, normalizeSettingsText, sanitizeEmail } from '@/lib/validation';
import { AdminSettingsEnhancements } from '@/components/dashboard/AdminSettingsEnhancements';
import { useTranslation } from '@/context/I18nContext';

const defaultPlatformSettings: LocalPlatformSettings = {
  adminName: 'Platform Admin',
  adminEmail: 'ah.adel2188@gmail.com',
  companyName: 'Fasl_ai',
  siteName: 'Fasl_ai',
  timezone: 'UTC',
  allowStudentSignup: true,
  requireEmailVerification: true,
  autoPublishCourses: false,
  defaultTheme: 'system',
  supportEmail: 'support@learnflow.io',
  performancePlatformReferences: true,
};

export function SettingsPage() {
  const { session, user, profile, updateAccount } = useAuth();
  const { t } = useTranslation();
  const currentUserEmail = (session?.email ?? user?.email ?? '').trim().toLowerCase();
  const isOwnerSession = currentUserEmail === getMasterAdminEmail().toLowerCase();
  const [settings, setSettings] = useState<LocalPlatformSettings>(defaultPlatformSettings);
  const isAdmin = profile?.role === 'admin';
  const [profileForm, setProfileForm] = useState({
    fullName: profile?.full_name ?? 'Platform Admin',
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
  const [admins, setAdmins] = useState<AdminUser[]>([]);

  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const [platform, adminUsers] = isAdmin
          ? await Promise.all([fetchAdminSettings(), fetchAdminUsers()])
          : [null, [] as AdminUser[]];
        if (!isMounted) return;
        const localSettings = defaultPlatformSettings;
        setSettings(platform ? {
          ...localSettings,
          adminName: profile?.full_name ?? platform.adminName ?? localSettings.adminName,
          adminEmail: user?.email ?? platform.adminEmail ?? localSettings.adminEmail,
          companyName: platform.companyName ?? localSettings.companyName,
          siteName: platform.siteName ?? platform.platform_name,
          timezone: platform.timezone ?? localSettings.timezone,
          allowStudentSignup: platform.allowStudentSignup ?? localSettings.allowStudentSignup,
          requireEmailVerification: platform.requireEmailVerification ?? localSettings.requireEmailVerification,
          autoPublishCourses: platform.autoPublishCourses ?? localSettings.autoPublishCourses,
          defaultTheme: platform.default_theme ?? localSettings.defaultTheme,
          supportEmail: platform.support_email ?? localSettings.supportEmail,
          performancePlatformReferences: platform.performancePlatformReferences ?? localSettings.performancePlatformReferences,
        } : localSettings);
        setAdmins(adminUsers.filter((entry) => entry.role === 'admin'));
        setProfileForm({
          fullName: profile?.full_name ?? localSettings.adminName,
          email: user?.email ?? localSettings.adminEmail,
          bio: 'Platform administrator and system owner.',
        });
      } catch (loadError) {
        console.error('Failed to load settings:', loadError);
        if (isMounted) setError(errorMessage(loadError, t('settingsErrors.loadError')));
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void loadSettings();
    return () => { isMounted = false; };
  }, [isAdmin, profile, session, t, user]);

  const updateSetting = <K extends keyof LocalPlatformSettings>(key: K, value: LocalPlatformSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const saveSettings = async () => {
    try {
      setError(null);

      const nextFullName = normalizeSettingsText(profileForm.fullName, 80);
      const nextBio = normalizeSettingsText(profileForm.bio, 250);
      const nextEmail = sanitizeEmail(profileForm.email);

      if (!nextFullName || nextFullName.length < 2) {
        setError(t('settingsErrors.fullNameRequired'));
        return;
      }

      if (!isValidEmail(nextEmail)) {
        setError(t('settingsErrors.validProfileEmail'));
        return;
      }

      setProfileForm((current) => ({
        ...current,
        fullName: nextFullName,
        email: nextEmail,
        bio: nextBio,
      }));

      const sanitizedSettings = {
        ...settings,
        adminName: normalizeSettingsText(settings.adminName, 80),
        adminEmail: sanitizeEmail(settings.adminEmail),
        companyName: normalizeSettingsText(settings.companyName, 80),
        siteName: normalizeSettingsText(settings.siteName, 80),
        supportEmail: sanitizeEmail(settings.supportEmail),
      };

      if (isAdmin) {
        const persisted = await saveAdminSettings({
          platform_name: sanitizedSettings.siteName,
          support_email: sanitizedSettings.supportEmail,
          default_theme: sanitizedSettings.defaultTheme,
          companyName: sanitizedSettings.companyName,
          siteName: sanitizedSettings.siteName,
          timezone: sanitizedSettings.timezone,
          allowStudentSignup: sanitizedSettings.allowStudentSignup,
          requireEmailVerification: sanitizedSettings.requireEmailVerification,
          autoPublishCourses: sanitizedSettings.autoPublishCourses,
          performancePlatformReferences: sanitizedSettings.performancePlatformReferences,
        });
        setSettings((current) => ({ ...current, ...sanitizedSettings, ...persisted }));
      }

      if (session && user) {
        const accountUpdate = await updateAccount(nextFullName, nextEmail, nextBio);
        if (accountUpdate.error) {
          setError(accountUpdate.error);
          return;
        }
      }

      setSaved(t('settingsErrors.settingsSaved'));
    } catch (saveError) {
      console.error('Failed to save settings:', saveError);
      setSaved(null);
      setError(errorMessage(saveError, t('settingsErrors.persistError')));
    }
  };

  const handleCreateAdmin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isOwnerSession) {
      setError(t('settingsErrors.masterAdminCreateOnly'));
      return;
    }

    const trimmedName = adminForm.name.trim();
    const trimmedEmail = sanitizeEmail(adminForm.email);
    const password = adminForm.password.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError(t('settingsErrors.adminNameRequired'));
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setError(t('settingsErrors.validAdminEmail'));
      return;
    }

    if (!password || password.length < 6) {
      setError(t('settingsErrors.adminPasswordLength'));
      return;
    }

    try {
      await createAdminAdministrator({ full_name: trimmedName, email: trimmedEmail, password, status: 'active' });
      setAdmins((await fetchAdminUsers()).filter((entry) => entry.role === 'admin'));
      setAdminForm({ name: '', email: '', password: '' });
      setSaved(t('settingsErrors.secondaryAdminCreated'));
      setError(null);
    } catch (createError) {
      setError(errorMessage(createError, t('settingsErrors.persistError')));
    }
  };

  const handleDeleteAdmin = async (adminId: string, adminEmail: string) => {
    if (!isAdmin || !isOwnerSession) {
      setError(t('settingsErrors.masterAdminManageOnly'));
      return;
    }

    if (isMasterAdminEmail(adminEmail) && currentUserEmail !== getMasterAdminEmail().toLowerCase()) {
      setError(t('settingsErrors.masterAdminDeleteOnly'));
      return;
    }

    const confirmed = window.confirm(
      isMasterAdminEmail(adminEmail)
        ? t('common.deleteConfirm')
        : t('common.deleteConfirm'),
    );
    if (!confirmed) return;

    try {
      await deleteAdminUser(adminId);
      setAdmins((await fetchAdminUsers()).filter((entry) => entry.role === 'admin'));
      const targetWasMaster = isMasterAdminEmail(adminEmail);
      setSaved(targetWasMaster ? t('settingsErrors.masterAdminRemoved') : t('settingsErrors.secondaryAdminRemoved'));
      setError(null);
      if (currentUserEmail !== getMasterAdminEmail().toLowerCase()) {
        return;
      }
      if (targetWasMaster && adminId === session?.userId) {
        setSaved(t('settingsErrors.masterAdminDeleted'));
      }
      if (!targetWasMaster) {
        setSaved(t('settingsErrors.secondaryAdminRemoved'));
      }
    } catch (deleteError) {
      console.error('Failed to delete admin:', deleteError);
      setError(errorMessage(deleteError, t('settingsErrors.ownerDeleteOnly')));
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
                  <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">{t('common.preferences')}</p>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('settings.platformPreferences')}</h2>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label-text">{t('settings.siteName')}</label>
                    <input
                      value={settings.siteName}
                      onChange={(event) => updateSetting('siteName', event.target.value)}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label-text">{t('settings.companyName')}</label>
                    <input
                      value={settings.companyName}
                      onChange={(event) => updateSetting('companyName', event.target.value)}
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label-text">{t('settings.supportEmail')}</label>
                    <input
                      type="email"
                      value={settings.supportEmail}
                      onChange={(event) => updateSetting('supportEmail', event.target.value)}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label-text">{t('settings.timezone')}</label>
                    <input
                      value={settings.timezone}
                      onChange={(event) => updateSetting('timezone', event.target.value)}
                      className="input-field"
                    />
                  </div>
                </div>

                <div>
                  <label className="label-text">{t('settings.defaultTheme')}</label>
                  <select
                    value={settings.defaultTheme}
                    onChange={(event) => updateSetting('defaultTheme', event.target.value as LocalPlatformSettings['defaultTheme'])}
                    className="input-field"
                  >
                    <option value="system">{t('settings.themeSystem')}</option>
                    <option value="light">{t('settings.themeLight')}</option>
                    <option value="dark">{t('settings.themeDark')}</option>
                  </select>
                </div>

                <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/60">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{t('settings.performanceReferences')}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.performanceReferencesDescription')}</p>
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

          {isAdmin && <div className="card p-5">
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
          </div>}
        </div>
      </div>

      {isAdmin && (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-950/30 dark:text-primary-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">{t('settings.accessControl')}</p>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('settings.accessControlTitle')}</h2>
            </div>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
            <form onSubmit={handleCreateAdmin} className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <div>
                <label className="label-text">{t('settings.adminName')}</label>
                <input
                  value={adminForm.name}
                  onChange={(event) => setAdminForm((current) => ({ ...current, name: event.target.value }))}
                  className="input-field"
                  placeholder={t('settings.newPlatformAdmin')}
                />
              </div>

              <div>
                <label className="label-text">{t('settings.adminEmail')}</label>
                <input
                  type="email"
                  value={adminForm.email}
                  onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))}
                  className="input-field"
                  placeholder="admin@company.com"
                />
              </div>

              <div>
                <label className="label-text">{t('settings.temporaryPassword')}</label>
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
                {t('settings.addAdmin')}
              </button>
            </form>

            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.masterAdminOwner')}</p>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{admins.find((entry) => isMasterAdminEmail(entry.email))?.name ?? 'Platform Admin'}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{getMasterAdminEmail()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                      {t('settings.protected')}
                    </span>
                    {isOwnerSession && (
                      <button
                        type="button"
                        className="btn-secondary border-red-200 px-2.5 py-2 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                        onClick={() => handleDeleteAdmin(admins.find((entry) => isMasterAdminEmail(entry.email))?.id ?? '', getMasterAdminEmail())}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings.secondaryAdmins')}</p>
                {admins.filter((entry) => !isMasterAdminEmail(entry.email)).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    {t('settings.noSecondaryAdmins')}
                  </div>
                ) : (
                  admins
                    .filter((entry) => !isMasterAdminEmail(entry.email))
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
