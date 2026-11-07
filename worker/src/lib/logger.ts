/**
 * Worker logger — respects LOG_LEVEL to stay under Railway's 500 logs/sec per replica.
 * Set LOG_LEVEL=debug for verbose logs in development; default 'warn' in production.
 */
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function currentLevel(): Level {
  const env = (process.env.LOG_LEVEL || 'warn').toLowerCase();
  return LEVELS.includes(env as Level) ? (env as Level) : 'warn';
}

const levelIndex = (l: Level) => LEVELS.indexOf(l);
let _level: number = levelIndex(currentLevel());

export function setLogLevel(level: Level): void {
  _level = levelIndex(level);
}

function shouldLog(level: Level): boolean {
  return levelIndex(level) >= _level;
}

function emit(level: Level, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn.apply(console, args);
}

export const logger = {
  debug(...args: unknown[]) {
    emit('debug', args);
  },
  info(...args: unknown[]) {
    emit('info', args);
  },
  warn(...args: unknown[]) {
    emit('warn', args);
  },
  error(...args: unknown[]) {
    emit('error', args);
  },
};
