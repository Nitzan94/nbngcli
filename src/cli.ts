#!/usr/bin/env node
// ABOUTME: Main CLI entry point for nbngcli
// ABOUTME: Routes commands to Gmail, Calendar, Drive, Sheets, and Photos services

import * as fs from "fs";
import { parseArgs } from "util";
import { AccountStorage } from "./account-storage.js";
import { OAuthFlow } from "./oauth-flow.js";
import { GmailService } from "./services/gmail.js";
import { CalendarService } from "./services/calendar.js";
import { DriveService } from "./services/drive.js";
import { SheetsService } from "./services/sheets.js";
import { PhotosService } from "./services/photos.js";

const accountStorage = new AccountStorage();
const gmailService = new GmailService(accountStorage);
const calendarService = new CalendarService(accountStorage);
const driveService = new DriveService(accountStorage);
const sheetsService = new SheetsService(accountStorage);
const photosService = new PhotosService(accountStorage);

function usage(): void {
  console.error(`
nbn - Unified Google CLI (Gmail, Calendar, Drive, Sheets, Photos)

USAGE

  nbn accounts <action>                    Account management
  nbn <email> mail <command> [options]     Gmail operations
  nbn <email> cal <command> [options]      Calendar operations
  nbn <email> drive <command> [options]    Drive operations
  nbn <email> sheets <command> [options]   Sheets operations
  nbn <email> photos <command> [options]   Photos operations

ACCOUNT COMMANDS

  nbn accounts credentials <file.json>     Set OAuth credentials (once)
  nbn accounts list                        List configured accounts
  nbn accounts add <email> [--manual]      Add account (--manual for browserless OAuth)
  nbn accounts remove <email>              Remove account

GMAIL COMMANDS (nbn <email> mail ...)

  search <query> [--max N] [--page TOKEN]  Search threads
  thread <threadId>                        Get thread with messages
  labels list                              List all labels
  labels <threadIds...> [--add L] [--remove L]  Modify labels
  drafts list                              List drafts
  drafts delete <draftId>                  Delete draft
  drafts send <draftId>                    Send draft
  send --to <emails> --subject <s> --body <b>  Send email
  trash <messageId>                        Move message to trash
  delete <messageId>                       Permanently delete message
  url <threadIds...>                       Generate Gmail URLs

CALENDAR COMMANDS (nbn <email> cal ...)

  calendars                                List calendars
  acl <calendarId>                         List calendar ACL
  events [calendarId] [--max N]            List events
  event <calendarId> <eventId>             Get event details
  create <calendarId> --title <t> --start <s> --end <e>  Create event
  update <calendarId> <eventId> [--title] [--start] [--end]  Update event
  delete <calendarId> <eventId>            Delete event
  freebusy <calendarIds> --start <s> --end <e>  Check availability

DRIVE COMMANDS (nbn <email> drive ...)

  ls [folderId] [--max N]                  List files
  search <query> [--max N]                 Search files
  get <fileId>                             Get file metadata
  download <fileId> [destPath]             Download file
  upload <localPath> [--name N] [--folder F]  Upload file
  mkdir <name> [--parent F]                Create folder
  delete <fileId>                          Delete file
  move <fileId> <newParentId>              Move file
  rename <fileId> <newName>                Rename file
  share <fileId> [--anyone] [--email E]    Share file
  unshare <fileId> <permissionId>          Remove permission
  permissions <fileId>                     List permissions
  url <fileIds...>                         Generate Drive URLs

SHEETS COMMANDS (nbn <email> sheets ...)

  get <spreadsheetId>                      Get spreadsheet info
  read <spreadsheetId> <range>             Read cell values
  write <spreadsheetId> <range> --values <json>  Write values
  append <spreadsheetId> <range> --values <json> Append rows
  clear <spreadsheetId> <range>            Clear values
  create --title <t> [--sheets S1,S2]      Create spreadsheet
  add-sheet <spreadsheetId> --title <t>    Add sheet
  delete-sheet <spreadsheetId> <sheetId>   Delete sheet
  rename-sheet <spreadsheetId> <sheetId> --title <t>  Rename sheet
  url <spreadsheetId>                      Get spreadsheet URL

PHOTOS COMMANDS (nbn <email> photos ...)

  albums list [--all]                      List albums
  albums get <albumId>                     Get album details
  albums create <title>                    Create album
  albums share <albumId>                   Share album
  albums add <albumId> <mediaIds...>       Add media to album
  albums remove <albumId> <mediaIds...>    Remove media from album
  media list [--all]                       List media items
  media get <mediaId>                      Get media details
  media search [--album A] [--type T] [--year Y]  Search media
  media upload <file> [--album A] [--desc D]  Upload media
  media download <mediaId> <outputPath>    Download media
  shared list                              List shared albums
  shared join <shareToken>                 Join shared album
  shared leave <shareToken>                Leave shared album

EXAMPLES

  nbn accounts credentials ~/credentials.json
  nbn accounts add you@gmail.com
  nbn you@gmail.com mail search "in:inbox is:unread"
  nbn you@gmail.com cal events
  nbn you@gmail.com drive ls
  nbn you@gmail.com sheets read 1Bxi... "Sheet1!A1:D10"
  nbn you@gmail.com photos albums list

DATA STORAGE

  ~/.nbngcli/credentials.json   OAuth client credentials
  ~/.nbngcli/accounts.json      Account tokens
  ~/.nbngcli/downloads/         Downloaded files
`);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toISOString().replace("T", " ").substring(0, 16);
}

