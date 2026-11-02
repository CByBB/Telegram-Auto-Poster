import { TelegramClient } from 'telegram';
import { Api, password as passwordHelpers } from 'telegram';
import { StringSession } from 'telegram/sessions';
import type { EntityLike } from 'telegram/define';
import * as fs from 'fs';
import * as path from 'path';
import { ALLOWLIST_FILE, Config, GROUPS_LIST_FILE, getConfigDirectory } from './config';
import { Logger } from './logger';

const SPAMBOT_USERNAME = 'SpamBot';
// Checked first, since the "ok" reply itself contains the word "limits"
const SPAMBOT_OK_PHRASES = ['no limits', 'free as a bird', 'good news'];
const SPAMBOT_LIMITED_PHRASES = [
  'limited',
  'restricted',
  'unfortunately',
  "i'm afraid",
  'annoying',
];
// e.g. "limited until 15 Nov 2026, 12:34 UTC" / "will be automatically released on 7 Dec 2026, 19:41 UTC"
const SPAMBOT_UNTIL_REGEX =
  /(?:until|released on|lifted on)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4},?\s+\d{1,2}:\d{2}(?:\s*(?:UTC|GMT))?)/i;
// Extra wait after the "until" time before rechecking
const SPAMBOT_UNTIL_BUFFER_MS = 60 * 1000;
// setTimeout cannot handle delays above ~24.8 days
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

type SpamStatus = 'ok' | 'limited' | 'unknown';

interface SpamCheckResult {
  status: SpamStatus;
  limitedUntil?: number;
}

function parseLimitedUntil(text: string): number | undefined {
  const match = text.match(SPAMBOT_UNTIL_REGEX);
  if (!match) {
    return undefined;
  }
  let dateText = match[1].replace(',', '');
  // SpamBot reports times in UTC
  if (!/(UTC|GMT)$/i.test(dateText)) {
    dateText += ' UTC';
  }
  const timestamp = Date.parse(dateText);
  return isNaN(timestamp) ? undefined : timestamp;
}

