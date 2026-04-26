# web-to-cc

A self-hosted web UI for [Claude Code](https://claude.ai/code). Run it on a VPS and access Claude Code from any browser.

## Features

- **Console** — send prompts, stream live output with tool calls, resume past sessions
- **Session browser** — searchable list of all past sessions, sortable by recency or creation time
- **Memory viewer** — browse the persistent memory Claude carries across conversations
- **Optional auth** — HTTP Basic Auth gate via a single env var
- **Light/dark theme** — persisted to localStorage

## Requirements

- Node.js 20+
- pnpm
- [Claude Code CLI](https://claude.ai/code) installed and authenticated on the server

## Setup

```bash
git clone git@github.com:bulsico/web-to-cc.git
cd web-to-cc
pnpm install
cp .env.example .env
```

Edit `.env`:

```env
# Directory where Claude Code will run.
# Defaults to the current working directory if not set.
CC_PROJECT_DIR=/home/user/my-project

# Path to the claude binary. Auto-detected from PATH or ~/.local/bin/claude if not set.
# CC_BINARY=claude

# Password for HTTP Basic Auth. Leave unset to disable authentication.
# CC_PASSWORD=your-secret-password
```

## Running

**Development:**
```bash
pnpm dev
```

**Production:**
```bash
pnpm build
pnpm start
```

The app runs on port 3000 by default.

## How it works

When you submit a prompt, the server spawns `claude` as a detached background process with `--output-format stream-json`. Output is written to a per-session log file. The browser tails that file over a streaming HTTP response, parsing JSONL events to render a live timeline of text and tool calls.

Sessions survive page refreshes and server restarts — the underlying Claude process keeps running and the log can be replayed from byte 0 on reconnect.

Session history and memory files are read directly from `~/.claude/projects/<your-project>/`, the same location Claude Code uses internally.

## Running as a systemd service

```ini
[Unit]
Description=web-to-cc
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/web-to-cc
EnvironmentFile=/home/youruser/web-to-cc/.env
ExecStart=/usr/bin/pnpm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now web-to-cc
```
