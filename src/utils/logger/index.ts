import chalk from "chalk";

export enum LogLevel {
  FATAL = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  TRACE = 5,
}

export class Logger {
  private logLevel: LogLevel;

  constructor(logLevel: LogLevel) {
    this.logLevel = logLevel;
  }

  private format(...args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return chalk.cyan(JSON.stringify(arg));
        } catch (error) {
          return chalk.cyan(`[Unstringifiable: ${(error as Error).message}]`);
        }
      })
      .join(" ");
  }

  private log(level: LogLevel, color: typeof chalk.blue, ...args: unknown[]) {
    if (this.logLevel < level) return;
    const timestamp = new Date().toISOString();
    const prefix = chalk.gray(`[${timestamp}::${LogLevel[level]}]`);
    console.log(`${prefix} ${color(this.format(...args))}`);
  }

  trace(...args: unknown[]) {
    this.log(LogLevel.TRACE, chalk.white, ...args);
  }

  debug(...args: unknown[]) {
    this.log(LogLevel.DEBUG, chalk.green, ...args);
  }

  info(...args: unknown[]) {
    this.log(LogLevel.INFO, chalk.blue, ...args);
  }

  warn(...args: unknown[]) {
    this.log(LogLevel.WARN, chalk.yellow, ...args);
  }

  error(...args: unknown[]) {
    this.log(LogLevel.ERROR, chalk.red, ...args);
  }

  fatal(...args: unknown[]) {
    this.log(LogLevel.FATAL, chalk.bgRed.white, ...args);
  }
}
