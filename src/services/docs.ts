// ABOUTME: Google Docs service for document operations
// ABOUTME: Create, read, update documents and export to various formats

import { OAuth2Client } from "google-auth-library";
import { google, docs_v1 } from "googleapis";
import { AccountStorage } from "../account-storage.js";

export class DocsService {
  private docsClients = new Map<string, docs_v1.Docs>();

  constructor(private accountStorage: AccountStorage) {}

  private getClient(email: string): docs_v1.Docs {
    if (!this.docsClients.has(email)) {
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

      const docs = google.docs({ version: "v1", auth: oauth2Client });
      this.docsClients.set(email, docs);
    }
    return this.docsClients.get(email)!;
  }

  async getDocument(email: string, documentId: string): Promise<DocumentInfo> {
    const docs = this.getClient(email);
    const response = await docs.documents.get({ documentId });
    const doc = response.data;

    return {
      id: doc.documentId!,
      title: doc.title || "",
      body: this.extractText(doc.body),
      revisionId: doc.revisionId,
    };
  }

  async createDocument(email: string, title: string, content?: string): Promise<DocumentInfo> {
    const docs = this.getClient(email);

    // Create empty document
    const createResponse = await docs.documents.create({
      requestBody: { title },
    });

    const documentId = createResponse.data.documentId!;

    // Add content if provided
    if (content) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      });
    }

    return {
      id: documentId,
      title,
      body: content || "",
    };
  }

  async appendText(email: string, documentId: string, text: string): Promise<void> {
    const docs = this.getClient(email);

    // Get document to find end index
    const doc = await docs.documents.get({ documentId });
    const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: endIndex - 1 },
              text: text,
            },
          },
        ],
      },
    });
  }

  async replaceText(
    email: string,
    documentId: string,
    searchText: string,
    replaceText: string,
    matchCase = false
  ): Promise<number> {
    const docs = this.getClient(email);

    const response = await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: {
                text: searchText,
                matchCase,
              },
              replaceText,
            },
          },
        ],
      },
    });

    return response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
  }

  async insertText(email: string, documentId: string, index: number, text: string): Promise<void> {
    const docs = this.getClient(email);

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index },
              text,
            },
          },
        ],
      },
    });
  }

  async deleteContent(email: string, documentId: string, startIndex: number, endIndex: number): Promise<void> {
    const docs = this.getClient(email);

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            deleteContentRange: {
              range: { startIndex, endIndex },
            },
          },
        ],
      },
    });
  }

  getDocumentUrl(documentId: string): string {
    return `https://docs.google.com/document/d/${documentId}/edit`;
  }

  private extractText(body: docs_v1.Schema$Body | undefined): string {
    if (!body?.content) return "";

    let text = "";
    for (const element of body.content) {
      if (element.paragraph?.elements) {
        for (const elem of element.paragraph.elements) {
          if (elem.textRun?.content) {
            text += elem.textRun.content;
          }
        }
      }
      if (element.table) {
        for (const row of element.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            text += this.extractText(cell as docs_v1.Schema$Body);
          }
        }
      }
    }
    return text;
  }
}

export interface DocumentInfo {
  id: string;
  title: string;
  body: string;
  revisionId?: string | null;
}
