import { TelegramAutoPoster } from './bot';
import { ConfigError, loadConfig } from './config';
import { Logger } from './logger';

const DEBUG = ['true', '1', 'yes', 'on'].includes((process.env.DEBUG || '').toLowerCase());

/** Logs a fatal error briefly (full stack only with DEBUG=true) and exits. */
function exitWithError(context: string, error: unknown, bot?: TelegramAutoPoster): never {
  if (error instanceof ConfigError) {
    // Setup problem the user can fix - no stack trace, clean exit
    Logger.error(`Configuration error: ${error.message}`);
    process.exit(0);
  }

  const message = error instanceof Error ? error.message : String(error);
  Logger.error(`${context}: ${message}`, DEBUG ? error : undefined);
  if (!DEBUG) {
    Logger.info('Set DEBUG=true in .env to see the full error details');
  }
  void bot?.stop().catch(() => undefined);
  process.exit(1);
}

async function main(): Promise<void> {
  let bot: TelegramAutoPoster | undefined;
  try {
    const config = loadConfig();
    bot = new TelegramAutoPoster(config);
    const activeBot = bot;

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      Logger.info('Received SIGINT, shutting down gracefully...');
      await activeBot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      Logger.info('Received SIGTERM, shutting down gracefully...');
      await activeBot.stop();
      process.exit(0);
    });

    await bot.start();
  } catch (error) {
    exitWithError('Failed to start', error, bot);
  }
}

main().catch(error => exitWithError('Unexpected error', error));
