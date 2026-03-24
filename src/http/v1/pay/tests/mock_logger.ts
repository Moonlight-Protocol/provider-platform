/**
 * No-op logger mock for tests.
 *
 * Replaces @/config/logger.ts so that escrow.service.ts can import LOG
 * without needing a .env file or the chalk dependency.
 */

const noop = (..._args: unknown[]) => {};

export const LOG = {
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
};
