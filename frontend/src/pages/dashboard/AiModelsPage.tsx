import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  KeyRound,
  Plus,
  Power,
  ServerCog,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { readLocalAiModels, writeLocalAiModels, type LocalAiModelRecord } from '@/lib/localDb';
import { AdminAiEnhancements } from '@/components/dashboard/AdminAiEnhancements';
import { useTranslation } from '@/context/I18nContext';

const emptyModel = (): LocalAiModelRecord => ({
  id: crypto.randomUUID(),
  name: 'New model',
  provider: 'Custom',
  modelId: 'custom-model',
  apiKey: '',
  apiEndpoint: 'https://api.example.com/v1',
  systemPrompt: 'You are a helpful platform assistant.',
  temperature: 0.5,
  maxTokens: 1600,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export function AiModelsPage() {
  const { t } = useTranslation();
  const [models, setModels] = useState<LocalAiModelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLoading(true);
      setError(null);
      setModels(readLocalAiModels());
    } catch (loadError) {
      console.error('Failed to load AI model configs:', loadError);
      setError(t('ai.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  const updateModel = <K extends keyof LocalAiModelRecord>(id: string, key: K, value: LocalAiModelRecord[K]) => {
    setModels((current) =>
      current.map((model) =>
        model.id === id ? { ...model, [key]: value, updatedAt: new Date().toISOString() } : model,
      ),
    );
  };

  const saveModels = () => {
    try {
      setError(null);
      writeLocalAiModels(models);
      setSaved(t('ai.saved'));
    } catch (saveError) {
      console.error('Failed to save AI model configs:', saveError);
      setSaved(null);
      setError(t('ai.saveError'));
    }
  };

  const addModel = () => {
    setModels((current) => [...current, emptyModel()]);
  };

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          {t('ai.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
            {t('dashboard.modelConfiguration')}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t('dashboard.aiModels')}</h1>
        </div>

        <button type="button" onClick={addModel} className="btn-secondary">
          <Plus className="h-4 w-4" />
          {t('ai.addModel')}
        </button>
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

      <div className="grid gap-5 xl:grid-cols-2">
        {models.map((model) => (
          <div key={model.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-primary-600 dark:text-primary-300">
                  <Bot className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-[0.14em]">{model.provider}</span>
                </div>
                <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{model.name}</h2>
              </div>

              <button
                type="button"
                onClick={() => updateModel(model.id, 'isActive', !model.isActive)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  model.isActive
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                {model.isActive ? t('ai.enabled') : t('ai.disabled')}
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label-text">{t('ai.modelName')}</label>
                  <input
                    value={model.name}
                    onChange={(event) => updateModel(model.id, 'name', event.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="label-text">{t('ai.provider')}</label>
                  <input
                    value={model.provider}
                    onChange={(event) => updateModel(model.id, 'provider', event.target.value)}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="label-text">{t('ai.modelId')}</label>
                <input
                  value={model.modelId}
                  onChange={(event) => updateModel(model.id, 'modelId', event.target.value)}
                  className="input-field"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label-text">{t('ai.apiKey')}</label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      value={model.apiKey}
                      onChange={(event) => updateModel(model.id, 'apiKey', event.target.value)}
                      className="input-field pl-10"
                      placeholder={t('ai.apiKeyPlaceholder')}
                    />
                  </div>
                </div>
                <div>
                  <label className="label-text">{t('ai.apiEndpoint')}</label>
                  <input
                    value={model.apiEndpoint}
                    onChange={(event) => updateModel(model.id, 'apiEndpoint', event.target.value)}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="label-text">{t('ai.systemPrompt')}</label>
                <textarea
                  rows={4}
                  value={model.systemPrompt}
                  onChange={(event) => updateModel(model.id, 'systemPrompt', event.target.value)}
                  className="input-field resize-none"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                    <span className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      {t('ai.temperature')}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">{model.temperature.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={model.temperature}
                    onChange={(event) => updateModel(model.id, 'temperature', Number(event.target.value))}
                    className="w-full accent-primary-600"
                  />
                </div>

                <div>
                  <label className="label-text">{t('ai.maxTokens')}</label>
                  <input
                    type="number"
                    min={100}
                    max={32000}
                    step={50}
                    value={model.maxTokens}
                    onChange={(event) => updateModel(model.id, 'maxTokens', Number(event.target.value) || 100)}
                    className="input-field"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={saveModels} className="btn-primary">
          <ServerCog className="h-4 w-4" />
          {t('common.saveChanges')}
        </button>
      </div>

      <AdminAiEnhancements />
    </div>
  );
}
