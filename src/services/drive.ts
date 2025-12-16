// ABOUTME: Google Drive service for file operations
// ABOUTME: List, search, upload, download, share files and folders

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import { google, drive_v3 } from "googleapis";
import { AccountStorage } from "../account-storage.js";

export class DriveService {
  private driveClients = new Map<string, drive_v3.Drive>();

  constructor(private accountStorage: AccountStorage) {}

  private getClient(email: string): drive_v3.Drive {
    if (!this.driveClients.has(email)) {
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

      const drive = google.drive({ version: "v3", auth: oauth2Client });
      this.driveClients.set(email, drive);
    }
    return this.driveClients.get(email)!;
  }

  async listFiles(
    email: string,
    options: ListOptions = {}
  ): Promise<{ files: FileInfo[]; nextPageToken?: string }> {
    const drive = this.getClient(email);

    let q = options.query || "";
    if (options.folderId) {
      const folderQuery = `'${options.folderId}' in parents`;
      q = q ? `${q} and ${folderQuery}` : folderQuery;
    }
    if (!q.includes("trashed")) {
      q = q ? `${q} and trashed = false` : "trashed = false";
    }

    const response = await drive.files.list({
      q: q || undefined,
      pageSize: options.maxResults || 20,
      pageToken: options.pageToken,
      orderBy: options.orderBy || "modifiedTime desc",
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, webViewLink)",
    });

