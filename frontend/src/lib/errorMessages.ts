type SupportedLanguage = 'ar' | 'en';

function getLanguage(): SupportedLanguage {
  if (typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('ar')) {
    return 'ar';
  }

  if (typeof window !== 'undefined' && window.localStorage.getItem('learnflow-language') === 'ar') {
    return 'ar';
  }

  return 'en';
}

const messages = {
  en: {
    requestCancelled: 'The request was cancelled. Please try again.',
    requestTimedOut: 'The request took too long. Please check your connection and try again.',
    networkError: 'Unable to connect to the server. Please check your connection and try again.',
    authRequestFailed: 'Authentication request failed. Please try again.',
    invalidCredentials: 'Invalid email or password.',
    accountExists: 'An account with that email already exists.',
    passwordTooShort: 'Password must be at least 6 characters.',
    genericRequestFailure: 'The request could not be completed. Please try again.',
    accessDenied: 'Access denied. Redirecting to your authorized dashboard.',
  },
  ar: {
    requestCancelled: 'تم إلغاء الطلب. حاول مرة أخرى.',
    requestTimedOut: 'استغرق الطلب وقتًا طويلًا. تحقق من الاتصال وحاول مرة أخرى.',
    networkError: 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.',
    authRequestFailed: 'فشل طلب المصادقة. حاول مرة أخرى.',
    invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    accountExists: 'يوجد حساب بهذا البريد الإلكتروني بالفعل.',
    passwordTooShort: 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.',
    genericRequestFailure: 'تعذر إكمال الطلب. حاول مرة أخرى.',
    accessDenied: 'ليس لديك صلاحية الوصول. سيتم تحويلك إلى لوحة التحكم المسموح بها.',
  },
} as const;

export function localizedRuntimeError(error: unknown, fallback?: string): string {
  const language = getLanguage();
  const copy = messages[language];
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('signal is aborted')) return copy.requestTimedOut;
  if (normalized.includes('abort') || normalized.includes('cancel')) return copy.requestCancelled;
  if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('network error')) return copy.networkError;
  if (normalized.includes('invalid email or password')) return copy.invalidCredentials;
  if (normalized.includes('already exists') || normalized.includes('already registered')) return copy.accountExists;
  if (normalized.includes('access denied')) return copy.accessDenied;
  if (normalized.includes('password') && (normalized.includes('6') || normalized.includes('short'))) return copy.passwordTooShort;
  if (normalized.includes('unable to') || normalized.includes('request failed') || normalized.includes('failed to')) return copy.genericRequestFailure;

  if (fallback && language === 'ar' && /[a-z]/i.test(fallback)) {
    return copy.genericRequestFailure;
  }

  return fallback ?? (language === 'ar' && /[a-z]/i.test(rawMessage) ? copy.genericRequestFailure : rawMessage || copy.authRequestFailed);
}