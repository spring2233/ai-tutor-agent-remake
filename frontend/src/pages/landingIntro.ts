export const LANDING_INTRO_KEY = 'ai-tutor-landing-intro';

export function markEntered() {
  try {
    sessionStorage.setItem(LANDING_INTRO_KEY, '1');
  } catch {
    /* ignore */
  }
}
