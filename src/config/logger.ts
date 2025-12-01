import { Logger, LogLevel } from "@/utils/logger/index.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";

export const LOG_LEVEL = (loadOptionalEnv("LOG_LEVEL") ??
  "INFO") as keyof typeof LogLevel;

const LOG = new Logger(LogLevel[LOG_LEVEL]);

LOG.debug("Logger initialized with level:", LOG_LEVEL);

export { LOG };
