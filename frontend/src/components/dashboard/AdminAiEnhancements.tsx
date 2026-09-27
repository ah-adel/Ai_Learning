import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, Save, WifiOff } from 'lucide-react';
import {
  fetchAdminAiModels,
  fetchAiHealth,
  fetchAiUsage,
  saveAdminAiModel,
  testAiConnection,
  type AdminAiModel,
  type AiHealth,
  type AiProvider,
  type AiUsage,
} from '@/lib/adminAiRepository';
import { useTranslation } from '@/context/I18nContext';

const providers: AiProvider[] = ['OpenAI', 'Gemini', 'Ollama', 'HuggingFace', 'Custom'];
type Draft = AdminAiModel & { api_key: string; tested: boolean };

export function AdminAiEnhancements() {
  const { t, formatNumber, formatCurrency } = useTranslation();
  const [models, setModels] = useState<Draft[]>([]);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [nextModels, nextHealth, nextUsage] = await Promise.all([
        fetchAdminAiModels(),
        fetchAiHealth(),
        fetchAiUsage(),
      ]);
      setModels(nextModels.map((model) => ({ ...model, api_key: '', tested: false })));
      setHealth(nextHealth);
      setUsage(nextUsage);
    } catch (reason: unknown) {
      console.error('Unable to load AI telemetry:', reason);
      setError(t('adminAi.loadError'));
    }
  };

  useEffect(() => {
    void load();
  }, [t]);

  const update = <K extends keyof Draft>(id: string, key: K, value: Draft[K]) => {
    setModels((current) => current.map((model) =>
      model.id === id
        ? { ...model, [key]: value, tested: key === 'api_key' || key === 'api_endpoint' ? false : model.tested }
        : model,
    ));
  };

  const test = async (model: Draft) => {
    setError(null);
    setNotice(null);
    try {
      await testAiConnection(model.provider, model.api_key, model.api_endpoint);
      update(model.id, 'tested', true);
      setNotice(t('adminAi.connectionVerified'));
    } catch (reason: unknown) {
      console.error('AI provider connection test failed:', reason);
      setError(t('adminAi.connectionError'));
    }
  };

  const save = async (model: Draft) => {
    if (!model.tested) {
      setError(t('adminAi.testBeforeSave'));
      return;
    }

    setError(null);
    setNotice(null);
    try {
      const saved = await saveAdminAiModel(model, model.api_key);
      setModels((current) => current.map((entry) => entry.id === model.id
        ? { ...saved, api_key: '', tested: true }
        : { ...entry, is_active: saved.is_active ? false : entry.is_active },
      ));
      setNotice(t('adminAi.settingsSaved'));
    } catch (reason: unknown) {
      console.error('Failed to save AI provider settings:', reason);
      setError(t('adminAi.saveError'));
    }
  };

  const healthLabel = () => {
    const normalized = health?.status?.toLowerCase();
    if (normalized === 'healthy' || normalized === 'online') return t('adminAi.healthy');
    if (normalized === 'degraded') return t('adminAi.degraded');
    if (normalized === 'offline' || normalized === 'unavailable') return t('adminAi.offline');
    return t('common.unknown');
  };

  return (
    <section className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-primary-600">{t('adminAi.liveInfrastructure')}</p>
          <h2 className="text-lg font-semibold">{t('adminAi.healthProvidersUsage')}</h2>
        </div>
        <button type="button" onClick={() => void load()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" />
          {t('common.refresh')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-600" role="status">{notice}</p>}

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <p className="text-xs text-gray-500">{t('adminAi.serviceStatus')}</p>
          <p className="text-xl font-bold">{healthLabel()}</p>
          <p className="text-sm text-gray-500">
            {t('adminAi.latencyUptime', {
              latency: formatNumber(health?.latency_ms ?? 0),
              uptime: formatNumber(health?.uptime_percent ?? 0),
            })}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{t('adminAi.totalTokens')}</p>
          <p className="text-xl font-bold">{formatNumber(usage?.total_tokens ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{t('adminAi.dailyPrompts')}</p>
          <p className="text-xl font-bold">{formatNumber(usage?.daily_prompts ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{t('adminAi.estimatedCost')}</p>
          <p className="text-xl font-bold">{formatCurrency(usage?.estimated_cost ?? 0, 'USD')}</p>
        </div>
      </div>

      <div className="space-y-4">
        {models.map((model) => (
          <div key={model.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="sr-only" htmlFor={`provider-${model.id}`}>{t('ai.provider')}</label>
              <select id={`provider-${model.id}`} value={model.provider} onChange={(event) => update(model.id, 'provider', event.target.value as AiProvider)} className="input-field">
                {providers.map((provider) => <option key={provider}>{provider}</option>)}
              </select>

              <label className="sr-only" htmlFor={`model-${model.id}`}>{t('ai.modelId')}</label>
              <input id={`model-${model.id}`} value={model.model_id} onChange={(event) => update(model.id, 'model_id', event.target.value)} className="input-field" placeholder={t('ai.modelId')} />

              <label className="sr-only" htmlFor={`api-key-${model.id}`}>{t('ai.apiKey')}</label>
              <input id={`api-key-${model.id}`} type="password" value={model.api_key} onChange={(event) => update(model.id, 'api_key', event.target.value)} className="input-field" placeholder={model.api_key_masked ?? t('ai.apiKey')} autoComplete="new-password" />

              <div className="flex gap-2">
                <button type="button" onClick={() => void test(model)} className="btn-secondary" title={t('adminAi.testConnection')} aria-label={t('adminAi.testConnection')}>
                  {model.tested ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <WifiOff className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => void save(model)} className="btn-primary" title={t('adminAi.saveProvider')} aria-label={t('adminAi.saveProvider')}>
                  <Save className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {models.length === 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700">
            <Activity className="h-4 w-4" />
            {t('adminAi.noProviders')}
          </div>
        )}
      </div>
    </section>
  );
}