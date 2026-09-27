import { useState, type FormEvent } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth, type MfaChallenge } from '@/context/AuthContext';
import { useTranslation } from '@/context/I18nContext';

type MfaChallengeFormProps = {
  challenge: MfaChallenge;
  onCancel?: () => void;
};

export function MfaChallengeForm({ challenge, onCancel }: MfaChallengeFormProps) {
  const { completeMfa } = useAuth();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await completeMfa(challenge.challengeToken, code);
    if (result.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {challenge.setupRequired ? t('auth.mfaSetupInstructions') : t('auth.mfaCodeInstructions')}
        </p>
      </div>

      {challenge.setupRequired && challenge.secret && (
        <div className="space-y-2">
          <label className="label-text" htmlFor="mfa-secret">{t('auth.mfaManualKey')}</label>
          <code id="mfa-secret" className="block select-all break-all rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
            {challenge.secret}
          </code>
          {challenge.otpauthUrl && (
            <a className="text-sm font-medium text-primary-600 hover:text-primary-700" href={challenge.otpauthUrl}>
              {t('auth.mfaOpenAuthenticator')}
            </a>
          )}
        </div>
      )}

      <div>
        <label className="label-text" htmlFor="mfa-code">{t('auth.mfaCode')}</label>
        <input
          id="mfa-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className="input-field text-center font-mono text-lg"
          autoFocus
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-950/40 dark:text-error-300" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full">
        {loading ? t('auth.mfaVerifying') : t('auth.mfaVerify')}
      </button>
      {onCancel && (
        <button type="button" disabled={loading} onClick={onCancel} className="btn-secondary w-full">
          {t('common.cancel')}
        </button>
      )}
    </form>
  );
}