import { LogLevel, Logger, ProfileResource, isUUID } from '@medplum/core';
import { Login, Project, ProjectMembership, Reference } from '@medplum/fhirtypes';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Repository, systemRepo } from './fhir/repo';

export class RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly logger: Logger;

  constructor(requestId: string, traceId: string, logger?: Logger) {
    this.requestId = requestId;
    this.traceId = traceId;
    this.logger =
      logger ??
      new Logger(write, { requestId, traceId }, process.env.NODE_ENV === 'test' ? LogLevel.ERROR : LogLevel.INFO);
  }

  close(): void {
    // No-op, descendants may override
  }

  static empty(): RequestContext {
    return new RequestContext('', '');
  }
}

export class AuthenticatedRequestContext extends RequestContext {
  readonly repo: Repository;
  readonly project: Project;
  readonly membership: ProjectMembership;
  readonly login: Login;
  readonly profile: Reference<ProfileResource>;
  readonly accessToken?: string;

  constructor(
    ctx: RequestContext,
    login: Login,
    project: Project,
    membership: ProjectMembership,
    repo: Repository,
    logger?: Logger,
    accessToken?: string
  ) {
    super(ctx.requestId, ctx.traceId, logger);

    this.repo = repo;
    this.project = project;
    this.membership = membership;
    this.login = login;
    this.profile = membership.profile as Reference<ProfileResource>;
    this.accessToken = accessToken;
  }

  close(): void {
    this.repo.close();
  }

  static system(): AuthenticatedRequestContext {
    const systemLogger = new Logger(write, undefined, LogLevel.ERROR);
    return new AuthenticatedRequestContext(
      new RequestContext('', ''),
      {} as unknown as Login,
      {} as unknown as Project,
      {} as unknown as ProjectMembership,
      systemRepo,
      systemLogger
    );
  }
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  const ctx = requestContextStore.getStore();
  if (!ctx) {
    throw new Error('No request context available');
  }
  return ctx;
}

export function getAuthenticatedContext(): AuthenticatedRequestContext {
  const ctx = getRequestContext();
  if (!(ctx instanceof AuthenticatedRequestContext)) {
    throw new Error('Request is not authenticated');
  }
  return ctx;
}

export async function attachRequestContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { requestId, traceId } = requestIds(req);
  requestContextStore.run(new RequestContext(requestId, traceId), () => next());
}

export function closeRequestContext(): void {
  const ctx = requestContextStore.getStore();
  if (ctx) {
    ctx.close();
  }
}

const traceIdHeaderMap: {
  [key: string]: (traceId: string) => string | false;
} = {
  'x-trace-id': (traceId) => isUUID(traceId) && traceId,
  traceparent: (traceId) => {
    if (!traceId.startsWith('00-')) {
      return false;
    }

    const id = traceId.split('-')[1];
    const uuid = [
      id.substring(0, 8),
      id.substring(8, 12),
      id.substring(12, 16),
      id.substring(16, 20),
      id.substring(20, 32),
    ].join('-');

    return isUUID(uuid) && uuid;
  },
  // https://github.com/getsentry/sentry-javascript/blob/6dfddc2dfc4b74cbb70dc325b4af165e25904ed4/packages/utils/src/tracing.ts#L117-L130
  // {uuidv4}-{uuidv4.substring(16)}[-(0|1)]
  'sentry-trace': (traceId: string) => {
    return (traceId.length === 51 || traceId.length === 49) && traceId;
  },
} as const;
const traceIdHeaders = Object.entries(traceIdHeaderMap);

const getTraceIdHeader = (req: Request): string | undefined => {
  for (const [header, isTraceId] of traceIdHeaders) {
    const traceId = req.header(header);
    if (traceId && isTraceId(traceId)) {
      return traceId;
    }
  }
  return undefined;
};

function requestIds(req: Request): { requestId: string; traceId: string } {
  const requestId = randomUUID();
  const traceId = getTraceIdHeader(req) ?? randomUUID();

  return { requestId, traceId };
}

function write(msg: string): void {
  process.stdout.write(msg + '\n');
}
