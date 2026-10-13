import type { StayFilters } from "./filters.ts";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  listingIds?: string[];
}

export interface AssistantConversation {
  messages: AssistantMessage[];
  preferences: StayFilters;
}