async function handleAccounts(args: string[]): Promise<void> {
  const action = args[0];

  if (action === "credentials") {
    const filePath = args[1];
    if (!filePath) {
      console.error("Error: Missing credentials file path");
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);
    const clientId = data.installed?.client_id || data.clientId;
    const clientSecret = data.installed?.client_secret || data.clientSecret;
    if (!clientId || !clientSecret) {
      console.error("Error: Invalid credentials file");
      process.exit(1);
    }
    accountStorage.setCredentials(clientId, clientSecret);
    console.log("Credentials saved");
    return;
  }

  if (action === "list") {
    const accounts = accountStorage.getAllAccounts();
    if (accounts.length === 0) {
      console.log("No accounts configured");
    } else {
      for (const acc of accounts) {
        console.log(acc.email);
      }
    }
    return;
  }

  if (action === "add") {
    const email = args[1];
    const manual = args.includes("--manual");
    if (!email) {
      console.error("Error: Missing email address");
      process.exit(1);
    }
    if (accountStorage.hasAccount(email)) {
      console.error(`Error: Account '${email}' already exists`);
      process.exit(1);
    }
    const creds = accountStorage.getCredentials();
    if (!creds) {
      console.error("Error: No credentials configured. Run: nbn accounts credentials <file.json>");
      process.exit(1);
    }
    const oauthFlow = new OAuthFlow(creds.clientId, creds.clientSecret);
    const refreshToken = await oauthFlow.authorize(manual);
    accountStorage.addAccount({
      email,
      oauth2: { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken },
    });
    console.log(`Account '${email}' added`);
    return;
  }

  if (action === "remove") {
    const email = args[1];
    if (!email) {
      console.error("Error: Missing email address");
      process.exit(1);
    }
    if (accountStorage.deleteAccount(email)) {
      console.log(`Account '${email}' removed`);
    } else {
      console.error(`Error: Account '${email}' not found`);
      process.exit(1);
    }
    return;
  }

  console.error(`Error: Unknown accounts action: ${action}`);
  process.exit(1);
}

