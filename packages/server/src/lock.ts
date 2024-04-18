import { OperationOutcomeError, conflict, serverError } from '@medplum/core';
import { Locker } from '@medplum/fhir-router';
import Redlock, { ExecutionError } from 'redlock';

export class RedlockLocker implements Locker {
  constructor(
    private readonly redlock: Redlock,
    private readonly namespace: string
  ) {}

  async lock<T>(resources: string[], fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      const result = await this.redlock.using(
        resources.map((r) => `${this.namespace}${r}`),
        1000,
        fn
      );
      return result;
    } catch (e) {
      if (e instanceof ExecutionError) {
        if (e.message.includes('The operation was unable to achieve a quorum during its retry window')) {
          throw new OperationOutcomeError(conflict('unable to acquire lock'));
        } else {
          throw new OperationOutcomeError(serverError(e));
        }
      }

      throw e;
    }
  }
}
