import express from 'express';
import { initApp, shutdownApp } from './app';
import { loadConfig } from './config';
import { globalLogger, parseLogLevel } from './logger';
import gracefulShutdown from 'http-graceful-shutdown';

export async function main(configName: string): Promise<void> {
  process.on('unhandledRejection', (err: any) => {
    globalLogger.error('Unhandled promise rejection', err);
  });
  process.on('uncaughtException', (err) => {
    globalLogger.error('Uncaught exception thrown', err);
    process.exit(1);
  });

  globalLogger.info('Starting Medplum Server...', { configName });
  const config = await loadConfig(configName);
  if (config.logLevel) {
    globalLogger.level = parseLogLevel(config.logLevel);
  }

  const app = await initApp(express(), config);
  const server = app.listen(config.port);
  server.keepAliveTimeout = config.keepAliveTimeout ?? 90000;
  globalLogger.info('Server started', { port: config.port });
  gracefulShutdown(server, {
    preShutdown: async (signal) => {
      globalLogger.info('Shutdown signal received', { signal });
    },
    onShutdown: () => shutdownApp(),
    timeout: config.shutdownTimeoutMilliseconds,
  });
}

if (require.main === module) {
  main(process.argv.length === 3 ? process.argv[2] : 'file:medplum.config.json').catch(console.log);
}
