import { useEffect, useState } from 'react';
import { CheckCircle2, Database, Mail, Save, ShieldCheck, Trash2 } from 'lucide-react';
import {
  fetchAdminSettings,
  fetchStorageSnapshot,
  runStorageCleanup,
  saveAdminSettings,
  sendTestEmail,
  type AdminSettings,
  type StorageSnapshot,
} from '@/lib/adminSettingsRepository';
import { useTranslation } from '@/context/I18nContext';
import { errorMessage } from '@/lib/apiError';

const defaults: AdminSettings = {
  platform_name: 'Fasl_ai',
  support_email: '',
  currency: 'USD',
  default_language: 'en',
  default_theme: 'system',
  enforce_mfa: false,
  jwt_expiration_minutes: 60,
  password_min_length: 8,
  password_require_uppercase: true,
  password_require_number: true,
  password_require_symbol: true,
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password: '',
  smtp_from_email: '',
  smtp_use_tls: true,
};

export function AdminSettingsEnhancements() {
  const { t, formatNumber } = useTranslation();
  const [settings, setSettings] = useState<AdminSettings>(defaults);
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [nextSettings, nextStorage] = await Promise.all([fetchAdminSettings(), fetchStorageSnapshot()]);
      setSettings({ ...defaults, ...nextSettings });
      setStorage(nextStorage);
    } catch (reason: unknown) {
      console.error('Unable to load platform system settings:', reason);
      setError(errorMessage(reason, t('adminSettings.systemLoadError')));
    }
  };

  useEffect(() => {
    void load();
  }, [t]);

  const update = <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setSettings(await saveAdminSettings(settings));
      setNotice(t('adminSettings.systemSaved'));
    } catch (reason: unknown) {
      console.error('Failed to save platform system settings:', reason);
      setError(errorMessage(reason, t('adminSettings.systemSaveError')));
    } finally {
      setBusy(false);
    }
  };

  const cleanup = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runStorageCleanup();
      setStorage(result.storage);
      setNotice(t('adminSettings.filesCleaned', { count: formatNumber(result.deleted_files.length) }));
    } catch (reason: unknown) {
      console.error('Storage cleanup failed:', reason);
      setError(errorMessage(reason, t('adminSettings.cleanupError')));
    } finally {
      setBusy(false);
    }
  };

  const testEmail = async () => {
    if (!recipient.trim()) {
      setError(t('adminSettings.recipientRequired'));
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendTestEmail({
        recipient,
        host: settings.smtp_host,
        port: settings.smtp_port,
        username: settings.smtp_username,
        password: settings.smtp_password,
        from_email: settings.smtp_from_email,
        use_tls: settings.smtp_use_tls,
      });
      setNotice(t('adminSettings.testEmailSent'));
    } catch (reason: unknown) {
      console.error('SMTP test failed:', reason);
      setError(errorMessage(reason, t('adminSettings.smtpError')));
    } finally {
      setBusy(false);
    }
  };

  const formatMegabytes = (bytes: number) =>
    t('adminSettings.megabytes', { value: formatNumber(bytes / (1024 * 1024)) });

  const storageCard = (path: string, data: { bytes: number; files: number }) => (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <p className="font-semibold"><Database className="me-2 inline h-4 w-4" />{path}</p>
      <p className="mt-2 text-xl font-bold">{formatMegabytes(data.bytes)}</p>
      <p className="text-sm text-gray-500">{t('adminSettings.fileCount', { count: formatNumber(data.files) })}</p>
    </div>
  );

  return (
    <section className="card space-y-5 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.12em] text-primary-600">{t('adminSettings.newControls')}</p>
        <h2 className="text-lg font-semibold">{t('adminSettings.configurationSecurityStorageEmail')}</h2>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="flex items-center gap-2 text-sm text-emerald-600" role="status"><CheckCircle2 className="h-4 w-4" />{notice}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="admin-platform-name" className="label-text">{t('adminSettings.platformName')}</label>
          <input id="admin-platform-name" value={settings.platform_name} onChange={(event) => update('platform_name', event.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-currency" className="label-text">{t('adminSettings.currency')}</label>
          <input id="admin-currency" value={settings.currency} onChange={(event) => update('currency', event.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-default-language" className="label-text">{t('adminSettings.language')}</label>
          <input id="admin-default-language" value={settings.default_language} onChange={(event) => update('default_language', event.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-jwt-expiration" className="label-text">{t('adminSettings.jwtExpiration')}</label>
          <input id="admin-jwt-expiration" type="number" value={settings.jwt_expiration_minutes} onChange={(event) => update('jwt_expiration_minutes', Number(event.target.value))} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-smtp-host" className="label-text">SMTP host</label>
          <input id="admin-smtp-host" value={settings.smtp_host} onChange={(event) => update('smtp_host', event.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-smtp-port" className="label-text">SMTP port</label>
          <input id="admin-smtp-port" type="number" value={settings.smtp_port} onChange={(event) => update('smtp_port', Number(event.target.value))} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-smtp-username" className="label-text">SMTP username</label>
          <input id="admin-smtp-username" value={settings.smtp_username} onChange={(event) => update('smtp_username', event.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-smtp-password" className="label-text">SMTP password</label>
          <input id="admin-smtp-password" type="password" autoComplete="new-password" value={settings.smtp_password} onChange={(event) => update('smtp_password', event.target.value)} className="input-field" />
        </div>
        <div>
          <label htmlFor="admin-smtp-from" className="label-text">SMTP sender email</label>
          <input id="admin-smtp-from" type="email" value={settings.smtp_from_email} onChange={(event) => update('smtp_from_email', event.target.value)} className="input-field" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.enforce_mfa} onChange={(event) => update('enforce_mfa', event.target.checked)} className="h-4 w-4 accent-primary-600" />
        <ShieldCheck className="h-4 w-4" />
        {t('adminSettings.enforceMfa')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.smtp_use_tls} onChange={(event) => update('smtp_use_tls', event.target.checked)} className="h-4 w-4 accent-primary-600" />
        Use STARTTLS
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        {storageCard('/uploads/videos', storage?.videos ?? { bytes: 0, files: 0 })}
        {storageCard('/uploads/attachments', storage?.attachments ?? { bytes: 0, files: 0 })}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void cleanup()} className="btn-secondary">
          <Trash2 className="h-4 w-4" />{t('adminSettings.runStorageCleanup')}
        </button>
        <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={t('adminSettings.testEmailRecipient')} aria-label={t('adminSettings.testEmailRecipient')} className="input-field max-w-xs" />
        <button type="button" disabled={busy} onClick={() => void testEmail()} className="btn-secondary">
          <Mail className="h-4 w-4" />{t('adminSettings.sendTestEmail')}
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className="btn-primary">
          <Save className="h-4 w-4" />{t('adminSettings.saveNewSettings')}
        </button>
      </div>
    </section>
  );
}