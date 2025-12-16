# nbngcli

Unified CLI for Gmail, Google Calendar, and Google Drive.

Single OAuth authorization for all three services.

## Installation

```bash
npm install -g nbngcli
```

## Setup

### 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API
4. Go to "OAuth consent screen" > External > Add your email as test user
5. Go to "Credentials" > Create Credentials > OAuth client ID > Desktop app
6. Download the JSON file

### 2. Configure nbngcli

```bash
# Set credentials (once)
nbn accounts credentials ~/path/to/credentials.json

# Add your account
nbn accounts add you@gmail.com
```

This opens a browser for authorization. Use `--manual` for browserless setup.

## Usage

### Account Management

```bash
nbn accounts list                    # List accounts
nbn accounts add email@gmail.com     # Add account
nbn accounts remove email@gmail.com  # Remove account
```

### Gmail

```bash
nbn you@gmail.com mail search "in:inbox is:unread"
nbn you@gmail.com mail search "from:boss@company.com" --max 50
nbn you@gmail.com mail thread <threadId>
nbn you@gmail.com mail labels list
nbn you@gmail.com mail labels <threadId> --add STARRED --remove UNREAD
nbn you@gmail.com mail send --to a@x.com --subject "Hi" --body "Hello"
nbn you@gmail.com mail send --to a@x.com --subject "Hi" --body "Hello" --attach file.pdf
nbn you@gmail.com mail drafts list
nbn you@gmail.com mail drafts send <draftId>
nbn you@gmail.com mail url <threadId>
```

### Google Calendar

```bash
nbn you@gmail.com cal calendars
nbn you@gmail.com cal acl <calendarId>
nbn you@gmail.com cal events
nbn you@gmail.com cal events primary --max 20
nbn you@gmail.com cal event <calendarId> <eventId>
nbn you@gmail.com cal create primary --title "Meeting" --start "2025-01-15T10:00:00" --end "2025-01-15T11:00:00"
nbn you@gmail.com cal update <calendarId> <eventId> --title "New Title"
nbn you@gmail.com cal delete <calendarId> <eventId>
nbn you@gmail.com cal freebusy primary --start "2025-01-15T00:00:00Z" --end "2025-01-16T00:00:00Z"
```

### Google Drive

```bash
nbn you@gmail.com drive ls
nbn you@gmail.com drive ls <folderId> --max 50
nbn you@gmail.com drive search "quarterly report"
nbn you@gmail.com drive get <fileId>
nbn you@gmail.com drive download <fileId>
nbn you@gmail.com drive download <fileId> ./local-path.pdf
nbn you@gmail.com drive upload ./file.pdf
nbn you@gmail.com drive upload ./file.pdf --folder <folderId>
nbn you@gmail.com drive mkdir "New Folder"
nbn you@gmail.com drive mkdir "Subfolder" --parent <folderId>
nbn you@gmail.com drive delete <fileId>
nbn you@gmail.com drive move <fileId> <newParentId>
nbn you@gmail.com drive rename <fileId> "new-name.pdf"
nbn you@gmail.com drive share <fileId> --anyone
nbn you@gmail.com drive share <fileId> --email friend@gmail.com --role writer
nbn you@gmail.com drive permissions <fileId>
nbn you@gmail.com drive unshare <fileId> <permissionId>
nbn you@gmail.com drive url <fileId>
```

## Data Storage

All data is stored locally in `~/.nbngcli/`:

- `credentials.json` - OAuth client credentials
- `accounts.json` - Account tokens
- `downloads/` - Downloaded files

## License

MIT
