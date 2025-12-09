import { LOG } from "@/config/logger.ts";

export function logAndThrow(error: Error): never {
  LOG.error(error.message, { error });
  throw error;
}
