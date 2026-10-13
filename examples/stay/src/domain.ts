export type Role = "guest" | "host";

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export interface DemoSession {
  token: string;
  actor: Actor;
}

export interface Sessions {
  guest: DemoSession;
  host: DemoSession;
}

export interface Listing {
  id: string;
  title: string;
  location: string;
  description: string;
  image: string;
  imageAlt: string;
  nightlyRate: number;
  capacity: number;
  bedrooms: number;
  beds: number;
  amenities: string[];
  hostName: string;
}

export interface Message {
  id: string;
  sender: Role;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface StayRequest {
  id: string;
  listingId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  status: "pending" | "accepted";
  createdAt: string;
  messages: Message[];
}

export interface RequestInput {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  message: string;
}

export type ReplyEvent =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

// Browser fixtures install these sessions before loading the app. Interactive
// visitors get an isolated demo workspace from POST /api/demo instead.
export const SESSION_KEY = "stay.sessions";
export const ROLE_KEY = "stay.role";
