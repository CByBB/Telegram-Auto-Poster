import chalk, { Chalk } from 'chalk';
import { inspect } from 'util';

type Level = 'info' | 'success' | 'warn' | 'error';

interface LevelStyle {
  label: string;
  icon: string;
  badge: Chalk;
  text: Chalk;
}

const LEVELS: Record<Level, LevelStyle> = {
  info: { label: 'INFO', icon: 'ℹ', badge: chalk.bgCyan.black, text: chalk.white },
  success: { label: 'SUCCESS', icon: '✔', badge: chalk.bgGreen.black, text: chalk.green },
  warn: { label: 'WARN', icon: '⚠', badge: chalk.bgYellow.black, text: chalk.yellow },
  error: { label: 'ERROR', icon: '✖', badge: chalk.bgRed.white.bold, text: chalk.red },
};

const LABEL_WIDTH = Math.max(...Object.values(LEVELS).map(l => l.label.length));
// Visible width of "[YYYY-MM-DD HH:mm:ss] ✔  [ SUCCESS ] " - used to align continuation lines
const PREFIX_WIDTH = 21 + 1 + 3 + (LABEL_WIDTH + 2) + 1;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatTimestamp(): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return chalk.gray(`[${date} ${time}]`);
}

/** Highlights "quoted names", @usernames, (ID: ...) and numbers with units inside a message. */
function highlight(message: string, base: Chalk): string {
  return message
    .split(/("[^"\n]*"|@\w+|\(ID: [^)]+\)|\b\d+(?:\.\d+)?(?:h|m|s|ms)\b)/g)
    .map((part, i) => {
      if (i % 2 === 0) return base(part);
      if (part.startsWith('"')) return chalk.cyanBright.bold(part);
      if (part.startsWith('@')) return chalk.magentaBright(part);
      if (part.startsWith('(ID:')) return chalk.gray(part);
      return chalk.blueBright.bold(part);
    })
    .join('');
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    // Start errors on their own line under the message
    return `\n${chalk.red.dim(arg.stack ?? arg.message)}`;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  return inspect(arg, { colors: chalk.level > 0, depth: 4 });
}

function write(level: Level, message: string, args: unknown[]): void {
  const style = LEVELS[level];
  const prefix = `${formatTimestamp()} ${style.text(style.icon)}  ${style.badge(` ${style.label.padEnd(LABEL_WIDTH)} `)} `;
  const indent = ' '.repeat(PREFIX_WIDTH);

  const extra = args.filter(a => a !== undefined).map(formatArg);
  const body = [highlight(message, style.text), ...extra]
    .join(' ')
    // Indent multi-line output (stack traces, SpamBot replies) under the message
    .replace(/\n/g, `\n${indent}`);

  const line = `${prefix}${body}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export class Logger {
  static info(message: string, ...args: unknown[]): void {
    write('info', message, args);
  }

  static success(message: string, ...args: unknown[]): void {
    write('success', message, args);
  }

  static warn(message: string, ...args: unknown[]): void {
    write('warn', message, args);
  }

  static error(message: string, error?: Error | unknown): void {
    write('error', message, [error]);
  }
}
