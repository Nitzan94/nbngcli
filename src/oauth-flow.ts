// ABOUTME: OAuth flow for Google APIs with combined scopes
// ABOUTME: Supports Gmail, Calendar, and Drive in single authorization

import { spawn } from "child_process";
import * as http from "http";
import * as readline from "readline";
import * as url from "url";
import { OAuth2Client } from "google-auth-library";

// Combined scopes for all three services (full access)
const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
];

const TIMEOUT_MS = 2 * 60 * 1000;

interface AuthResult {
  success: boolean;
  refreshToken?: string;
  error?: string;
}

export class OAuthFlow {
  private oauth2Client: OAuth2Client;
  private server: http.Server | null = null;
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.oauth2Client = new OAuth2Client(clientId, clientSecret);
  }

  async authorize(manual = false): Promise<string> {
    const result = manual ? await this.startManualFlow() : await this.startAuthFlow();
    if (!result.success) {
      throw new Error(result.error || "Authorization failed");
    }
    if (!result.refreshToken) {
      throw new Error("No refresh token received");
    }
    return result.refreshToken;
  }

  private async startManualFlow(): Promise<AuthResult> {
    const redirectUri = "http://localhost:1";
    this.oauth2Client = new OAuth2Client(
      (this.oauth2Client as unknown as { _clientId: string })._clientId,
      (this.oauth2Client as unknown as { _clientSecret: string })._clientSecret,
      redirectUri
    );

    // Build URL manually with proper encoding
    const clientId = (this.oauth2Client as unknown as { _clientId: string })._clientId;
    const scopeStr = SCOPES.map(s => encodeURIComponent(s)).join("%20");
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopeStr}&access_type=offline&prompt=consent`;

    console.log("Visit this URL to authorize:");
    console.log(authUrl);
    console.log("");
    console.log("After authorizing, you'll be redirected to a page that won't load.");
    console.log("Copy the URL from your browser's address bar and paste it here.");
    console.log("");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
      rl.question("Paste redirect URL: ", async (input) => {
        rl.close();
        try {
          const parsed = url.parse(input, true);
          const code = parsed.query.code as string;
          if (!code) {
            resolve({ success: false, error: "No authorization code found in URL" });
            return;
          }
          const { tokens } = await this.oauth2Client.getToken(code);
          resolve({ success: true, refreshToken: tokens.refresh_token || undefined });
        } catch (e) {
          resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
      });
    });
  }

  private startAuthFlow(): Promise<AuthResult> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const parsed = url.parse(req.url || "", true);
        if (parsed.pathname === "/") {
          this.handleCallback(parsed.query, res, resolve);
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.listen(0, "localhost", () => {
        const addr = this.server!.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const redirectUri = `http://localhost:${port}`;

        this.oauth2Client = new OAuth2Client(
          (this.oauth2Client as unknown as { _clientId: string })._clientId,
          (this.oauth2Client as unknown as { _clientSecret: string })._clientSecret,
          redirectUri
        );

        // Build URL manually with proper encoding
        const clientId = (this.oauth2Client as unknown as { _clientId: string })._clientId;
        const scopeStr = SCOPES.map(s => encodeURIComponent(s)).join("%20");
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopeStr}&access_type=offline&prompt=consent`;

        console.log("Opening browser for authorization...");
        console.log("If browser doesn't open, visit this URL:");
        console.log(authUrl);

        this.openBrowser(authUrl);

        this.timeoutId = setTimeout(() => {
          console.log("Authorization timed out after 2 minutes");
          this.cleanup();
          resolve({ success: false, error: "Authorization timed out" });
        }, TIMEOUT_MS);
      });

      this.server.on("error", (err) => {
        this.cleanup();
        resolve({ success: false, error: err.message });
      });
    });
  }

  private async handleCallback(
    query: url.UrlWithParsedQuery["query"],
    res: http.ServerResponse,
    resolve: (result: AuthResult) => void
  ): Promise<void> {
    if (query.error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Authorization cancelled</h1></body></html>");
      this.cleanup();
      resolve({ success: false, error: query.error as string });
      return;
    }

    if (!query.code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<html><body><h1>No authorization code</h1></body></html>");
      this.cleanup();
      resolve({ success: false, error: "No authorization code" });
      return;
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(query.code as string);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>");
      this.cleanup();
      resolve({ success: true, refreshToken: tokens.refresh_token || undefined });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<html><body><h1>Error</h1><p>${e instanceof Error ? e.message : e}</p></body></html>`);
      this.cleanup();
      resolve({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private cleanup(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private openBrowser(url: string): void {
    let cmd: string;
    let args: string[];

    if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (process.platform === "win32") {
      // Use cmd /c start with empty title - more reliable for complex URLs
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  }
}