async function handleMail(email: string, args: string[]): Promise<void> {
  const command = args[0];

  if (command === "search") {
    const query = args[1];
    if (!query) {
      console.error("Error: Missing search query");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: { max: { type: "string" }, page: { type: "string" } },
      allowPositionals: true,
    });
    const result = await gmailService.searchThreads(
      email,
      query,
      parseInt(values.max || "10"),
      values.page
    );
    console.log("ID\tDATE\tFROM\tSUBJECT\tLABELS");
    for (const t of result.threads) {
      console.log(`${t.id}\t${formatDate(t.date)}\t${t.from}\t${t.subject}\t${t.labels.join(",")}`);
    }
    if (result.nextPageToken) {
      console.log(`\n# Next page: --page ${result.nextPageToken}`);
    }
    return;
  }

  if (command === "thread") {
    const threadId = args[1];
    if (!threadId) {
      console.error("Error: Missing thread ID");
      process.exit(1);
    }
    const thread = await gmailService.getThread(email, threadId);
    console.log(`Thread: ${thread.id}\n`);
    for (const msg of thread.messages) {
      console.log(`--- Message ${msg.id} ---`);
      console.log(`From: ${msg.from}`);
      console.log(`To: ${msg.to}`);
      console.log(`Date: ${msg.date}`);
      console.log(`Subject: ${msg.subject}`);
      console.log(`Labels: ${msg.labels.join(", ")}`);
      if (msg.attachments.length > 0) {
        console.log(`Attachments: ${msg.attachments.map((a) => a.filename).join(", ")}`);
      }
      console.log(`\n${msg.body}\n`);
    }
    return;
  }

  if (command === "labels") {
    if (args[1] === "list") {
      const labels = await gmailService.listLabels(email);
      console.log("ID\tNAME\tTYPE");
      for (const l of labels) {
        console.log(`${l.id}\t${l.name}\t${l.type}`);
      }
      return;
    }
    // Modify labels on threads
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: { add: { type: "string" }, remove: { type: "string" } },
      allowPositionals: true,
    });
    if (positionals.length === 0) {
      console.error("Error: Missing thread IDs");
      process.exit(1);
    }
    const addLabels = values.add?.split(",") || [];
    const removeLabels = values.remove?.split(",") || [];
    await gmailService.modifyLabels(email, positionals, addLabels, removeLabels);
    console.log("Labels modified");
    return;
  }

  if (command === "trash") {
    const messageId = args[1];
    if (!messageId) {
      console.error("Error: Missing message ID");
      process.exit(1);
    }
    await gmailService.trashMessage(email, messageId);
    console.log("Message moved to trash");
    return;
  }

  if (command === "delete") {
    const messageId = args[1];
    if (!messageId) {
      console.error("Error: Missing message ID");
      process.exit(1);
    }
    await gmailService.deleteMessage(email, messageId);
    console.log("Message permanently deleted");
    return;
  }

  if (command === "drafts") {
    const subCmd = args[1];
    if (subCmd === "list") {
      const drafts = await gmailService.listDrafts(email);
      console.log("ID\tMESSAGE_ID");
      for (const d of drafts) {
        console.log(`${d.id}\t${d.messageId || ""}`);
      }
      return;
    }
    if (subCmd === "delete") {
      const draftId = args[2];
      if (!draftId) {
        console.error("Error: Missing draft ID");
        process.exit(1);
      }
      await gmailService.deleteDraft(email, draftId);
      console.log("Draft deleted");
      return;
    }
    if (subCmd === "send") {
      const draftId = args[2];
      if (!draftId) {
        console.error("Error: Missing draft ID");
        process.exit(1);
      }
      const messageId = await gmailService.sendDraft(email, draftId);
      console.log(`Sent: ${messageId}`);
      return;
    }
    console.error(`Error: Unknown drafts command: ${subCmd}`);
    process.exit(1);
  }

  if (command === "send") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        attach: { type: "string", multiple: true },
        "reply-to": { type: "string" },
      },
      allowPositionals: true,
    });
    if (!values.to || !values.subject || !values.body) {
      console.error("Error: --to, --subject, and --body are required");
      process.exit(1);
    }
    const messageId = await gmailService.sendMessage(
      email,
      values.to.split(","),
      values.subject,
      values.body,
      {
        cc: values.cc?.split(","),
        bcc: values.bcc?.split(","),
        attachments: values.attach,
        replyToMessageId: values["reply-to"],
      }
    );
    console.log(`Sent: ${messageId}`);
    return;
  }

  if (command === "url") {
    const threadIds = args.slice(1);
    if (threadIds.length === 0) {
      console.error("Error: Missing thread IDs");
      process.exit(1);
    }
    for (const id of threadIds) {
      console.log(gmailService.getThreadUrl(email, id));
    }
    return;
  }

  console.error(`Error: Unknown mail command: ${command}`);
  process.exit(1);
}

