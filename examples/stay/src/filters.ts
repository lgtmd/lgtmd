import type { Listing } from "./domain.ts";

export interface StayFilters {
  query: string;
  minPrice: number | null;
  maxPrice: number | null;
  guests: number;
  amenities: string[];
}

export function defaultFilters(): StayFilters {
  return {
    query: "",
    minPrice: null,
    maxPrice: null,
    guests: 1,
    amenities: [],
  };
}

export function filterListings(
  listings: readonly Listing[],
  filters: StayFilters,
): Listing[] {
  const query = filters.query.trim().toLowerCase();
  return listings.filter(
    (listing) =>
      (!query ||
        listing.title.toLowerCase().includes(query) ||
        listing.location.toLowerCase().includes(query)) &&
      (filters.minPrice === null || listing.nightlyRate >= filters.minPrice) &&
      (filters.maxPrice === null || listing.nightlyRate <= filters.maxPrice) &&
      listing.capacity >= filters.guests &&
      filters.amenities.every((amenity) => listing.amenities.includes(amenity)),
  );
}

export function validateFilters(filters: StayFilters): string | undefined {
  if (
    (filters.minPrice !== null &&
      (!Number.isFinite(filters.minPrice) || filters.minPrice < 0)) ||
    (filters.maxPrice !== null &&
      (!Number.isFinite(filters.maxPrice) || filters.maxPrice < 0))
  ) {
    return "Enter a price of zero or more.";
  }
  if (
    filters.minPrice !== null &&
    filters.maxPrice !== null &&
    filters.minPrice > filters.maxPrice
  ) {
    return "Maximum price must be at least the minimum price.";
  }
  if (!Number.isSafeInteger(filters.guests) || filters.guests < 1) {
    return "Choose a whole number of guests, at least one.";
  }
  return undefined;
}

function readPrice(value: string | null): number | null {
  if (
    value === null ||
    !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  ) {
    return null;
  }
  const price = Number(value);
  return Number.isFinite(price) ? price : null;
}

function uniqueAmenities(amenities: readonly string[]): string[] {
  return [
    ...new Set(amenities.map((amenity) => amenity.trim()).filter(Boolean)),
  ];
}

export function readFilters(search: string): StayFilters {
  const params = new URLSearchParams(search);
  const guestValue = params.get("guests")?.trim() ?? "";
  const guests = /^\d+$/.test(guestValue) ? Number(guestValue) : 1;
  return {
    query: params.get("q")?.trim() ?? "",
    minPrice: readPrice(params.get("min")),
    maxPrice: readPrice(params.get("max")),
    guests: Number.isSafeInteger(guests) && guests > 0 ? guests : 1,
    amenities: uniqueAmenities(params.getAll("amenity")),
  };
}

export function filterSearchParams(filters: StayFilters): URLSearchParams {
  const params = new URLSearchParams();
  const query = filters.query.trim();
  if (query) params.set("q", query);
  if (filters.minPrice !== null) params.set("min", String(filters.minPrice));
  if (filters.maxPrice !== null) params.set("max", String(filters.maxPrice));
  if (filters.guests !== 1) params.set("guests", String(filters.guests));
  for (const amenity of uniqueAmenities(filters.amenities).sort()) {
    params.append("amenity", amenity);
  }
  return params;
}

export function countFilters(filters: StayFilters): number {
  return (
    Number(filters.minPrice !== null || filters.maxPrice !== null) +
    Number(filters.guests > 1) +
    uniqueAmenities(filters.amenities).length
  );
}
