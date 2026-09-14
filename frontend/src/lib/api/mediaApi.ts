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
  const targetUrl = resolveApiUrl('/api/media/upload');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', kind);

  console.log('Uploading media:', {
    url: targetUrl,
    fileName: file.name,
    fileSize: file.size,
    kind,
    mimeType: file.type,
  });

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

    xhr.open('POST', targetUrl);

    const bearerToken = (() => {
      try {
        return window.localStorage.getItem('access_token')
          ?? window.sessionStorage.getItem('access_token')
          ?? window.sessionStorage.getItem('learnflow_session_token')
          ?? '';
      } catch {
        return '';
      }
    })();
    if (bearerToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${bearerToken}`);
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(xhr.responseText) as { success?: boolean; data?: { url?: string; error?: string } };
          if (!payload.success || !payload.data?.url) {
            throw new Error(payload.data?.error || 'Upload response missing URL.');
          }

          console.log('Media upload complete:', { url: payload.data.url, status: xhr.status });
          resolve(payload.data.url);
          return;
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Upload failed.');
          console.error('Upload parse error:', err);
          reject(err);
          return;
        }
      }

      try {
        const payload = JSON.parse(xhr.responseText) as { error?: string };
        const message = payload.error || 'Unable to upload media.';
        console.error('Upload failed with server response:', { status: xhr.status, responseText: xhr.responseText, message });
        reject(new Error(message));
      } catch {
        const message = `Unable to upload media. Status: ${xhr.status}`;
        console.error('Upload failed without JSON payload:', { status: xhr.status, responseText: xhr.responseText, message });
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => {
      console.error('Network error during media upload:', { url: targetUrl, status: xhr.status, readyState: xhr.readyState });
      reject(new Error('Unable to upload media.'));
    });

    xhr.addEventListener('abort', () => {
      console.warn('Media upload aborted:', { url: targetUrl });
      reject(new DOMException('Upload aborted', 'AbortError'));
    });

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
