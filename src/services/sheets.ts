// ABOUTME: Google Sheets service for spreadsheet operations
// ABOUTME: Read, write, append values, manage spreadsheets and sheets

import { OAuth2Client } from "google-auth-library";
import { google, sheets_v4 } from "googleapis";
import { AccountStorage } from "../account-storage.js";

export class SheetsService {
  private sheetsClients = new Map<string, sheets_v4.Sheets>();

  constructor(private accountStorage: AccountStorage) {}

  private getClient(email: string): sheets_v4.Sheets {
    if (!this.sheetsClients.has(email)) {
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

      const sheets = google.sheets({ version: "v4", auth: oauth2Client });
      this.sheetsClients.set(email, sheets);
    }
    return this.sheetsClients.get(email)!;
  }

  async getSpreadsheet(email: string, spreadsheetId: string): Promise<SpreadsheetInfo> {
    const sheets = this.getClient(email);
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const data = response.data;
    return {
      id: data.spreadsheetId!,
      title: data.properties?.title || "",
      locale: data.properties?.locale,
      timeZone: data.properties?.timeZone,
      sheets: (data.sheets || []).map((s) => ({
        id: s.properties?.sheetId || 0,
        title: s.properties?.title || "",
        index: s.properties?.index || 0,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      })),
      url: data.spreadsheetUrl,
    };
  }

  async readValues(
    email: string,
    spreadsheetId: string,
    range: string
  ): Promise<CellValue[][]> {
    const sheets = this.getClient(email);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return (response.data.values || []) as CellValue[][];
  }

  async writeValues(
    email: string,
    spreadsheetId: string,
    range: string,
    values: CellValue[][]
  ): Promise<UpdateResult> {
    const sheets = this.getClient(email);
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    return {
      updatedRange: response.data.updatedRange || "",
      updatedRows: response.data.updatedRows || 0,
      updatedColumns: response.data.updatedColumns || 0,
      updatedCells: response.data.updatedCells || 0,
    };
  }

  async appendValues(
    email: string,
    spreadsheetId: string,
    range: string,
    values: CellValue[][]
  ): Promise<AppendResult> {
    const sheets = this.getClient(email);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    return {
      updatedRange: response.data.updates?.updatedRange || "",
      updatedRows: response.data.updates?.updatedRows || 0,
      updatedCells: response.data.updates?.updatedCells || 0,
    };
  }

  async clearValues(
    email: string,
    spreadsheetId: string,
    range: string
  ): Promise<string> {
    const sheets = this.getClient(email);
    const response = await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    });

    return response.data.clearedRange || "";
  }

  async createSpreadsheet(
    email: string,
    title: string,
    sheetTitles?: string[]
  ): Promise<SpreadsheetInfo> {
    const sheets = this.getClient(email);

    const sheetsConfig = sheetTitles?.map((t, i) => ({
      properties: { title: t, index: i },
    }));

    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: sheetsConfig || [{ properties: { title: "Sheet1" } }],
      },
    });

    const data = response.data;
    return {
      id: data.spreadsheetId!,
      title: data.properties?.title || "",
      sheets: (data.sheets || []).map((s) => ({
        id: s.properties?.sheetId || 0,
        title: s.properties?.title || "",
        index: s.properties?.index || 0,
      })),
      url: data.spreadsheetUrl,
    };
  }

  async addSheet(
    email: string,
    spreadsheetId: string,
    title: string
  ): Promise<SheetInfo> {
    const sheets = this.getClient(email);
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title },
            },
          },
        ],
      },
    });

    const addedSheet = response.data.replies?.[0]?.addSheet?.properties;
    return {
      id: addedSheet?.sheetId || 0,
      title: addedSheet?.title || "",
      index: addedSheet?.index || 0,
    };
  }

  async deleteSheet(
    email: string,
    spreadsheetId: string,
    sheetId: number
  ): Promise<void> {
    const sheets = this.getClient(email);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteSheet: { sheetId },
          },
        ],
      },
    });
  }

  async renameSheet(
    email: string,
    spreadsheetId: string,
    sheetId: number,
    newTitle: string
  ): Promise<void> {
    const sheets = this.getClient(email);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, title: newTitle },
              fields: "title",
            },
          },
        ],
      },
    });
  }

  getSpreadsheetUrl(spreadsheetId: string): string {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  }
}

export type CellValue = string | number | boolean | null;

export interface SpreadsheetInfo {
  id: string;
  title: string;
  locale?: string | null;
  timeZone?: string | null;
  sheets: SheetInfo[];
  url?: string | null;
}

export interface SheetInfo {
  id: number;
  title: string;
  index: number;
  rowCount?: number | null;
  columnCount?: number | null;
}

export interface UpdateResult {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

export interface AppendResult {
  updatedRange: string;
  updatedRows: number;
  updatedCells: number;
}
