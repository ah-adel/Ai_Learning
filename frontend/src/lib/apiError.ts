import { localizedRuntimeError } from '@/lib/errorMessages';

type ValidationDetail = { loc?: unknown[]; field?: string; msg?: string; message?: string };

export function extractApiErrorMessage(payload: unknown, status?: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
    const detail = record.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const detailRecord = detail as Record<string, unknown>;
      if (typeof detailRecord.error === 'string' && detailRecord.error.trim()) return detailRecord.error;
      if (typeof detailRecord.message === 'string' && detailRecord.message.trim()) return detailRecord.message;
    }
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => {
        if (!item || typeof item !== 'object') return '';
        const issue = item as ValidationDetail;
        const field = issue.field ?? issue.loc?.filter((part) => !['body', 'query', 'path'].includes(String(part))).join('.');
        const message = issue.message ?? issue.msg;
        if (!message) return '';
        return field ? `${field}: ${message}` : message;
      }).filter(Boolean);
      if (messages.length) return messages.join('; ');
    }
  }
  return `Request failed${status ? ` (${status})` : ''}.`;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (/failed to fetch|networkerror|network error|timeout|aborted/i.test(error.message)) {
    return localizedRuntimeError(error, fallback);
  }
  return error.message || fallback;
}