async function handleCal(email: string, args: string[]): Promise<void> {
  const command = args[0];

  if (command === "calendars") {
    const calendars = await calendarService.listCalendars(email);
    console.log("ID\tNAME\tROLE");
    for (const c of calendars) {
      console.log(`${c.id}\t${c.name}\t${c.role}`);
    }
    return;
  }

  if (command === "acl") {
    const calendarId = args[1] || "primary";
    const acl = await calendarService.getCalendarAcl(email, calendarId);
    console.log("ID\tROLE\tSCOPE");
    for (const a of acl) {
      console.log(`${a.id}\t${a.role}\t${a.scope.type}:${a.scope.value || ""}`);
    }
    return;
  }

  if (command === "events") {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: {
        max: { type: "string" },
        page: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        q: { type: "string" },
      },
      allowPositionals: true,
    });
    const calendarId = positionals[0] || "primary";
    const result = await calendarService.listEvents(email, calendarId, {
      maxResults: parseInt(values.max || "10"),
      pageToken: values.page,
      timeMin: values.from,
      timeMax: values.to,
      query: values.q,
    });
    console.log("ID\tSTART\tEND\tSUMMARY");
    for (const e of result.events) {
      console.log(`${e.id}\t${e.start}\t${e.end}\t${e.summary}`);
    }
    if (result.nextPageToken) {
      console.log(`\n# Next page: --page ${result.nextPageToken}`);
    }
    return;
  }

  if (command === "event") {
    const calendarId = args[1];
    const eventId = args[2];
    if (!calendarId || !eventId) {
      console.error("Error: Missing calendar ID or event ID");
      process.exit(1);
    }
    const event = await calendarService.getEvent(email, calendarId, eventId);
    console.log(`ID: ${event.id}`);
    console.log(`Summary: ${event.summary}`);
    console.log(`Start: ${event.start}`);
    console.log(`End: ${event.end}`);
    if (event.location) console.log(`Location: ${event.location}`);
    if (event.description) console.log(`Description: ${event.description}`);
    if (event.attendees) {
      console.log(`Attendees: ${event.attendees.map((a) => `${a.email} (${a.responseStatus})`).join(", ")}`);
    }
    if (event.htmlLink) console.log(`Link: ${event.htmlLink}`);
    return;
  }

  if (command === "create") {
    const calendarId = args[1];
    if (!calendarId) {
      console.error("Error: Missing calendar ID");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        attendees: { type: "string" },
        allday: { type: "boolean" },
      },
      allowPositionals: true,
    });
    if (!values.title || !values.start || !values.end) {
      console.error("Error: --title, --start, and --end are required");
      process.exit(1);
    }
    const event = await calendarService.createEvent(email, calendarId, {
      summary: values.title,
      start: values.start,
      end: values.end,
      description: values.description,
      location: values.location,
      attendees: values.attendees?.split(","),
      allDay: values.allday,
    });
    console.log(`Created: ${event.id}`);
    if (event.htmlLink) console.log(`Link: ${event.htmlLink}`);
    return;
  }

  if (command === "update") {
    const calendarId = args[1];
    const eventId = args[2];
    if (!calendarId || !eventId) {
      console.error("Error: Missing calendar ID or event ID");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(3),
      options: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        attendees: { type: "string" },
        allday: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const event = await calendarService.updateEvent(email, calendarId, eventId, {
      summary: values.title,
      start: values.start,
      end: values.end,
      description: values.description,
      location: values.location,
      attendees: values.attendees?.split(","),
      allDay: values.allday,
    });
    console.log(`Updated: ${event.id}`);
    return;
  }

  if (command === "delete") {
    const calendarId = args[1];
    const eventId = args[2];
    if (!calendarId || !eventId) {
      console.error("Error: Missing calendar ID or event ID");
      process.exit(1);
    }
    await calendarService.deleteEvent(email, calendarId, eventId);
    console.log("Event deleted");
    return;
  }

  if (command === "freebusy") {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: { start: { type: "string" }, end: { type: "string" } },
      allowPositionals: true,
    });
    if (!values.start || !values.end || positionals.length === 0) {
      console.error("Error: Calendar IDs and --start, --end are required");
      process.exit(1);
    }
    const result = await calendarService.getFreeBusy(email, positionals, values.start, values.end);
    for (const [calId, busy] of result) {
      console.log(`\n${calId}:`);
      if (busy.length === 0) {
        console.log("  Free");
      } else {
        for (const b of busy) {
          console.log(`  Busy: ${b.start} - ${b.end}`);
        }
      }
    }
    return;
  }

  console.error(`Error: Unknown cal command: ${command}`);
  process.exit(1);
}

