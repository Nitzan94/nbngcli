// ABOUTME: Gmail service for email operations
// ABOUTME: Search, read threads, send messages, manage labels and drafts

import * as fs from "fs";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import { google, gmail_v1 } from "googleapis";
import { AccountStorage } from "../account-storage.js";

export class GmailService {
  private gmailClients = new Map<string, gmail_v1.Gmail>();

  constructor(private accountStorage: AccountStorage) {}

  private getClient(email: string): gmail_v1.Gmail {
    if (!this.gmailClients.has(email)) {
      const account = this.accountStorage.getAccount(email);
      if (!account) throw new Error(`Account '${email}' not found`);

      const oauth2Client = new OAuth2Client(
        account.oauth2.clientId,
        account.oauth2.clientSecret,
        "http://localhost"
      );
      oauth2Client.setCredentials({
        refresh_token: account.oauth2.refreshToken,
        access_token: account.oauth2.accessToken,
      });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      this.gmailClients.set(email, gmail);
    }
    return this.gmailClients.get(email)!;
  }

  async searchThreads(
    email: string,
    query: string,
    maxResults = 10,
    pageToken?: string
  ): Promise<{ threads: ThreadSummary[]; nextPageToken?: string }> {
    const gmail = this.getClient(email);
    const response = await gmail.users.threads.list({
      userId: "me",
      q: query,
      maxResults,
      pageToken,
    });

    const threads = response.data.threads || [];
    const detailedThreads: ThreadSummary[] = [];

    for (const thread of threads) {
      const detail = await gmail.users.threads.get({ userId: "me", id: thread.id! });
      const messages = detail.data.messages || [];
      const firstMsg = messages[0];

      detailedThreads.push({
        id: thread.id!,
        date: this.getHeader(firstMsg, "date") || "",
        from: this.getHeader(firstMsg, "from") || "",
        subject: this.getHeader(firstMsg, "subject") || "",
        labels: firstMsg?.labelIds || [],
      });
    }

    return { threads: detailedThreads, nextPageToken: response.data.nextPageToken || undefined };
  }

  async getThread(email: string, threadId: string): Promise<ThreadDetail> {
    const gmail = this.getClient(email);
    const response = await gmail.users.threads.get({ userId: "me", id: threadId });
    const thread = response.data;

    return {
      id: thread.id!,
      messages: (thread.messages || []).map((msg) => ({
        id: msg.id!,
        from: this.getHeader(msg, "from") || "",
        to: this.getHeader(msg, "to") || "",
        subject: this.getHeader(msg, "subject") || "",
        date: this.getHeader(msg, "date") || "",
        body: this.getBody(msg),
        labels: msg.labelIds || [],
        attachments: this.getAttachments(msg),
      })),
    };
  }

  async listLabels(email: string): Promise<Label[]> {
    const gmail = this.getClient(email);
    const response = await gmail.users.labels.list({ userId: "me" });
    return (response.data.labels || []).map((l) => ({
      id: l.id!,
      name: l.name!,
      type: l.type || "",
    }));
  }

  async modifyLabels(
    email: string,
    threadIds: string[],
    addLabels: string[] = [],
    removeLabels: string[] = []
  ): Promise<void> {
    const gmail = this.getClient(email);
    for (const threadId of threadIds) {
      if (addLabels.length > 0) {
        await gmail.users.threads.modify({
          userId: "me",
          id: threadId,
          requestBody: { addLabelIds: addLabels },
        });
      }
      if (removeLabels.length > 0) {
        await gmail.users.threads.modify({
          userId: "me",
          id: threadId,
          requestBody: { removeLabelIds: removeLabels },
        });
      }
    }
  }

  async listDrafts(email: string): Promise<Draft[]> {
    const gmail = this.getClient(email);
    const response = await gmail.users.drafts.list({ userId: "me" });
    return (response.data.drafts || []).map((d) => ({
      id: d.id!,
      messageId: d.message?.id || undefined,
    }));
  }

  async getDraft(email: string, draftId: string): Promise<gmail_v1.Schema$Draft> {
    const gmail = this.getClient(email);
    const response = await gmail.users.drafts.get({ userId: "me", id: draftId });
    return response.data;
  }

  async deleteDraft(email: string, draftId: string): Promise<void> {
    const gmail = this.getClient(email);
    await gmail.users.drafts.delete({ userId: "me", id: draftId });
  }

