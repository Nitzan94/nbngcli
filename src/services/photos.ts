// ABOUTME: Service class for Google Photos Library API
// ABOUTME: Manages albums, media items, uploads, and search

import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";
import { AccountStorage } from "../account-storage.js";

const API_BASE = "https://photoslibrary.googleapis.com/v1";

export interface Album {
  id: string;
  title: string;
  productUrl: string;
  mediaItemsCount?: string;
  coverPhotoBaseUrl?: string;
  coverPhotoMediaItemId?: string;
}

export interface MediaItem {
  id: string;
  productUrl: string;
  baseUrl: string;
  mimeType: string;
  filename: string;
  mediaMetadata: {
    creationTime: string;
    width: string;
    height: string;
    photo?: Record<string, unknown>;
    video?: Record<string, unknown>;
  };
}

export interface SearchFilters {
  dateFilter?: {
    dates?: Array<{ year: number; month: number; day: number }>;
    ranges?: Array<{
      startDate: { year: number; month: number; day: number };
      endDate: { year: number; month: number; day: number };
    }>;
  };
  contentFilter?: {
    includedContentCategories?: string[];
    excludedContentCategories?: string[];
  };
  mediaTypeFilter?: {
    mediaTypes: ("ALL_MEDIA" | "VIDEO" | "PHOTO")[];
  };
}

export class PhotosService {
  private clients = new Map<string, OAuth2Client>();

  constructor(private accountStorage: AccountStorage) {}

  private async getClient(email: string): Promise<OAuth2Client> {
    if (!this.clients.has(email)) {
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

      this.clients.set(email, oauth2Client);
    }
    return this.clients.get(email)!;
  }

  private async fetch(
    email: string,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<unknown> {
    const client = await this.getClient(email);
    const { token } = await client.getAccessToken();

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // === Albums ===

  async listAlbums(
    email: string,
    pageSize = 50,
    pageToken?: string
  ): Promise<{ albums: Album[]; nextPageToken?: string }> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);

    const result = (await this.fetch(email, `/albums?${params}`)) as {
      albums?: Album[];
      nextPageToken?: string;
    };
    return { albums: result.albums || [], nextPageToken: result.nextPageToken };
  }

  async getAlbum(email: string, albumId: string): Promise<Album> {
    return (await this.fetch(email, `/albums/${albumId}`)) as Album;
  }

  async createAlbum(email: string, title: string): Promise<Album> {
    const result = (await this.fetch(email, "/albums", {
      method: "POST",
      body: JSON.stringify({ album: { title } }),
    })) as Album;
    return result;
  }

  async addMediaToAlbum(
    email: string,
    albumId: string,
    mediaItemIds: string[]
  ): Promise<void> {
    await this.fetch(email, `/albums/${albumId}:batchAddMediaItems`, {
      method: "POST",
      body: JSON.stringify({ mediaItemIds }),
    });
  }

  async removeMediaFromAlbum(
    email: string,
    albumId: string,
    mediaItemIds: string[]
  ): Promise<void> {
    await this.fetch(email, `/albums/${albumId}:batchRemoveMediaItems`, {
      method: "POST",
      body: JSON.stringify({ mediaItemIds }),
    });
  }

  // === Media Items ===