async function handleDrive(email: string, args: string[]): Promise<void> {
  const command = args[0];

  if (command === "ls") {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: {
        max: { type: "string" },
        page: { type: "string" },
        query: { type: "string" },
      },
      allowPositionals: true,
    });
    const folderId = positionals[0];
    const result = await driveService.listFiles(email, {
      folderId,
      maxResults: parseInt(values.max || "20"),
      pageToken: values.page,
      query: values.query,
    });
    console.log("ID\tNAME\tTYPE\tSIZE\tMODIFIED");
    for (const f of result.files) {
      const type = f.mimeType.includes("folder") ? "folder" : "file";
      console.log(`${f.id}\t${f.name}\t${type}\t${formatSize(f.size)}\t${formatDate(f.modifiedTime)}`);
    }
    if (result.nextPageToken) {
      console.log(`\n# Next page: --page ${result.nextPageToken}`);
    }
    return;
  }

  if (command === "search") {
    const query = args[1];
    if (!query) {
      console.error("Error: Missing search query");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: { max: { type: "string" }, page: { type: "string" } },
      allowPositionals: true,
    });
    const result = await driveService.search(
      email,
      query,
      parseInt(values.max || "20"),
      values.page
    );
    console.log("ID\tNAME\tTYPE\tSIZE\tMODIFIED");
    for (const f of result.files) {
      const type = f.mimeType.includes("folder") ? "folder" : "file";
      console.log(`${f.id}\t${f.name}\t${type}\t${formatSize(f.size)}\t${formatDate(f.modifiedTime)}`);
    }
    if (result.nextPageToken) {
      console.log(`\n# Next page: --page ${result.nextPageToken}`);
    }
    return;
  }

  if (command === "get") {
    const fileId = args[1];
    if (!fileId) {
      console.error("Error: Missing file ID");
      process.exit(1);
    }
    const file = await driveService.getFile(email, fileId);
    console.log(`ID: ${file.id}`);
    console.log(`Name: ${file.name}`);
    console.log(`Type: ${file.mimeType}`);
    console.log(`Size: ${formatSize(file.size)}`);
    console.log(`Modified: ${file.modifiedTime}`);
    if (file.description) console.log(`Description: ${file.description}`);
    if (file.webViewLink) console.log(`Link: ${file.webViewLink}`);
    return;
  }

  if (command === "download") {
    const fileId = args[1];
    const destPath = args[2];
    if (!fileId) {
      console.error("Error: Missing file ID");
      process.exit(1);
    }
    const result = await driveService.download(email, fileId, destPath);
    if (result.success) {
      console.log(`Downloaded: ${result.path} (${formatSize(result.size || 0)})`);
    } else {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    return;
  }

  if (command === "upload") {
    const localPath = args[1];
    if (!localPath) {
      console.error("Error: Missing local file path");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: { name: { type: "string" }, folder: { type: "string" } },
      allowPositionals: true,
    });
    const file = await driveService.upload(email, localPath, {
      name: values.name,
      folderId: values.folder,
    });
    console.log(`Uploaded: ${file.id}`);
    console.log(`Name: ${file.name}`);
    if (file.webViewLink) console.log(`Link: ${file.webViewLink}`);
    return;
  }

  if (command === "mkdir") {
    const name = args[1];
    if (!name) {
      console.error("Error: Missing folder name");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: { parent: { type: "string" } },
      allowPositionals: true,
    });
    const folder = await driveService.mkdir(email, name, values.parent);
    console.log(`Created: ${folder.id}`);
    console.log(`Name: ${folder.name}`);
    if (folder.webViewLink) console.log(`Link: ${folder.webViewLink}`);
    return;
  }

  if (command === "delete") {
    const fileId = args[1];
    if (!fileId) {
      console.error("Error: Missing file ID");
      process.exit(1);
    }
    await driveService.delete(email, fileId);
    console.log("Deleted");
    return;
  }

  if (command === "move") {
    const fileId = args[1];
    const newParentId = args[2];
    if (!fileId || !newParentId) {
      console.error("Error: Missing file ID or new parent ID");
      process.exit(1);
    }
    const file = await driveService.move(email, fileId, newParentId);
    console.log(`Moved: ${file.name}`);
    return;
  }

  if (command === "rename") {
    const fileId = args[1];
    const newName = args[2];
    if (!fileId || !newName) {
      console.error("Error: Missing file ID or new name");
      process.exit(1);
    }
    const file = await driveService.rename(email, fileId, newName);
    console.log(`Renamed: ${file.name}`);
    return;
  }

  if (command === "share") {
    const fileId = args[1];
    if (!fileId) {
      console.error("Error: Missing file ID");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: {
        anyone: { type: "boolean" },
        email: { type: "string" },
        role: { type: "string" },
      },
      allowPositionals: true,
    });
    const result = await driveService.share(email, fileId, {
      anyone: values.anyone,
      email: values.email,
      role: values.role as "reader" | "writer",
    });
    console.log(`Link: ${result.link}`);
    console.log(`Permission ID: ${result.permissionId}`);
    return;
  }

  if (command === "unshare") {
    const fileId = args[1];
    const permissionId = args[2];
    if (!fileId || !permissionId) {
      console.error("Error: Missing file ID or permission ID");
      process.exit(1);
    }
    await driveService.unshare(email, fileId, permissionId);
    console.log("Permission removed");
    return;
  }

  if (command === "permissions") {
    const fileId = args[1];
    if (!fileId) {
      console.error("Error: Missing file ID");
      process.exit(1);
    }
    const permissions = await driveService.listPermissions(email, fileId);
    console.log("ID\tTYPE\tROLE\tEMAIL");
    for (const p of permissions) {
      console.log(`${p.id}\t${p.type}\t${p.role}\t${p.email || ""}`);
    }
    return;
  }

  if (command === "url") {
    const fileIds = args.slice(1);
    if (fileIds.length === 0) {
      console.error("Error: Missing file IDs");
      process.exit(1);
    }
    for (const id of fileIds) {
      console.log(driveService.getFileUrl(id));
    }
    return;
  }

  console.error(`Error: Unknown drive command: ${command}`);
  process.exit(1);
}

