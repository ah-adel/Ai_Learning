export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  message?: string;
};

export type ApiErrorResponse = {
  success: false;
  error: string;
  details?: unknown;
};

export type MediaUploadKind = 'video' | 'attachment';

export type MediaUploadResult = {
  url: string;
  folder: 'videos' | 'attachments';
  type: MediaUploadKind;
  fileName: string;
  originalName: string;
};

export type DeleteCleanupResult = {
  entityId: string | null;
  deletedFiles: string[];
  purgedCollections: string[];
  errors: Array<{ message: string; path?: string }>;
};

const readBearerToken = () => {
  try {
    const localToken = window.localStorage.getItem('access_token') ?? window.localStorage.getItem('token');
    if (localToken) return localToken;
    const sessionToken = window.sessionStorage.getItem('access_token')
      ?? window.sessionStorage.getItem('token')
      ?? window.sessionStorage.getItem('learnflow_session_token');
    return sessionToken ?? '';
  } catch {
    return '';
  }
};

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({} as Partial<ApiSuccessResponse<T> & ApiErrorResponse>));

  if (response.ok && payload.success !== false) {
    return (payload.data ?? (payload as T)) as T;
  }

  const errorMessage = typeof payload.error === 'string' && payload.error.length > 0
    ? payload.error
    : `Request failed with status ${response.status}`;

  throw new Error(errorMessage);
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  return parseApiResponse<T>(response);
}

export async function uploadMediaFile(
  file: File,
  kind: MediaUploadKind,
  options?: {
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const targetUrl = `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/media/upload`;
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

    const authToken = readBearerToken();
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(xhr.responseText) as Partial<ApiSuccessResponse<MediaUploadResult>> & Partial<ApiErrorResponse> & Partial<MediaUploadResult>;
          const uploadData = payload.data ?? payload;
          const nextUrl = typeof uploadData?.url === 'string' ? uploadData.url : null;

          if (!nextUrl) {
            const errorMessage = typeof payload.error === 'string' && payload.error.length > 0
              ? payload.error
              : 'Upload response missing URL.';
            throw new Error(errorMessage);
          }

          console.log('Media upload complete:', { url: nextUrl, status: xhr.status });
          resolve(nextUrl);
          return;
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Upload failed.');
          console.error('Upload parse error:', err);
          reject(err);
          return;
        }
      }

      try {
        const payload = JSON.parse(xhr.responseText) as Partial<ApiErrorResponse>;
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

export async function deleteEntityCleanupApi(entity: Record<string, unknown> | null): Promise<DeleteCleanupResult> {
  if (!entity) {
    return {
      entityId: null,
      deletedFiles: [],
      purgedCollections: [],
      errors: [],
    };
  }

  const endpoints = ['/api/media/delete', '/api/delete-entity'];
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await apiRequest<DeleteCleanupResult>(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entity }),
      });

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Delete cleanup failed.');
    }
  }

  throw lastError ?? new Error('Delete cleanup failed.');
}

export async function fetchExternalVideoDuration(videoUrl: string): Promise<number> {
  const trimmedUrl = videoUrl.trim();
  if (!trimmedUrl) {
    return 0;
  }

  try {
    const url = new URL(trimmedUrl);
    const hostname = url.hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      const html = await fetch(trimmedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then((response) => response.text())
        .catch(() => '');

      const youtubeMatch = html.match(/"lengthSeconds":"?(\d+)"?/i)
        ?? html.match(/"approxDurationMs":"?(\d+)"?/i)
        ?? html.match(/length_seconds=(\d+)/i);

      if (youtubeMatch?.[1]) {
        const seconds = Number(youtubeMatch[1]);
        if (Number.isFinite(seconds) && seconds > 0) {
          return Math.round(seconds / (youtubeMatch[0].includes('approxDurationMs') ? 1000 : 1));
        }
      }
    }

    if (hostname.includes('vimeo.com')) {
      const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(trimmedUrl)}`);
      if (response.ok) {
        const payload = await response.json() as { duration?: number };
        if (typeof payload.duration === 'number' && Number.isFinite(payload.duration) && payload.duration > 0) {
          return Math.round(payload.duration);
        }
      }
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return await new Promise<number>((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';
        video.src = trimmedUrl;

        video.onloadedmetadata = () => {
          const duration = Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : 0;
          resolve(duration);
        };

        video.onerror = () => resolve(0);
      });
    }
  } catch {
    return 0;
  }

  return 0;
}