  async listMediaItems(
    email: string,
    pageSize = 100,
    pageToken?: string
  ): Promise<{ mediaItems: MediaItem[]; nextPageToken?: string }> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);

    const result = (await this.fetch(email, `/mediaItems?${params}`)) as {
      mediaItems?: MediaItem[];
      nextPageToken?: string;
    };
    return {
      mediaItems: result.mediaItems || [],
      nextPageToken: result.nextPageToken,
    };
  }

  async getMediaItem(email: string, mediaItemId: string): Promise<MediaItem> {
    return (await this.fetch(email, `/mediaItems/${mediaItemId}`)) as MediaItem;
  }

  async searchMediaItems(
    email: string,
    filters?: SearchFilters,
    albumId?: string,
    pageSize = 100,
    pageToken?: string
  ): Promise<{ mediaItems: MediaItem[]; nextPageToken?: string }> {
    const body: Record<string, unknown> = { pageSize };
    if (filters) body.filters = filters;
    if (albumId) body.albumId = albumId;
    if (pageToken) body.pageToken = pageToken;

    const result = (await this.fetch(email, "/mediaItems:search", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { mediaItems?: MediaItem[]; nextPageToken?: string };

    return {
      mediaItems: result.mediaItems || [],
      nextPageToken: result.nextPageToken,
    };
  }

  // === Upload ===

  async uploadMedia(
    email: string,
    filePath: string,
    description?: string
  ): Promise<MediaItem> {
    const client = await this.getClient(email);
    const { token } = await client.getAccessToken();

    const filename = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = this.getMimeType(filename);

    // Step 1: Upload bytes
    const uploadResponse = await fetch(`${API_BASE}/uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "X-Goog-Upload-Content-Type": mimeType,
        "X-Goog-Upload-Protocol": "raw",
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${await uploadResponse.text()}`);
    }

    const uploadToken = await uploadResponse.text();

    // Step 2: Create media item
    const createResult = (await this.fetch(email, "/mediaItems:batchCreate", {
      method: "POST",
      body: JSON.stringify({
        newMediaItems: [
          {
            description: description || filename,
            simpleMediaItem: { fileName: filename, uploadToken },
          },
        ],
      }),
    })) as { newMediaItemResults: Array<{ mediaItem: MediaItem }> };

    return createResult.newMediaItemResults[0].mediaItem;
  }

  async uploadToAlbum(
    email: string,
    filePath: string,
    albumId: string,
    description?: string
  ): Promise<MediaItem> {
    const client = await this.getClient(email);
    const { token } = await client.getAccessToken();

    const filename = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = this.getMimeType(filename);

    // Step 1: Upload bytes
    const uploadResponse = await fetch(`${API_BASE}/uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "X-Goog-Upload-Content-Type": mimeType,
        "X-Goog-Upload-Protocol": "raw",
      },
      body: fileBuffer,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${await uploadResponse.text()}`);
    }

    const uploadToken = await uploadResponse.text();

    // Step 2: Create media item in album
    const createResult = (await this.fetch(email, "/mediaItems:batchCreate", {
      method: "POST",
      body: JSON.stringify({
        albumId,
        newMediaItems: [
          {
            description: description || filename,
            simpleMediaItem: { fileName: filename, uploadToken },
          },
        ],
      }),
    })) as { newMediaItemResults: Array<{ mediaItem: MediaItem }> };

    return createResult.newMediaItemResults[0].mediaItem;
  }

  // === Download ===

  async downloadMedia(
    email: string,
    mediaItemId: string,
    outputPath: string
  ): Promise<string> {
    const mediaItem = await this.getMediaItem(email, mediaItemId);

    // Construct download URL with dimensions
    const isVideo = mediaItem.mimeType.startsWith("video/");
    const downloadUrl = isVideo
      ? `${mediaItem.baseUrl}=dv`
      : `${mediaItem.baseUrl}=d`;

    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const finalPath = outputPath.endsWith("/")
      ? path.join(outputPath, mediaItem.filename)
      : outputPath;

    fs.writeFileSync(finalPath, buffer);
    return finalPath;
  }

  // === Shared Albums ===

  async listSharedAlbums(
    email: string,
    pageSize = 50,
    pageToken?: string
  ): Promise<{ sharedAlbums: Album[]; nextPageToken?: string }> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);

    const result = (await this.fetch(email, `/sharedAlbums?${params}`)) as {
      sharedAlbums?: Album[];
      nextPageToken?: string;
    };
    return {
      sharedAlbums: result.sharedAlbums || [],
      nextPageToken: result.nextPageToken,
    };
  }

  async shareAlbum(
    email: string,
    albumId: string,
    isCollaborative = false,
    isCommentable = true
  ): Promise<{ shareableUrl: string; shareToken: string }> {
    const result = (await this.fetch(email, `/albums/${albumId}:share`, {
      method: "POST",
      body: JSON.stringify({
        sharedAlbumOptions: { isCollaborative, isCommentable },
      }),
    })) as { shareInfo: { shareableUrl: string; shareToken: string } };
    return result.shareInfo;
  }

  async joinSharedAlbum(email: string, shareToken: string): Promise<Album> {
    const result = (await this.fetch(email, "/sharedAlbums:join", {
      method: "POST",
      body: JSON.stringify({ shareToken }),
    })) as { album: Album };
    return result.album;
  }

  async leaveSharedAlbum(email: string, shareToken: string): Promise<void> {
    await this.fetch(email, "/sharedAlbums:leave", {
      method: "POST",
      body: JSON.stringify({ shareToken }),
    });
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".heic": "image/heic",
      ".heif": "image/heif",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".mkv": "video/x-matroska",
      ".webm": "video/webm",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }
}
