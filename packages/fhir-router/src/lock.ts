import { OperationOutcomeError, conflict, sleep } from '@medplum/core';

export interface Locker {
  lock<T>(resources: string[], fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

export class InMemoryLocker implements Locker {
  private locks = new Map<string, boolean>();
  private readonly maxAttempts = 10;

  async lock<T>(resources: string[], fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    await this.acquireLocks(resources);

    try {
      return await fn(new AbortController().signal);
    } finally {
      await this.releaseLocks(resources);
    }
  }

  private async acquireLocks(keys: string[]): Promise<void> {
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (attempts++ > this.maxAttempts) {
        throw new OperationOutcomeError(conflict('Failed to acquire lock'));
      }

      let anyLocked = false;
      for (const key of keys) {
        if (this.locks.has(key)) {
          anyLocked = true;
          break;
        }
      }

      if (anyLocked) {
        await sleep(100);
        continue;
      }

      break;
    }

    for (const key of keys) {
      this.locks.set(key, true);
    }
  }

  private async releaseLocks(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.locks.delete(key);
    }
  }
}

export class NopLocker implements Locker {
  async lock<T>(resources: string[], fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return fn(new AbortController().signal);
  }
}