    const files = (response.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: f.size ? parseInt(f.size) : 0,
      modifiedTime: f.modifiedTime || "",
      webViewLink: f.webViewLink,
    }));

    return { files, nextPageToken: response.data.nextPageToken || undefined };
  }

  async getFile(email: string, fileId: string): Promise<FileInfo> {
    const drive = this.getClient(email);
    const response = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size, modifiedTime, createdTime, parents, webViewLink, description, starred",
    });

    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: f.size ? parseInt(f.size) : 0,
      modifiedTime: f.modifiedTime || "",
      webViewLink: f.webViewLink,
      description: f.description,
      starred: f.starred,
    };
  }

  async download(
    email: string,
    fileId: string,
    destPath?: string
  ): Promise<DownloadResult> {
    const drive = this.getClient(email);
    const file = await this.getFile(email, fileId);

    if (!file.name) {
      return { success: false, error: "File has no name" };
    }

    const downloadDir = path.join(this.accountStorage.getConfigDir(), "downloads");
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const filePath = destPath || path.join(downloadDir, `${fileId}_${file.name}`);
    const isGoogleDoc = file.mimeType?.startsWith("application/vnd.google-apps.");

    try {
      if (isGoogleDoc) {
        const exportMimeType = this.getExportMimeType(file.mimeType);
        const response = await drive.files.export(
          { fileId, mimeType: exportMimeType },
          { responseType: "stream" }
        );
        const ext = this.getExportExtension(exportMimeType);
        const exportPath = filePath.replace(/\.[^.]+$/, "") + ext;
        const dest = fs.createWriteStream(exportPath);

        await new Promise<void>((resolve, reject) => {
          (response.data as NodeJS.ReadableStream).pipe(dest);
          dest.on("finish", resolve);
          dest.on("error", reject);
        });

        const stats = fs.statSync(exportPath);
        return { success: true, path: exportPath, size: stats.size };
      }

      const response = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" }
      );
      const dest = fs.createWriteStream(filePath);

      await new Promise<void>((resolve, reject) => {
        (response.data as NodeJS.ReadableStream).pipe(dest);
        dest.on("finish", resolve);
        dest.on("error", reject);
      });

      const stats = fs.statSync(filePath);
      return { success: true, path: filePath, size: stats.size };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async upload(
    email: string,
    localPath: string,
    options: UploadOptions = {}
  ): Promise<FileInfo> {
    const drive = this.getClient(email);
    const fileName = options.name || path.basename(localPath);
    const mimeType = options.mimeType || this.guessMimeType(localPath);

    const fileMetadata: drive_v3.Schema$File = {
      name: fileName,
      parents: options.folderId ? [options.folderId] : undefined,
    };

    const media = {
      mimeType,
      body: fs.createReadStream(localPath),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id, name, mimeType, size, webViewLink",
    });

    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: f.size ? parseInt(f.size) : 0,
      modifiedTime: "",
      webViewLink: f.webViewLink,
    };
  }

  async delete(email: string, fileId: string): Promise<void> {
    const drive = this.getClient(email);
    await drive.files.delete({ fileId });
  }

  async mkdir(email: string, name: string, parentId?: string): Promise<FileInfo> {
    const drive = this.getClient(email);

    const fileMetadata: drive_v3.Schema$File = {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id, name, mimeType, webViewLink",
    });

    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: 0,
      modifiedTime: "",
      webViewLink: f.webViewLink,
    };
  }

  async move(email: string, fileId: string, newParentId: string): Promise<FileInfo> {
    const drive = this.getClient(email);
    const file = await this.getFile(email, fileId);

    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: (file as unknown as { parents?: string[] }).parents?.join(",") || "",
      fields: "id, name, mimeType, parents, webViewLink",
    });

    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: 0,
      modifiedTime: "",
      webViewLink: f.webViewLink,
    };
  }

  async rename(email: string, fileId: string, newName: string): Promise<FileInfo> {
    const drive = this.getClient(email);

    const response = await drive.files.update({
      fileId,
      requestBody: { name: newName },
      fields: "id, name, mimeType, webViewLink",
    });

    const f = response.data;
    return {
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: 0,
      modifiedTime: "",
      webViewLink: f.webViewLink,
    };
  }

  async share(email: string, fileId: string, options: ShareOptions): Promise<ShareResult> {
    const drive = this.getClient(email);
    const role = options.role || "reader";

    let permission: drive_v3.Schema$Permission;
    if (options.anyone) {
      permission = { type: "anyone", role };
    } else if (options.email) {
      permission = { type: "user", role, emailAddress: options.email };
    } else {
      throw new Error("Must specify anyone or email");
    }

    const response = await drive.permissions.create({
      fileId,
      requestBody: permission,
      fields: "id",
    });

    const file = await drive.files.get({ fileId, fields: "webViewLink" });

    return {
      link: file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      permissionId: response.data.id || "",
    };
  }

  async unshare(email: string, fileId: string, permissionId: string): Promise<void> {
    const drive = this.getClient(email);
    await drive.permissions.delete({ fileId, permissionId });
  }

  async listPermissions(email: string, fileId: string): Promise<Permission[]> {
    const drive = this.getClient(email);
    const response = await drive.permissions.list({
      fileId,
      fields: "permissions(id, type, role, emailAddress)",
    });

    return (response.data.permissions || []).map((p) => ({
      id: p.id!,
      type: p.type!,
      role: p.role!,
      email: p.emailAddress || undefined,
    }));
  }

  async search(
    email: string,
    query: string,
    maxResults = 20,
    pageToken?: string
  ): Promise<{ files: FileInfo[]; nextPageToken?: string }> {
    const drive = this.getClient(email);
    const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`;

    const response = await drive.files.list({
      q,
      pageSize: maxResults,
      pageToken,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, webViewLink)",
    });

    const files = (response.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || "",
      size: f.size ? parseInt(f.size) : 0,
      modifiedTime: f.modifiedTime || "",
      webViewLink: f.webViewLink,
    }));

    return { files, nextPageToken: response.data.nextPageToken || undefined };
  }

  getFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  private getExportMimeType(googleMimeType: string): string {
    const exports: Record<string, string> = {
      "application/vnd.google-apps.document": "application/pdf",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "application/pdf",
      "application/vnd.google-apps.drawing": "image/png",
    };
    return exports[googleMimeType] || "application/pdf";
  }

  private getExportExtension(mimeType: string): string {
    const exts: Record<string, string> = {
      "application/pdf": ".pdf",
      "text/csv": ".csv",
      "image/png": ".png",
      "text/plain": ".txt",
    };
    return exts[mimeType] || ".pdf";
  }

  private guessMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".txt": "text/plain",
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".zip": "application/zip",
      ".csv": "text/csv",
      ".md": "text/markdown",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }
}

export interface FileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink?: string | null;
  description?: string | null;
  starred?: boolean | null;
}

export interface ListOptions {
  folderId?: string;
  query?: string;
  maxResults?: number;
  pageToken?: string;
  orderBy?: string;
}

export interface UploadOptions {
  name?: string;
  folderId?: string;
  mimeType?: string;
}

export interface ShareOptions {
  anyone?: boolean;
  email?: string;
  role?: "reader" | "writer";
}

export interface ShareResult {
  link: string;
  permissionId: string;
}

export interface Permission {
  id: string;
  type: string;
  role: string;
  email?: string;
}

export interface DownloadResult {
  success: boolean;
  path?: string;
  size?: number;
  error?: string;
}
