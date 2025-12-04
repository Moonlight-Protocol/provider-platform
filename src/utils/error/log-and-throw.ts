import { LOG } from "@/config/logger.ts";

export function logAndThrow(error: Error): never {
  LOG.fatal(error.message, { error });
  throw error;
}
