export type AiProvider = 'OpenAI' | 'Gemini' | 'Ollama' | 'HuggingFace' | 'Custom';

export type AdminAiModel = {
  id: string;
  name: string;
  provider: AiProvider;
  model_id: string;
  is_active: boolean;
  api_endpoint?: string | null;
  system_prompt?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  api_key_masked?: string | null;
};

export type AiHealth = {
  status: 'Online' | 'Offline' | 'Degraded';
  latency_ms: number;
  uptime_percent: number;
  service: string;
  models: string[];
  error?: string;
};

export type AiUsage = {
  total_tokens: number;
  daily_prompts: number;
  most_active_users: Array<{ student_id: string; prompt_count: number }>;
  estimated_cost: number;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem('learnflow_session_token');
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === 'object' ? payload.detail?.error : payload.detail;
    throw new Error(payload.error ?? detail ?? 'AI administration request failed.');
  }
  return (payload.data ?? payload) as T;
}

export function fetchAdminAiModels() { return request<AdminAiModel[]>('/api/admin/ai/models'); }
export function fetchAiHealth() { return request<AiHealth>('/api/ai/health'); }
export function fetchAiUsage() { return request<AiUsage>('/api/admin/ai/usage'); }
export function testAiConnection(provider: AiProvider, apiKey: string, apiEndpoint?: string | null) { return request<{ valid: boolean; latency_ms: number }>('/api/admin/ai/test-connection', { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey, api_endpoint: apiEndpoint }) }); }
export function saveAdminAiModel(model: AdminAiModel, apiKey: string) { return request<AdminAiModel>('/api/admin/ai/models', { method: 'PUT', body: JSON.stringify({ ...model, api_key: apiKey }) }); }