# Telegram Auto Poster Userbot

A TypeScript-based Telegram userbot that automatically posts messages to all groups you're a member of at configured intervals. The bot deletes the previous message before posting a new one in each group.

## Features

- ✅ Automatically fetches all groups you're a member of
- ✅ Posts messages at configurable intervals
- ✅ Deletes previous message before posting new one
- ✅ Real-time console logging
- ✅ Proper account authentication
- ✅ TypeScript with full type safety
- ✅ ESLint and Prettier configured
- ✅ Hot reload with Nodemon

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Telegram API credentials (API ID and API Hash)

## Getting Telegram API Credentials

1. Go to https://my.telegram.org/apps
2. Log in with your phone number
3. Create a new application
4. Copy your `api_id` and `api_hash`

## Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

4. Edit `.env` and add your credentials:

```env
API_ID=your_api_id
API_HASH=your_api_hash
POST_INTERVAL_MIN_MS=60000
POST_INTERVAL_MAX_MS=300000
```

5. Create `config/message.txt` file with your message (or set `MESSAGE` in `.env`):

```bash
mkdir -p config
echo "Your message here" > config/message.txt
```

**Note**: The `config/message.txt` file takes priority over the `MESSAGE` environment variable. If the file doesn't exist, it will fall back to the `MESSAGE` env var.

## Configuration

- `API_ID`: Your Telegram API ID (from https://my.telegram.org/apps)
- `API_HASH`: Your Telegram API Hash
- `SESSION_NAME`: Name for the session file (default: "session", saved in `config/` directory)
- `POST_INTERVAL_MIN_MS` / `POST_INTERVAL_MAX_MS`: Range for the wait between posts in milliseconds. A random value in this range is picked before every post (both default to the legacy `POST_INTERVAL_MS`, or 60000)
- `SPAMBOT_CHECK_ENABLED`: Automatically check account standing with @SpamBot (default: `true`)
- `SPAMBOT_CHECK_EVERY_POSTS`: Check @SpamBot after this many sent posts (default: 15). A check also runs at startup and whenever Telegram returns `PEER_FLOOD`
- `SPAMBOT_RECHECK_DELAY_MS`: While posting is paused, delay before rechecking when @SpamBot gives no "limited until" time (default: 1800000 = 30m)
- `MESSAGE`: The message to post in groups (optional - `config/message.txt` takes priority)

### File Structure

The bot uses a `config/` directory in the project root for storing:
- **Session files**: `config/{SESSION_NAME}.session` - Automatically created after first authentication
- **Message file**: `config/message.txt` - Your message to post (create this file or use `MESSAGE` env var)

The `config/` directory is automatically created on first run.

## Usage

### Development Mode (with hot reload)

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### Other Commands

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

## First Run

On the first run, the bot will:
1. Connect to Telegram
2. Ask for your phone number
3. Send you a verification code
4. Ask you to enter the code
5. Once authenticated, it will fetch all your groups
6. Start posting messages at the configured interval

After the first authentication, the session will be saved and you won't need to authenticate again.

## How It Works

1. **Startup**: The bot connects to Telegram and authenticates if needed
2. **Group Fetching**: Retrieves all groups and channels you're a member of
3. **Posting**: For each group:
   - Deletes the previous message (if exists)
   - Posts the configured message
   - Picks a random wait between `POST_INTERVAL_MIN_MS` and `POST_INTERVAL_MAX_MS` and logs the next scheduled post time
4. **Account check**: At startup and after every `SPAMBOT_CHECK_EVERY_POSTS` sent posts, sends `/start` to @SpamBot. If the reply isn't "no limits", posting pauses: it rechecks at the "limited until" time if SpamBot gives one, otherwise after `SPAMBOT_RECHECK_DELAY_MS`, and resumes posting once the account is clear
5. **Logging**: All actions are logged to the console in real-time

## Stopping the Bot

Press `Ctrl+C` to gracefully stop the bot. It will:
- Stop all posting intervals
- Disconnect from Telegram
- Exit cleanly

## Project Structure

```
.
├── src/
│   ├── index.ts      # Main entry point
│   ├── bot.ts        # Bot logic and posting
│   ├── config.ts     # Configuration loader
│   └── logger.ts     # Logging utility
├── config/           # Configuration directory (auto-created)
│   ├── session.session  # Session file (auto-created after auth)
│   └── message.txt      # Message file (create this)
├── dist/             # Compiled JavaScript (generated)
├── .env              # Environment variables (create this)
├── .env.example      # Example environment file
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
├── .eslintrc.json    # ESLint configuration
├── .prettierrc.json  # Prettier configuration
└── nodemon.json      # Nodemon configuration
```

## Notes

- The bot requires you to be a member of the groups you want to post to
- Make sure you have permission to send messages in the groups
- The bot deletes its own previous messages before posting new ones
- Session files are stored in `config/` directory and should be kept secure
- Message is read from `config/message.txt` (falls back to `MESSAGE` env var if file doesn't exist)
- The `config/` directory is automatically created on first run

## License

MIT