async function handleSheets(email: string, args: string[]): Promise<void> {
  const command = args[0];

  if (command === "get") {
    const spreadsheetId = args[1];
    if (!spreadsheetId) {
      console.error("Error: Missing spreadsheet ID");
      process.exit(1);
    }
    const info = await sheetsService.getSpreadsheet(email, spreadsheetId);
    console.log(`ID: ${info.id}`);
    console.log(`Title: ${info.title}`);
    if (info.locale) console.log(`Locale: ${info.locale}`);
    if (info.timeZone) console.log(`TimeZone: ${info.timeZone}`);
    console.log(`\nSheets:`);
    for (const s of info.sheets) {
      console.log(`  ${s.id}\t${s.title}\t${s.rowCount || ""}x${s.columnCount || ""}`);
    }
    if (info.url) console.log(`\nURL: ${info.url}`);
    return;
  }

  if (command === "read") {
    const spreadsheetId = args[1];
    const range = args[2];
    if (!spreadsheetId || !range) {
      console.error("Error: Missing spreadsheet ID or range");
      process.exit(1);
    }
    const values = await sheetsService.readValues(email, spreadsheetId, range);
    for (const row of values) {
      console.log(row.map(c => c === null ? "" : String(c)).join("\t"));
    }
    return;
  }

  if (command === "write") {
    const spreadsheetId = args[1];
    const range = args[2];
    if (!spreadsheetId || !range) {
      console.error("Error: Missing spreadsheet ID or range");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(3),
      options: { values: { type: "string" } },
      allowPositionals: true,
    });
    if (!values.values) {
      console.error("Error: --values is required");
      process.exit(1);
    }
    const data = JSON.parse(values.values);
    const result = await sheetsService.writeValues(email, spreadsheetId, range, data);
    console.log(`Updated: ${result.updatedCells} cells in ${result.updatedRange}`);
    return;
  }

  if (command === "append") {
    const spreadsheetId = args[1];
    const range = args[2];
    if (!spreadsheetId || !range) {
      console.error("Error: Missing spreadsheet ID or range");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(3),
      options: { values: { type: "string" } },
      allowPositionals: true,
    });
    if (!values.values) {
      console.error("Error: --values is required");
      process.exit(1);
    }
    const data = JSON.parse(values.values);
    const result = await sheetsService.appendValues(email, spreadsheetId, range, data);
    console.log(`Appended: ${result.updatedRows} rows, ${result.updatedCells} cells`);
    return;
  }

  if (command === "clear") {
    const spreadsheetId = args[1];
    const range = args[2];
    if (!spreadsheetId || !range) {
      console.error("Error: Missing spreadsheet ID or range");
      process.exit(1);
    }
    const clearedRange = await sheetsService.clearValues(email, spreadsheetId, range);
    console.log(`Cleared: ${clearedRange}`);
    return;
  }

  if (command === "create") {
    const { values } = parseArgs({
      args: args.slice(1),
      options: { title: { type: "string" }, sheets: { type: "string" } },
      allowPositionals: true,
    });
    if (!values.title) {
      console.error("Error: --title is required");
      process.exit(1);
    }
    const sheetTitles = values.sheets?.split(",");
    const info = await sheetsService.createSpreadsheet(email, values.title, sheetTitles);
    console.log(`Created: ${info.id}`);
    console.log(`Title: ${info.title}`);
    if (info.url) console.log(`URL: ${info.url}`);
    return;
  }

  if (command === "add-sheet") {
    const spreadsheetId = args[1];
    if (!spreadsheetId) {
      console.error("Error: Missing spreadsheet ID");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(2),
      options: { title: { type: "string" } },
      allowPositionals: true,
    });
    if (!values.title) {
      console.error("Error: --title is required");
      process.exit(1);
    }
    const sheet = await sheetsService.addSheet(email, spreadsheetId, values.title);
    console.log(`Added sheet: ${sheet.id} - ${sheet.title}`);
    return;
  }

  if (command === "delete-sheet") {
    const spreadsheetId = args[1];
    const sheetId = args[2];
    if (!spreadsheetId || !sheetId) {
      console.error("Error: Missing spreadsheet ID or sheet ID");
      process.exit(1);
    }
    await sheetsService.deleteSheet(email, spreadsheetId, parseInt(sheetId));
    console.log("Sheet deleted");
    return;
  }

  if (command === "rename-sheet") {
    const spreadsheetId = args[1];
    const sheetId = args[2];
    if (!spreadsheetId || !sheetId) {
      console.error("Error: Missing spreadsheet ID or sheet ID");
      process.exit(1);
    }
    const { values } = parseArgs({
      args: args.slice(3),
      options: { title: { type: "string" } },
      allowPositionals: true,
    });
    if (!values.title) {
      console.error("Error: --title is required");
      process.exit(1);
    }
    await sheetsService.renameSheet(email, spreadsheetId, parseInt(sheetId), values.title);
    console.log("Sheet renamed");
    return;
  }

  if (command === "url") {
    const spreadsheetId = args[1];
    if (!spreadsheetId) {
      console.error("Error: Missing spreadsheet ID");
      process.exit(1);
    }
    console.log(sheetsService.getSpreadsheetUrl(spreadsheetId));
    return;
  }

  console.error(`Error: Unknown sheets command: ${command}`);
  process.exit(1);
}

