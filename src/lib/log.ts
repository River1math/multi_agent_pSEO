export interface Logger {
  info(scope: string, message: string): void;
  warn(scope: string, message: string): void;
}

export const silentLogger: Logger = { info() {}, warn() {} };

export function consoleLogger(startedAt = Date.now()): Logger {
  const stamp = () => `+${((Date.now() - startedAt) / 1000).toFixed(2).padStart(6)}s`;
  return {
    info: (scope, message) => console.log(`${stamp()}  ${scope.padEnd(38)} ${message}`),
    warn: (scope, message) => console.log(`${stamp()}  ${scope.padEnd(38)} ⚠ ${message}`),
  };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Serializes async critical sections within one process. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
