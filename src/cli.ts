#!/usr/bin/env node
// ABOUTME: Main CLI entry point for nbngcli
// ABOUTME: Routes commands to Gmail, Calendar, and Drive services

import * as fs from "fs";
import { parseArgs } from "util";
import { AccountStorage } from "./account-storage.js";
import { OAuthFlow } from "./oauth-flow.js";
import { GmailService } from "./services/gmail.js";
import { CalendarService } from "./services/calendar.js";
import { DriveService } from "./services/drive.js";

const accountStorage = new AccountStorage();
const gmailService = new GmailService(accountStorage);
const calendarService = new CalendarService(accountStorage);
const driveService = new DriveService(accountStorage);

function usage(): void {
  console.error(`
nbn - Unified Google CLI (Gmail, Calendar, Drive)

USAGE

  nbn accounts <action>                    Account management
  nbn <email> mail <command> [options]     Gmail operations
  nbn <email> cal <command> [options]      Calendar operations
  nbn <email> drive <command> [options]    Drive operations

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

EXAMPLES

  nbn accounts credentials ~/credentials.json
  nbn accounts add you@gmail.com
  nbn you@gmail.com mail search "in:inbox is:unread"
  nbn you@gmail.com cal events
  nbn you@gmail.com drive ls

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
    } else {
      console.error(`Error: Unknown service: ${service}. Use: mail, cal, or drive`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

main();