/** Prefixes an error's message with context so the top-level handler can log it once. */
function withContext(context: string, error: unknown): Error {
  if (error instanceof Error) {
    if (!error.message.startsWith(context)) {
      error.message = `${context}: ${error.message}`;
    }
    return error;
  }
  return new Error(`${context}: ${String(error)}`);
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

interface GroupInfo {
  id: string;
  title: string;
  entity: EntityLike;
  lastMessageId?: number;
}

export class TelegramAutoPoster {
  private client: TelegramClient;
  private config: Config;
  private groups: GroupInfo[] = [];
  private postingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  private sessionFile: string;
  private session: StringSession;

  constructor(config: Config) {
    this.config = config;

    // Ensure config directory exists
    const configDir = getConfigDirectory();

    // Load existing session if available, otherwise create new one
    this.sessionFile = path.join(configDir, `session.config`);
    let sessionString = '';

    if (fs.existsSync(this.sessionFile)) {
      try {
        sessionString = fs.readFileSync(this.sessionFile, 'utf-8');
        Logger.info('Loaded existing session from config directory');
      } catch (error) {
        Logger.warn('Failed to load session file, starting fresh');
      }
    }

    this.session = new StringSession(sessionString);

    this.client = new TelegramClient(this.session, config.apiId, config.apiHash, {
      connectionRetries: 5,
    });
  }

  private saveSession(): void {
    try {
      const sessionString = this.session.save() as unknown as string;
      if (sessionString) {
        fs.writeFileSync(this.sessionFile, sessionString, 'utf-8');
      }
    } catch (error) {
      Logger.warn('Failed to save session', error);
    }
  }

  async start(): Promise<void> {
    Logger.info('Starting Telegram Auto Poster...');
    Logger.info('Connecting to Telegram...');

    await this.client.connect();
    Logger.success('Connected to Telegram');

    if (!(await this.client.checkAuthorization())) {
      Logger.info('Not authorized. Starting authentication...');
      await this.authenticate();
    } else {
      Logger.success('Already authorized');
      // Save session in case it was updated
      this.saveSession();
    }

    Logger.info('Fetching groups...');
    await this.fetchGroups();
    Logger.success(`${this.groups.length} allowlisted groups/channels to post to`);

    if (this.groups.length === 0) {
      Logger.warn(
        `Nothing to post to. Copy the IDs you want from config/${GROUPS_LIST_FILE} into config/${ALLOWLIST_FILE} (one per line) and restart.`
      );
      await this.stop();
      return;
    }

    this.isRunning = true;
    Logger.info(
      `Starting sequential posting: random interval between posts of ${formatDuration(this.config.postIntervalMinMs)} - ${formatDuration(this.config.postIntervalMaxMs)}`
    );
    if (this.config.spamCheckEnabled) {
      Logger.info(
        `@SpamBot account check enabled: at startup and every ${this.config.spamCheckEveryPosts} sent posts (posting pauses until account is clear)`
      );
    }
    this.startPosting();
    Logger.success('Auto posting started');
  }

  private async authenticate(): Promise<void> {
    try {
      Logger.info('Please enter your phone number (with country code, e.g., +1234567890):');
      const phoneNumber = await this.promptInput('Phone number: ');

      const result = await this.client.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId: this.config.apiId,
          apiHash: this.config.apiHash,
          settings: new Api.CodeSettings({}),
        })
      );

      if (!('phoneCodeHash' in result)) {
        throw new Error('Failed to get phone code hash');
      }

      const phoneCodeHash = result.phoneCodeHash;

      Logger.info('Please enter the code you received:');
      const code = await this.promptInput('Code: ');

      try {
        const signInResult = await this.client.invoke(
          new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash,
            phoneCode: code,
          })
        );

        if ('user' in signInResult && signInResult.user) {
          const user = signInResult.user;
          let userName = 'User';

          // Check if user has firstName property (not UserEmpty)
          if ('firstName' in user) {
            userName = user.firstName || 'User';
          } else if ('username' in user && user.username) {
            userName = `@${user.username}`;
          }

          Logger.success(`Authentication successful! Logged in as: ${userName}`);
        } else {
          Logger.success('Authentication successful');
        }

        // Save session after successful authentication
        this.saveSession();
      } catch (signInError: any) {
        // Check if 2FA password is required
        if (
          signInError.errorMessage === 'SESSION_PASSWORD_NEEDED' ||
          (signInError instanceof Error && signInError.message.includes('SESSION_PASSWORD_NEEDED'))
        ) {
          Logger.info('Two-factor authentication is enabled. Please enter your password:');
          const password = await this.promptInput('Password: ');

          // Get password info for SRP
          const passwordResult = await this.client.invoke(new Api.account.GetPassword());

          // Compute password hash using SRP
          const passwordCheck = await passwordHelpers.computeCheck(passwordResult, password);

          // Check password
          const checkPasswordResult = await this.client.invoke(
            new Api.auth.CheckPassword({
              password: passwordCheck,
            })
          );

          if ('user' in checkPasswordResult && checkPasswordResult.user) {
            const user = checkPasswordResult.user;
            let userName = 'User';

            if ('firstName' in user) {
              userName = user.firstName || 'User';
            } else if ('username' in user && user.username) {
              userName = `@${user.username}`;
            }

            Logger.success(`Authentication successful! Logged in as: ${userName}`);
          } else {
            Logger.success('Authentication successful');
          }

          // Save session after successful authentication
          this.saveSession();
        } else {
          // Re-throw if it's a different error
          throw signInError;
        }
      }
    } catch (error) {
      throw withContext('Authentication failed', error);
    }
  }

  private async promptInput(prompt: string): Promise<string> {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise(resolve => {
      readline.question(prompt, (answer: string) => {
        readline.close();
        resolve(answer.trim());
      });
    });
  }

  private async fetchGroups(): Promise<void> {
    try {
      const dialogs = await this.client.getDialogs();
      this.groups = [];

      const allowlist = this.config.allowedGroupIds;
      const listLines: string[] = [
        '# All groups and channels you are a member of (rewritten on every start).',
        `# Copy the lines you want to post to into config/${ALLOWLIST_FILE}`,
        '',
      ];

      for (const dialog of dialogs) {
        if (dialog.isGroup || dialog.isChannel) {
          const entity = dialog.entity;
          const dialogId = dialog.id;

          if (entity && dialogId !== undefined && dialogId !== null) {
            let title = 'Unknown';
            if ('title' in entity && entity.title) {
              title = entity.title;
            } else if ('username' in entity && entity.username) {
              title = `@${entity.username}`;
            } else if ('firstName' in entity && entity.firstName) {
              title = entity.firstName;
            }

            // Store dialog ID as string (Telegram IDs can be negative for groups)
            const groupId = dialogId.toString();
            const type = dialog.isGroup ? 'Group' : 'Channel';
            const allowed = allowlist.has(groupId);
            listLines.push(`${groupId}  # [${type}] ${title}`);
            Logger.info(
              `Found ${type.toLowerCase()}: ${title} (ID: ${groupId})${allowed ? ' [ALLOWED]' : ''}`
            );

            if (allowed) {
              this.groups.push({
                id: groupId,
                title,
                entity, // Store entity for API calls
              });
            }
          }
        }
      }

      const groupsListFile = path.join(getConfigDirectory(), GROUPS_LIST_FILE);
      fs.writeFileSync(groupsListFile, listLines.join('\n') + '\n', 'utf-8');
      Logger.info(`Saved all group/channel IDs to config/${GROUPS_LIST_FILE}`);

      const foundIds = new Set(this.groups.map(g => g.id));
      for (const id of allowlist) {
        if (!foundIds.has(id)) {
          Logger.warn(`Allowlist ID ${id} not found among your groups/channels - skipped`);
        }
      }
    } catch (error) {
      throw withContext('Failed to fetch groups', error);
    }
  }

  private startPosting(): void {
    // Start sequential posting: post to one group, wait interval, then next group
    this.postSequentially();
  }

  private async postSequentially(): Promise<void> {
    let currentIndex = 0;
    // Check account standing once at startup, then after a random number of sent posts
    let spamCheckDue = this.config.spamCheckEnabled;
    let postsSinceSpamCheck = 0;

    while (this.isRunning) {
      if (this.groups.length === 0) {
        break;
      }

      if (spamCheckDue) {
        await this.waitForGoodStanding();
        if (!this.isRunning) {
          break;
        }
        spamCheckDue = false;
        postsSinceSpamCheck = 0;
        Logger.info(`Next @SpamBot check after ${this.config.spamCheckEveryPosts} sent posts`);
      }

      const group = this.groups[currentIndex];
      let postSuccess = false;

      try {
        await this.postToGroup(group);
        postSuccess = true;
      } catch (error) {
        Logger.error(`Error posting to group "${group.title}"`, error);
        postSuccess = false;
        // PEER_FLOOD means Telegram has started limiting the account - check right away
        if (this.config.spamCheckEnabled && String(error).includes('PEER_FLOOD')) {
          Logger.warn('Telegram returned PEER_FLOOD - checking account standing now');
          spamCheckDue = true;
          continue;
        }
      }

      if (postSuccess && this.config.spamCheckEnabled) {
        postsSinceSpamCheck++;
        if (postsSinceSpamCheck >= this.config.spamCheckEveryPosts) {
          spamCheckDue = true;
        } else {
          Logger.info(
            `Posts until next @SpamBot check: ${this.config.spamCheckEveryPosts - postsSinceSpamCheck}`
          );
        }
      }

      // Move to next group (wrap around to first group after last)
      currentIndex = (currentIndex + 1) % this.groups.length;

      // Only wait for interval if post was successful
      // If post failed, try next group immediately without waiting
      if (postSuccess && this.isRunning) {
        // Pick a random wait within the configured range for every post
        const waitMs = randomBetween(this.config.postIntervalMinMs, this.config.postIntervalMaxMs);
        const nextGroup = this.groups[currentIndex];
        Logger.info(
          `Next post scheduled at ${formatTime(Date.now() + waitMs)} (in ${formatDuration(waitMs)}) to "${nextGroup.title}"`
        );
        await this.sleep(waitMs);
      } else if (!postSuccess) {
        Logger.info('Post failed, trying next group immediately without waiting');
      }
    }
  }

  /**
   * Checks @SpamBot and blocks until the account is in good standing.
   * If SpamBot reports a "limited until" time, rechecks at that time;
   * otherwise rechecks after a random delay from SPAMBOT_RECHECK_DELAY_MIN/MAX_MS.
   */
  private async waitForGoodStanding(): Promise<void> {
    while (this.isRunning) {
      const result = await this.checkSpamStatus();
      if (result.status === 'ok') {
        return;
      }

      let recheckAt: number;
      if (result.limitedUntil && result.limitedUntil > Date.now()) {
        recheckAt = result.limitedUntil + SPAMBOT_UNTIL_BUFFER_MS;
        Logger.warn(
          `@SpamBot says the account is limited until ${formatTime(result.limitedUntil)}`
        );
      } else {
        recheckAt = Date.now() + this.config.spamRecheckDelayMs;
      }

      Logger.warn(
        `Posting paused - next @SpamBot check at ${formatTime(recheckAt)} (in ${formatDuration(recheckAt - Date.now())})`
      );
      await this.sleep(recheckAt - Date.now());
    }
  }

  /**
   * Sends /start to @SpamBot and interprets its reply.
   * Returns 'ok' if no limits, 'limited' if restricted (with the end time if SpamBot gives one),
   * 'unknown' if there was no reply or it couldn't be parsed.
   */
  private async checkSpamStatus(): Promise<SpamCheckResult> {
    Logger.info('Checking account standing with @SpamBot...');
    try {
      const sent = await this.client.sendMessage(SPAMBOT_USERNAME, { message: '/start' });

      // Wait for SpamBot's reply (poll for up to ~20s)
      let replyText: string | undefined;
      for (let attempt = 0; attempt < 10 && !replyText; attempt++) {
        await this.sleep(2000);
        const messages = await this.client.getMessages(SPAMBOT_USERNAME, { limit: 5 });
        const reply = messages.find(m => !m.out && m.id > sent.id && m.message);
        replyText = reply?.message;
      }

      if (!replyText) {
        Logger.warn('@SpamBot did not reply in time - account standing unknown');
        return { status: 'unknown' };
      }

      const text = replyText.toLowerCase();
      if (SPAMBOT_OK_PHRASES.some(p => text.includes(p))) {
        Logger.success('@SpamBot: account is in good standing - no limits applied');
        return { status: 'ok' };
      }
      if (SPAMBOT_LIMITED_PHRASES.some(p => text.includes(p))) {
        Logger.warn(`@SpamBot: account is LIMITED\n${replyText}`);
        return { status: 'limited', limitedUntil: parseLimitedUntil(replyText) };
      }

      Logger.warn(`@SpamBot: could not interpret reply\n${replyText}`);
      return { status: 'unknown' };
    } catch (error) {
      Logger.error('Failed to check account standing with @SpamBot', error);
      return { status: 'unknown' };
    }
  }

  private async sleep(ms: number): Promise<void> {
    // Split long waits so they don't overflow setTimeout's max delay
    while (ms > 0) {
      const chunk = Math.min(ms, MAX_TIMEOUT_MS);
      await new Promise(resolve => setTimeout(resolve, chunk));
      ms -= chunk;
    }
  }

  private async postToGroup(group: GroupInfo): Promise<void> {
    Logger.info(`Posting to group: ${group.title} (ID: ${group.id})`);

    // Delete previous message if exists
    if (group.lastMessageId) {
      try {
        await this.client.deleteMessages(group.entity, [group.lastMessageId], {
          revoke: false,
        });
        Logger.info(`Deleted previous message in "${group.title}"`);
      } catch (error) {
        Logger.warn(
          `Failed to delete previous message in "${group.title}":`,
          error instanceof Error ? error.message : error
        );
        // Don't throw here - deletion failure shouldn't prevent posting
      }
    }

    // Send new message - throw error if it fails so we can try next group immediately
    const sentMessage = await this.client.sendMessage(group.entity, {
      message: this.config.message,
    });

    if (!sentMessage) {
      throw new Error(`Failed to send message to "${group.title}" - no response from Telegram`);
    }

    // Handle different message response types
    let messageId: number | undefined;
    if (Array.isArray(sentMessage)) {
      messageId = sentMessage[0]?.id;
    } else if (typeof sentMessage === 'object' && 'id' in sentMessage) {
      messageId = sentMessage.id as number;
    }

    if (messageId) {
      group.lastMessageId = messageId;
      Logger.success(`Posted message to "${group.title}" (Message ID: ${messageId})`);
    } else {
      Logger.warn(`Posted to "${group.title}" but couldn't get message ID`);
      // Still consider this a success since message was sent
    }
  }

  async stop(): Promise<void> {
    Logger.info('Stopping auto poster...');
    this.isRunning = false;

    // Clear all intervals (if any remain from old implementation)
    for (const interval of this.postingIntervals.values()) {
      clearInterval(interval);
    }
    this.postingIntervals.clear();

    // Disconnect client
    if (this.client.connected) {
      await this.client.disconnect();
      Logger.success('Disconnected from Telegram');
    }
  }
}
