
export const isBrowserEnv = typeof window !== 'undefined' && typeof window.document !== 'undefined';
export function shuffleArray(array = []) { return array.sort(() => Math.random() - 0.5); }