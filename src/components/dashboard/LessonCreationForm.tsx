import { useState } from 'react';

type LessonMediaKind = 'video' | 'attachment';

export function buildPublicUploadPath(fileName: string, kind: LessonMediaKind) {
  const safeName = (fileName ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  const normalizedName = safeName || `${kind}-${Date.now()}.bin`;
  const basePath = kind === 'video' ? '/uploads/videos' : '/uploads/attachments';
  return `${basePath}/${normalizedName}`;
}

const isAllowedMimeType = (kind: LessonMediaKind, file: File) => {
  if (kind === 'video') {
    return file.type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(file.name);
  }

  return (
    file.type.startsWith('application/') ||
    file.type.startsWith('image/') ||
    /\.(pdf|doc|docx|ppt|pptx|txt|png|jpg|jpeg)$/i.test(file.name)
  );
};

type LessonCreationFormProps = {
  onSave?: (lesson: { videoUrl?: string | null; attachmentUrl?: string | null }) => void;
};

export function LessonCreationForm({ onSave }: LessonCreationFormProps) {
  const [videoError, setVideoError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);

  const handleFileSelection = (kind: LessonMediaKind, file: File | null | undefined) => {
    if (!file) return;

    if (!isAllowedMimeType(kind, file)) {
      if (kind === 'video') {
        setVideoError('Only video files are allowed for lesson videos.');
      } else {
        setAttachmentError('Unsupported attachment type. Please choose a document or image file.');
      }
      return;
    }

    const hostedPath = buildPublicUploadPath(file.name, kind);
    if (kind === 'video') {
      setVideoUrl(hostedPath);
      setVideoError(null);
    } else {
      setAttachmentUrl(hostedPath);
      setAttachmentError(null);
    }

    onSave?.({
      videoUrl: kind === 'video' ? hostedPath : videoUrl,
      attachmentUrl: kind === 'attachment' ? hostedPath : attachmentUrl,
    });
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-700 dark:text-gray-200">
        <span className="mb-1 block font-medium">Lesson video</span>
        <input
          type="file"
          accept="video/*,.mp4,.webm,.ogg,.mov"
          onChange={(event) => handleFileSelection('video', event.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary-600 file:px-3 file:py-1.5 file:text-white"
        />
      </label>
      {videoError && <p className="text-xs text-red-600">{videoError}</p>}
      {videoUrl && <p className="text-xs text-emerald-600">Stored at {videoUrl}</p>}

      <label className="block text-sm text-gray-700 dark:text-gray-200">
        <span className="mb-1 block font-medium">Lesson attachment</span>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg"
          onChange={(event) => handleFileSelection('attachment', event.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-white"
        />
      </label>
      {attachmentError && <p className="text-xs text-red-600">{attachmentError}</p>}
      {attachmentUrl && <p className="text-xs text-emerald-600">Stored at {attachmentUrl}</p>}
    </div>
  );
}
