// ABOUTME: Google Calendar service for event management
// ABOUTME: List calendars, events, create/update/delete, check availability

import { OAuth2Client } from "google-auth-library";
import { google, calendar_v3 } from "googleapis";
import { AccountStorage } from "../account-storage.js";

export class CalendarService {
  private calendarClients = new Map<string, calendar_v3.Calendar>();

  constructor(private accountStorage: AccountStorage) {}

  private getClient(email: string): calendar_v3.Calendar {
    if (!this.calendarClients.has(email)) {
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

      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      this.calendarClients.set(email, calendar);
    }
    return this.calendarClients.get(email)!;
  }

  async listCalendars(email: string): Promise<CalendarInfo[]> {
    const calendar = this.getClient(email);
    const response = await calendar.calendarList.list();
    return (response.data.items || []).map((c) => ({
      id: c.id!,
      name: c.summary || c.id!,
      role: c.accessRole || "",
    }));
  }

  async getCalendarAcl(email: string, calendarId: string): Promise<AclEntry[]> {
    const calendar = this.getClient(email);
    const response = await calendar.acl.list({ calendarId });
    return (response.data.items || []).map((a) => ({
      id: a.id!,
      role: a.role!,
      scope: {
        type: a.scope?.type || "",
        value: a.scope?.value,
      },
    }));
  }

  async listEvents(
    email: string,
    calendarId: string,
    options: EventListOptions = {}
  ): Promise<{ events: EventInfo[]; nextPageToken?: string }> {
    const calendar = this.getClient(email);
    const response = await calendar.events.list({
      calendarId,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults || 10,
      pageToken: options.pageToken,
      q: options.query,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (response.data.items || []).map((e) => ({
      id: e.id!,
      summary: e.summary || "(No title)",
      description: e.description,
      location: e.location,
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      allDay: !e.start?.dateTime,
      status: e.status || "",
      htmlLink: e.htmlLink,
    }));

    return { events, nextPageToken: response.data.nextPageToken || undefined };
  }

  async getEvent(email: string, calendarId: string, eventId: string): Promise<EventInfo> {
    const calendar = this.getClient(email);
    const response = await calendar.events.get({ calendarId, eventId });
    const e = response.data;

    return {
      id: e.id!,
      summary: e.summary || "(No title)",
      description: e.description,
      location: e.location,
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      allDay: !e.start?.dateTime,
      status: e.status || "",
      htmlLink: e.htmlLink,
      attendees: e.attendees?.map((a) => ({
        email: a.email!,
        responseStatus: a.responseStatus,
      })),
    };
  }

  async createEvent(email: string, calendarId: string, event: CreateEventInput): Promise<EventInfo> {
    const calendar = this.getClient(email);

    const eventBody: calendar_v3.Schema$Event = {
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.allDay ? { date: event.start } : { dateTime: event.start },
      end: event.allDay ? { date: event.end } : { dateTime: event.end },
      attendees: event.attendees?.map((e) => ({ email: e })),
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: eventBody,
    });

    const e = response.data;
    return {
      id: e.id!,
      summary: e.summary || "",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      allDay: !e.start?.dateTime,
      status: e.status || "",
      htmlLink: e.htmlLink,
    };
  }

  async updateEvent(
    email: string,
    calendarId: string,
    eventId: string,
    updates: UpdateEventInput
  ): Promise<EventInfo> {
    const calendar = this.getClient(email);
    const existing = await calendar.events.get({ calendarId, eventId });

    const eventBody: calendar_v3.Schema$Event = {
      ...existing.data,
      summary: updates.summary ?? existing.data.summary,
      description: updates.description ?? existing.data.description,
      location: updates.location ?? existing.data.location,
    };

    if (updates.start !== undefined) {
      eventBody.start = updates.allDay ? { date: updates.start } : { dateTime: updates.start };
    }
    if (updates.end !== undefined) {
      eventBody.end = updates.allDay ? { date: updates.end } : { dateTime: updates.end };
    }
    if (updates.attendees !== undefined) {
      eventBody.attendees = updates.attendees.map((e) => ({ email: e }));
    }

    const response = await calendar.events.update({
      calendarId,
      eventId,
      requestBody: eventBody,
    });

    const e = response.data;
    return {
      id: e.id!,
      summary: e.summary || "",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      allDay: !e.start?.dateTime,
      status: e.status || "",
      htmlLink: e.htmlLink,
    };
  }

  async deleteEvent(email: string, calendarId: string, eventId: string): Promise<void> {
    const calendar = this.getClient(email);
    await calendar.events.delete({ calendarId, eventId });
  }

  async getFreeBusy(
    email: string,
    calendarIds: string[],
    timeMin: string,
    timeMax: string
  ): Promise<Map<string, BusyPeriod[]>> {
    const calendar = this.getClient(email);
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const result = new Map<string, BusyPeriod[]>();
    const calendars = response.data.calendars || {};

    for (const [calId, data] of Object.entries(calendars)) {
      const busy = (data.busy || []).map((b) => ({
        start: b.start || "",
        end: b.end || "",
      }));
      result.set(calId, busy);
    }

    return result;
  }
}

export interface CalendarInfo {
  id: string;
  name: string;
  role: string;
}

export interface AclEntry {
  id: string;
  role: string;
  scope: { type: string; value?: string };
}

export interface EventInfo {
  id: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  htmlLink?: string | null;
  attendees?: { email: string; responseStatus?: string | null }[];
}

export interface EventListOptions {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  pageToken?: string;
  query?: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  attendees?: string[];
}

export interface UpdateEventInput {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  attendees?: string[];
}

export interface BusyPeriod {
  start: string;
  end: string;
}
