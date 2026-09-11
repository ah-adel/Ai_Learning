const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

const resolveApiUrl = (endpoint: string) => {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${normalizedEndpoint}`;
};

export type MediaKind = 'video' | 'attachment';

export async function uploadMediaFile(
  file: File,
  kind: MediaKind,
  options?: {
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', kind);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (options?.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }

      options.signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
      }, { once: true });
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && options?.onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100);
        options.onProgress(progress);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(xhr.responseText) as { success?: boolean; data?: { url?: string; error?: string } };
          if (!payload.success || !payload.data?.url) {
            throw new Error(payload.data?.error || 'Upload response missing URL.');
          }

          resolve(payload.data.url);
          return;
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Upload failed.'));
          return;
        }
      }

      try {
        const payload = JSON.parse(xhr.responseText) as { error?: string };
        reject(new Error(payload.error || 'Unable to upload media.'));
      } catch {
        reject(new Error('Unable to upload media.'));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Unable to upload media.'));
    });

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload aborted', 'AbortError'));
    });

    xhr.open('POST', resolveApiUrl('/api/media/upload'));
    xhr.send(formData);
  });
}

export async function deleteEntity(entity: Record<string, unknown> | null) {
  if (!entity) {
    return { success: true, data: { deletedFiles: [], purgedCollections: [], errors: [] } };
  }

  const response = await fetch(resolveApiUrl('/api/media/delete'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || 'The cleanup request failed.');
  }

  return payload.data ?? payload;
}