  async sendDraft(email: string, draftId: string): Promise<string> {
    const gmail = this.getClient(email);
    const response = await gmail.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });
    return (response.data as gmail_v1.Schema$Message).id || "";
  }

  async sendMessage(
    email: string,
    to: string[],
    subject: string,
    body: string,
    options: SendOptions = {}
  ): Promise<string> {
    const gmail = this.getClient(email);

    let inReplyTo: string | undefined;
    let references: string | undefined;
    let threadId: string | undefined;

    if (options.replyToMessageId) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: options.replyToMessageId,
        format: "metadata",
        metadataHeaders: ["Message-ID", "References"],
      });
      const headers = msg.data.payload?.headers || [];
      const messageId = headers.find((h) => h.name === "Message-ID")?.value;
      const existingRefs = headers.find((h) => h.name === "References")?.value;
      if (messageId) {
        inReplyTo = messageId;
        references = existingRefs ? `${existingRefs} ${messageId}` : messageId;
      }
      threadId = msg.data.threadId || undefined;
    }

    const hasAttachments = options.attachments && options.attachments.length > 0;
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const emailHeaders = [
      `From: ${email}`,
      `To: ${to.join(", ")}`,
      options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
      options.bcc?.length ? `Bcc: ${options.bcc.join(", ")}` : "",
      `Subject: ${subject}`,
      inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
      references ? `References: ${references}` : "",
      "MIME-Version: 1.0",
      hasAttachments
        ? `Content-Type: multipart/mixed; boundary="${boundary}"`
        : "Content-Type: text/plain; charset=UTF-8",
    ].filter(Boolean);

    let emailContent: string;
    if (hasAttachments) {
      const parts: string[] = [];
      parts.push(`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`);

      for (const filePath of options.attachments!) {
        const filename = path.basename(filePath);
        const fileContent = fs.readFileSync(filePath);
        const base64Content = fileContent.toString("base64");
        const mimeType = this.getMimeType(filename);
        parts.push(
          `--${boundary}\r\n` +
            `Content-Type: ${mimeType}\r\n` +
            "Content-Transfer-Encoding: base64\r\n" +
            `Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
            base64Content
        );
      }
      emailContent = emailHeaders.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${boundary}--`;
    } else {
      emailContent = emailHeaders.join("\r\n") + "\r\n\r\n" + body;
    }

    const encodedEmail = Buffer.from(emailContent).toString("base64url");
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedEmail, threadId },
    });

    return response.data.id || "";
  }

  async createDraft(
    email: string,
    to: string[],
    subject: string,
    body: string,
    options: SendOptions = {}
  ): Promise<string> {
    const gmail = this.getClient(email);

    const emailHeaders = [
      `From: ${email}`,
      `To: ${to.join(", ")}`,
      options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
    ].filter(Boolean);

    const emailContent = emailHeaders.join("\r\n") + "\r\n\r\n" + body;
    const encodedEmail = Buffer.from(emailContent).toString("base64url");

    const response = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: encodedEmail } },
    });

    return response.data.id || "";
  }

  getThreadUrl(email: string, threadId: string): string {
    return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${threadId}`;
  }

  private getHeader(message: gmail_v1.Schema$Message | undefined, name: string): string | undefined {
    const header = message?.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    );
    return header?.value || undefined;
  }

  private getBody(message: gmail_v1.Schema$Message): string {
    const payload = message.payload;
    if (!payload) return "";

    if (payload.body?.data) {
      return Buffer.from(payload.body.data, "base64url").toString();
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString();
        }
      }
      for (const part of payload.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString();
        }
      }
    }

    return message.snippet || "";
  }

  private getAttachments(message: gmail_v1.Schema$Message): Attachment[] {
    const attachments: Attachment[] = [];
    const parts = message.payload?.parts || [];

    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
        });
      }
    }

    return attachments;
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".txt": "text/plain",
      ".html": "text/html",
      ".zip": "application/zip",
      ".json": "application/json",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }
}

export interface ThreadSummary {
  id: string;
  date: string;
  from: string;
  subject: string;
  labels: string[];
}

export interface ThreadDetail {
  id: string;
  messages: MessageDetail[];
}

export interface MessageDetail {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  labels: string[];
  attachments: Attachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Label {
  id: string;
  name: string;
  type: string;
}

export interface Draft {
  id: string;
  messageId?: string;
}

export interface SendOptions {
  cc?: string[];
  bcc?: string[];
  attachments?: string[];
  replyToMessageId?: string;
}
