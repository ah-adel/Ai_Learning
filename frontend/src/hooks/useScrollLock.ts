import { useEffect } from 'react';

export function useScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked || typeof document === 'undefined') {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('scroll-locked');
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.classList.remove('scroll-locked');
      document.body.style.overflow = previousOverflow;
    };
  }, [isLocked]);
}
