import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

export interface Config {
  apiId: number;
  apiHash: string;
  postIntervalMinMs: number;
  postIntervalMaxMs: number;
  spamCheckEnabled: boolean;
  spamCheckEveryPosts: number;
  spamRecheckDelayMs: number;
  allowedGroupIds: Set<string>;
  message: string;
}

export const ALLOWLIST_FILE = 'allowlist.txt';
export const GROUPS_LIST_FILE = 'groups.txt';

/** A setup problem the user can fix in .env / config - shown without a stack trace. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = parseInt(raw, 10);
  if (isNaN(value) || value < 0) {
    throw new ConfigError(`${name} must be a non-negative integer (got "${raw}")`);
  }
  return value;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function parseRange(
  minName: string,
  maxName: string,
  minFallback: number,
  maxFallback: number
): [number, number] {
  const min = parseIntEnv(minName, minFallback);
  const max = parseIntEnv(maxName, Math.max(min, maxFallback));
  if (min > max) {
    throw new ConfigError(`${minName} (${min}) must be less than or equal to ${maxName} (${max})`);
  }
  return [min, max];
}

function ensureConfigDirectory(): string {
  const configDir = path.join(process.cwd(), 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

function loadMessageFromFile(): string | null {
  try {
    const configDir = ensureConfigDirectory();
    const messageFile = path.join(configDir, 'message.txt');
    if (fs.existsSync(messageFile)) {
      return fs.readFileSync(messageFile, 'utf-8').trim();
    }
  } catch (error) {
    // Ignore errors, fall back to env var
  }
  return null;
}

/**
 * Reads config/allowlist.txt: one group/channel ID per line.
 * Anything after "#" is a comment, blank lines are ignored.
 */
function loadAllowlist(): Set<string> {
  const ids = new Set<string>();
  const allowlistFile = path.join(ensureConfigDirectory(), ALLOWLIST_FILE);
  if (!fs.existsSync(allowlistFile)) {
    return ids;
  }
  for (const line of fs.readFileSync(allowlistFile, 'utf-8').split(/\r?\n/)) {
    const id = line.split('#')[0].trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export function loadConfig(): Config {
  const apiId = process.env.API_ID;
  const apiHash = process.env.API_HASH;
  // Legacy POST_INTERVAL_MS is used as the default for both ends of the range
  const legacyIntervalMs = parseIntEnv('POST_INTERVAL_MS', 60000);
  const [postIntervalMinMs, postIntervalMaxMs] = parseRange(
    'POST_INTERVAL_MIN_MS',
    'POST_INTERVAL_MAX_MS',
    legacyIntervalMs,
    legacyIntervalMs
  );

  const spamCheckEnabled = parseBoolEnv('SPAMBOT_CHECK_ENABLED', true);
  // Check @SpamBot after this many sent posts
  const spamCheckEveryPosts = parseIntEnv('SPAMBOT_CHECK_EVERY_POSTS', 15);
  if (spamCheckEveryPosts < 1) {
    throw new ConfigError('SPAMBOT_CHECK_EVERY_POSTS must be at least 1');
  }
  // While paused, recheck after this delay (when SpamBot gives no end time)
  const spamRecheckDelayMs = parseIntEnv('SPAMBOT_RECHECK_DELAY_MS', 30 * 60 * 1000);

  // Try to load message from file first, then fall back to env var
  const messageFromFile = loadMessageFromFile();
  const message = messageFromFile || process.env.MESSAGE || 'Default message';

  const credentialsHint = 'Get them from https://my.telegram.org/apps and set them in .env';
  if (!apiId?.trim() || !apiHash?.trim()) {
    throw new ConfigError(`API_ID and API_HASH are required. ${credentialsHint}`);
  }
  if (!/^\d+$/.test(apiId.trim())) {
    throw new ConfigError(`API_ID must be a number (got "${apiId}"). ${credentialsHint}`);
  }
  if (!/^[0-9a-f]{32}$/i.test(apiHash.trim())) {
    throw new ConfigError(`API_HASH must be a 32-character hex string. ${credentialsHint}`);
  }

  return {
    apiId: parseInt(apiId, 10),
    apiHash: apiHash.trim(),
    postIntervalMinMs,
    postIntervalMaxMs,
    spamCheckEnabled,
    spamCheckEveryPosts,
    spamRecheckDelayMs,
    allowedGroupIds: loadAllowlist(),
    message,
  };
}

export function getConfigDirectory(): string {
  return ensureConfigDirectory();
}
