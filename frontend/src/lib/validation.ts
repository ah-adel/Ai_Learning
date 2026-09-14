export function sanitizeText(value: string, maxLength = 200): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase().replace(/[\s<>]/g, '');
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validatePassword(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length < 6 || trimmed.length > 128) {
    return 'Password must be between 6 and 128 characters long.';
  }

  return null;
}

export function validateDisplayName(value: string): string | null {
  const sanitized = sanitizeText(value, 80);
  if (sanitized.length < 2) {
    return 'Full name must contain at least 2 characters.';
  }

  return sanitized;
}

export function normalizeSettingsText(value: string, maxLength = 80): string {
  return sanitizeText(value, maxLength);
}
