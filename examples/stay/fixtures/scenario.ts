import type { Actor, Listing, RequestInput } from "../src/domain.ts";

export const FIXED_TIME = "2026-10-14T12:00:00.000Z";

export const actors: Record<"guest" | "host", Actor> = {
  guest: { id: "guest-alex", name: "Alex Morgan", role: "guest" },
  host: { id: "host-maya", name: "Maya Chen", role: "host" },
};

export const listings: Listing[] = [
  {
    id: "cedar-house",
    title: "Cedar House",
    location: "Hudson Valley, New York",
    description:
      "A quiet cedar retreat beside the woods. Slow mornings, a sunny reading corner, and the trail just beyond the garden gate.",
    image: "/images/cedar-house.webp",
    imageAlt: "Cedar-clad house and deck among autumn trees",
    nightlyRate: 185,
    capacity: 4,
    bedrooms: 2,
    beds: 2,
    amenities: ["Woodland trails", "Full kitchen", "Wi-Fi", "Free parking"],
    hostName: actors.host.name,
  },
  {
    id: "courtyard-loft",
    title: "Courtyard Loft",
    location: "Portland, Oregon",
    description:
      "A light-filled loft wrapped around a leafy courtyard. Coffee shops and neighborhood bookstores are an easy walk away.",
    image: "/images/courtyard-loft.webp",
    imageAlt: "Leafy private courtyard outside a sunlit brick loft",
    nightlyRate: 142,
    capacity: 2,
    bedrooms: 1,
    beds: 1,
    amenities: ["Private courtyard", "Full kitchen", "Wi-Fi", "Workspace"],
    hostName: actors.host.name,
  },
  {
    id: "coast-cabin",
    title: "Coast Cabin",
    location: "Mendocino, California",
    description:
      "A small coastal hideaway with an ocean-facing deck. Open the windows, make a pot of tea, and settle into the sea air.",
    image: "/images/coast-cabin.webp",
    imageAlt: "Weathered timber cabin and deck above the Pacific coast",
    nightlyRate: 210,
    capacity: 3,
    bedrooms: 1,
    beds: 2,
    amenities: ["Ocean view", "Private deck", "Full kitchen", "Free parking"],
    hostName: actors.host.name,
  },
];

export const stayInput: RequestInput = {
  listingId: "cedar-house",
  checkIn: "2026-11-06",
  checkOut: "2026-11-09",
  guests: 2,
  message:
    "Hi Maya, we are planning a quiet weekend. Is there a good walking trail nearby?",
};

export const replyScripts = {
  A: [
    "Hi Alex, Cedar House would be lovely for your quiet weekend. ",
    "The woodland trail starts just beyond the garden gate, ",
    "and I can leave a walking map for you. Looking forward to welcoming you!",
  ],
  B: [
    "Hi Alex, Cedar House is a peaceful base for your weekend. ",
    "The riverside loop is a ten-minute walk from the house, ",
    "and I can share my favorite picnic spot. Looking forward to welcoming you!",
  ],
} as const;

export const hostEdit = " Check-in is available from 3 pm.";
