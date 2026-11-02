# Quick Start Guide

## 1. Install Dependencies

```bash
npm install
```

## 2. Get Telegram API Credentials

1. Go to https://my.telegram.org/apps
2. Log in with your phone number
3. Create a new application
4. Copy your `api_id` and `api_hash`

## 3. Configure Environment

Create a `.env` file:

```env
API_ID=your_api_id_here
API_HASH=your_api_hash_here
SESSION_NAME=session
POST_INTERVAL_MIN_MS=60000
POST_INTERVAL_MAX_MS=300000
```

Create `config/message.txt` file with your message:

```bash
mkdir -p config
echo "Hello! This is an automated message." > config/message.txt
```

**Note**: The `config/message.txt` file takes priority over the `MESSAGE` environment variable.

Choose where to post with `config/allowlist.txt` (one group/channel ID per line). On the first run the bot writes all your groups/channels with their IDs to `config/groups.txt` and won't post anything until the allowlist has IDs - copy the lines you want from `groups.txt` into `allowlist.txt`, then restart.

## 4. Run the Bot

### Development Mode (with hot reload):
```bash
npm run dev
```

### Production Mode:
```bash
npm run build
npm start
```

## 5. First Time Authentication

On first run, the bot will:
1. Ask for your phone number (with country code, e.g., +1234567890)
2. Send you a verification code via Telegram
3. Ask you to enter the code
4. Save your session to `config/{SESSION_NAME}.session` for future runs

After authentication, the session is saved in the `config/` directory and you won't need to authenticate again.

## 6. How It Works

- The bot fetches all groups/channels you're a member of and keeps only those in `config/allowlist.txt`
- For each group, it posts your message immediately
- Between posts it waits a random time between `POST_INTERVAL_MIN_MS` and `POST_INTERVAL_MAX_MS`, and logs the next scheduled post time
- It checks your account standing with @SpamBot at startup and after every 15 sent posts, pausing posting until the account is clear (see `SPAMBOT_*` in `.env.example`)
- Before each new post, it deletes the previous message
- All actions are logged to the console in real-time

## 7. Stop the Bot

Press `Ctrl+C` to gracefully stop the bot.

## Troubleshooting

- **"No groups found"**: Make sure you're a member of at least one group
- **"Failed to post"**: Check that you have permission to send messages in the groups
- **Authentication errors**: Make sure your API_ID and API_HASH are correct
- **Session issues**: Delete the `.session` file and re-authenticate