async function handlePhotos(email: string, args: string[]): Promise<void> {
  const command = args[0];

  if (command === "albums") {
    const subCmd = args[1];

    if (subCmd === "list") {
      const fetchAll = args.includes("--all");
      let pageToken: string | undefined;
      do {
        const result = await photosService.listAlbums(email, 50, pageToken);
        for (const a of result.albums) {
          console.log(`${a.id}\t${a.title}\t${a.mediaItemsCount || 0} items`);
        }
        pageToken = fetchAll ? result.nextPageToken : undefined;
      } while (pageToken);
      return;
    }

    if (subCmd === "get") {
      const albumId = args[2];
      if (!albumId) {
        console.error("Error: Missing album ID");
        process.exit(1);
      }
      const album = await photosService.getAlbum(email, albumId);
      console.log(`ID: ${album.id}`);
      console.log(`Title: ${album.title}`);
      console.log(`Items: ${album.mediaItemsCount || 0}`);
      console.log(`URL: ${album.productUrl}`);
      return;
    }

    if (subCmd === "create") {
      const title = args[2];
      if (!title) {
        console.error("Error: Missing album title");
        process.exit(1);
      }
      const album = await photosService.createAlbum(email, title);
      console.log(`Created: ${album.id}`);
      console.log(`Title: ${album.title}`);
      console.log(`URL: ${album.productUrl}`);
      return;
    }

    if (subCmd === "share") {
      const albumId = args[2];
      if (!albumId) {
        console.error("Error: Missing album ID");
        process.exit(1);
      }
      const result = await photosService.shareAlbum(email, albumId);
      console.log(`URL: ${result.shareableUrl}`);
      console.log(`Token: ${result.shareToken}`);
      return;
    }

    if (subCmd === "add") {
      const albumId = args[2];
      const mediaIds = args.slice(3);
      if (!albumId || mediaIds.length === 0) {
        console.error("Error: Missing album ID or media IDs");
        process.exit(1);
      }
      await photosService.addMediaToAlbum(email, albumId, mediaIds);
      console.log(`Added ${mediaIds.length} item(s) to album`);
      return;
    }

    if (subCmd === "remove") {
      const albumId = args[2];
      const mediaIds = args.slice(3);
      if (!albumId || mediaIds.length === 0) {
        console.error("Error: Missing album ID or media IDs");
        process.exit(1);
      }
      await photosService.removeMediaFromAlbum(email, albumId, mediaIds);
      console.log(`Removed ${mediaIds.length} item(s) from album`);
      return;
    }

    console.error(`Error: Unknown albums command: ${subCmd}`);
    process.exit(1);
  }

  if (command === "media") {
    const subCmd = args[1];

    if (subCmd === "list") {
      const fetchAll = args.includes("--all");
      let pageToken: string | undefined;
      do {
        const result = await photosService.listMediaItems(email, 100, pageToken);
        for (const m of result.mediaItems) {
          console.log(`${m.id}\t${m.filename}\t${m.mimeType}\t${m.mediaMetadata.creationTime}`);
        }
        pageToken = fetchAll ? result.nextPageToken : undefined;
      } while (pageToken);
      return;
    }

    if (subCmd === "get") {
      const mediaId = args[2];
      if (!mediaId) {
        console.error("Error: Missing media ID");
        process.exit(1);
      }
      const item = await photosService.getMediaItem(email, mediaId);
      console.log(`ID: ${item.id}`);
      console.log(`Filename: ${item.filename}`);
      console.log(`Type: ${item.mimeType}`);
      console.log(`Size: ${item.mediaMetadata.width}x${item.mediaMetadata.height}`);
      console.log(`Created: ${item.mediaMetadata.creationTime}`);
      console.log(`URL: ${item.productUrl}`);
      return;
    }

    if (subCmd === "search") {
      const { values } = parseArgs({
        args: args.slice(2),
        options: {
          album: { type: "string" },
          type: { type: "string" },
          year: { type: "string" },
        },
        allowPositionals: true,
      });
      const filters: Record<string, unknown> = {};
      if (values.type) {
        filters.mediaTypeFilter = { mediaTypes: [values.type.toUpperCase()] };
      }
      if (values.year) {
        const year = parseInt(values.year);
        filters.dateFilter = {
          ranges: [{ startDate: { year, month: 1, day: 1 }, endDate: { year, month: 12, day: 31 } }],
        };
      }
      const result = await photosService.searchMediaItems(
        email,
        Object.keys(filters).length > 0 ? filters as never : undefined,
        values.album
      );
      for (const m of result.mediaItems) {
        console.log(`${m.id}\t${m.filename}\t${m.mimeType}\t${m.mediaMetadata.creationTime}`);
      }
      if (result.nextPageToken) {
        console.log(`\n# More results available`);
      }
      return;
    }

    if (subCmd === "upload") {
      const filePath = args[2];
      if (!filePath) {
        console.error("Error: Missing file path");
        process.exit(1);
      }
      const { values } = parseArgs({
        args: args.slice(3),
        options: { album: { type: "string" }, desc: { type: "string" } },
        allowPositionals: true,
      });
      let item;
      if (values.album) {
        item = await photosService.uploadToAlbum(email, filePath, values.album, values.desc);
      } else {
        item = await photosService.uploadMedia(email, filePath, values.desc);
      }
      console.log(`Uploaded: ${item.id}`);
      console.log(`Filename: ${item.filename}`);
      console.log(`URL: ${item.productUrl}`);
      return;
    }

    if (subCmd === "download") {
      const mediaId = args[2];
      const outputPath = args[3];
      if (!mediaId || !outputPath) {
        console.error("Error: Missing media ID or output path");
        process.exit(1);
      }
      const path = await photosService.downloadMedia(email, mediaId, outputPath);
      console.log(`Downloaded: ${path}`);
      return;
    }

    console.error(`Error: Unknown media command: ${subCmd}`);
    process.exit(1);
  }

  if (command === "shared") {
    const subCmd = args[1];

    if (subCmd === "list") {
      const result = await photosService.listSharedAlbums(email);
      for (const a of result.sharedAlbums) {
        console.log(`${a.id}\t${a.title}\t${a.mediaItemsCount || 0} items`);
      }
      return;
    }

    if (subCmd === "join") {
      const shareToken = args[2];
      if (!shareToken) {
        console.error("Error: Missing share token");
        process.exit(1);
      }
      const album = await photosService.joinSharedAlbum(email, shareToken);
      console.log(`Joined: ${album.title}`);
      console.log(`ID: ${album.id}`);
      return;
    }

    if (subCmd === "leave") {
      const shareToken = args[2];
      if (!shareToken) {
        console.error("Error: Missing share token");
        process.exit(1);
      }
      await photosService.leaveSharedAlbum(email, shareToken);
      console.log("Left shared album");
      return;
    }

    console.error(`Error: Unknown shared command: ${subCmd}`);
    process.exit(1);
  }

  console.error(`Error: Unknown photos command: ${command}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    process.exit(0);
  }

  try {
    // Handle accounts commands
    if (args[0] === "accounts") {
      await handleAccounts(args.slice(1));
      return;
    }

    // Service commands: nbn <email> <service> <command>
    const email = args[0];
    const service = args[1];
    const serviceArgs = args.slice(2);

    if (!email.includes("@")) {
      console.error(`Error: Invalid email address: ${email}`);
      process.exit(1);
    }

    if (!accountStorage.hasAccount(email)) {
      console.error(`Error: Account '${email}' not found. Run: nbn accounts add ${email}`);
      process.exit(1);
    }

    if (service === "mail") {
      await handleMail(email, serviceArgs);
    } else if (service === "cal") {
      await handleCal(email, serviceArgs);
    } else if (service === "drive") {
      await handleDrive(email, serviceArgs);
    } else if (service === "sheets") {
      await handleSheets(email, serviceArgs);
    } else if (service === "photos") {
      await handlePhotos(email, serviceArgs);
    } else {
      console.error(`Error: Unknown service: ${service}. Use: mail, cal, drive, sheets, or photos`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

main();
