import { Logger, LogLevel } from "@/utils/logger/index.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";

export const LOG_LEVEL = loadOptionalEnv("LOG_LEVEL") as keyof typeof LogLevel;

let LOG: Logger;

if (LOG_LEVEL !== undefined && LOG_LEVEL in LogLevel) {
  LOG = new Logger(LogLevel[LOG_LEVEL]);
} else {
  LOG = new Logger(LogLevel.INFO);

  LOG.warn(
    `LOG_LEVEL is not set or invalid. Defaulting to INFO. Received: ${LOG_LEVEL}`
  );
}

LOG = new Logger(LogLevel[LOG_LEVEL]);

LOG.debug("Logger initialized with level:", LOG_LEVEL);

export { LOG };
