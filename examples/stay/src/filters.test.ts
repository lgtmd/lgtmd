import assert from "node:assert/strict";
import test from "node:test";
import { listings } from "../fixtures/scenario.ts";
import {
  countFilters,
  defaultFilters,
  filterListings,
  filterSearchParams,
  readFilters,
  validateFilters,
} from "./filters.ts";

test("nightly prices include both boundaries and can be individually unbounded", () => {
  assert.deepEqual(
    filterListings(listings, {
      ...defaultFilters(),
      minPrice: 142,
      maxPrice: 185,
    }).map((listing) => listing.id),
    ["cedar-house", "courtyard-loft"],
  );
  assert.deepEqual(
    filterListings(listings, {
      ...defaultFilters(),
      minPrice: 210,
    }).map((listing) => listing.id),
    ["coast-cabin"],
  );
  assert.deepEqual(
    filterListings(listings, {
      ...defaultFilters(),
      maxPrice: 142,
    }).map((listing) => listing.id),
    ["courtyard-loft"],
  );
  assert.deepEqual(
    filterListings(listings, { ...defaultFilters(), maxPrice: 0 }),
    [],
  );
});

test("capacity and every selected amenity are required together", () => {
  assert.deepEqual(
    filterListings(listings, {
      ...defaultFilters(),
      guests: 3,
      amenities: ["Full kitchen", "Free parking"],
    }).map((listing) => listing.id),
    ["cedar-house", "coast-cabin"],
  );
  assert.deepEqual(
    filterListings(listings, {
      ...defaultFilters(),
      guests: 3,
      amenities: ["Wi-Fi", "Free parking"],
    }).map((listing) => listing.id),
    ["cedar-house"],
  );
  assert.deepEqual(
    filterListings(listings, {
      ...defaultFilters(),
      guests: 3,
      amenities: ["Workspace"],
    }),
    [],
  );
});

test("search trims whitespace and matches title or location without case sensitivity", () => {
  for (const query of ["  cEdAr  ", "  HUDSON valley  "]) {
    assert.deepEqual(
      filterListings(listings, { ...defaultFilters(), query }).map(
        (listing) => listing.id,
      ),
      ["cedar-house"],
    );
  }
  assert.equal(
    filterListings(listings, { ...defaultFilters(), query: "  " }).length,
    3,
  );
  assert.deepEqual(
    filterListings(listings, { ...defaultFilters(), query: "sunny" }),
    [],
    "description text is outside the declared title/location search",
  );
});

test("default filters are fresh and filtering never mutates input or fixture order", () => {
  const first = defaultFilters();
  const second = defaultFilters();
  first.amenities.push("Wi-Fi");
  assert.deepEqual(second.amenities, []);
  const beforeListings = structuredClone(listings);
  const beforeFilters = structuredClone(first);
  const result = filterListings(listings, first);
  assert.deepEqual(listings, beforeListings);
  assert.deepEqual(first, beforeFilters);
  assert.deepEqual(
    result.map((listing) => listing.id),
    ["cedar-house", "courtyard-loft"],
  );
  assert.notEqual(result, listings);
  assert.equal(result[0], listings[0]);
});

test("validation rejects invalid prices and reversed ranges without changing them", () => {
  assert.equal(validateFilters(defaultFilters()), undefined);
  assert.equal(
    validateFilters({ ...defaultFilters(), minPrice: 0, maxPrice: 0 }),
    undefined,
  );
  for (const price of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    for (const field of ["minPrice", "maxPrice"] as const) {
      assert.match(
        validateFilters({ ...defaultFilters(), [field]: price }) ?? "",
        /price/i,
      );
    }
  }
  const reversed = { ...defaultFilters(), minPrice: 200, maxPrice: 100 };
  assert.match(validateFilters(reversed) ?? "", /maximum/i);
  assert.equal(reversed.minPrice, 200);
  assert.equal(reversed.maxPrice, 100);
  for (const guests of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.match(
      validateFilters({ ...defaultFilters(), guests }) ?? "",
      /guests/i,
    );
  }
});

test("URL filters round-trip reserved characters with stable unique amenity order", () => {
  const filters = {
    query: "  Cedar & Coast +  ",
    minPrice: 0,
    maxPrice: 210.5,
    guests: 3,
    amenities: ["Wi-Fi", " Full kitchen ", "Wi-Fi", ""],
  };
  const before = structuredClone(filters);
  const params = filterSearchParams(filters);
  assert.equal(
    params.toString(),
    "q=Cedar+%26+Coast+%2B&min=0&max=210.5&guests=3&amenity=Full+kitchen&amenity=Wi-Fi",
  );
  assert.deepEqual(readFilters(`?${params}`), {
    query: "Cedar & Coast +",
    minPrice: 0,
    maxPrice: 210.5,
    guests: 3,
    amenities: ["Full kitchen", "Wi-Fi"],
  });
  assert.deepEqual(filters, before);
  assert.equal(filterSearchParams(defaultFilters()).toString(), "");
});

test("malformed URL numbers sanitize individually while zero prices remain meaningful", () => {
  for (const value of ["", " ", "abc", "-1", "NaN", "Infinity", "0x10", "1e"]) {
    const params = new URLSearchParams({
      min: value,
      max: value,
      guests: value,
    });
    assert.deepEqual(readFilters(params.toString()), defaultFilters(), value);
  }
  assert.deepEqual(readFilters("min=0&max=0&guests=0"), {
    ...defaultFilters(),
    minPrice: 0,
    maxPrice: 0,
  });
  assert.deepEqual(readFilters("min=185&max=oops&guests=2.5"), {
    ...defaultFilters(),
    minPrice: 185,
  });
  assert.equal(readFilters("guests=2").guests, 2);
  assert.equal(readFilters("guests=9007199254740992").guests, 1);
  assert.equal(readFilters("guests=9007199254740993").guests, 1);
  assert.equal(
    readFilters(`guests=${Number.MAX_SAFE_INTEGER}`).guests,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(readFilters(`guests=${"9".repeat(400)}`).guests, 1);
  assert.equal(readFilters(`min=${"9".repeat(400)}`).minPrice, null);
});

test("finite exponent prices round-trip without losing very small or large bounds", () => {
  assert.deepEqual(readFilters("min=1e3&max=2E3&guests=1e3"), {
    ...defaultFilters(),
    minPrice: 1000,
    maxPrice: 2000,
  });
  for (const [minPrice, maxPrice] of [
    [1e-7, 1e21],
    [Number.MIN_VALUE, Number.MAX_VALUE],
  ]) {
    const filters = { ...defaultFilters(), minPrice, maxPrice };
    assert.equal(validateFilters(filters), undefined);
    assert.deepEqual(
      readFilters(filterSearchParams(filters).toString()),
      filters,
    );
  }
  assert.equal(readFilters("max=1e309").maxPrice, null);
});

test("URL parsing keeps reversed ranges visible and canonicalizes duplicate amenities", () => {
  const filters = readFilters(
    "q=first&q=second&min=210&min=100&max=142&guests=3&amenity=Wi-Fi&amenity=+&amenity=Wi-Fi&amenity=Full+kitchen",
  );
  assert.deepEqual(filters, {
    query: "first",
    minPrice: 210,
    maxPrice: 142,
    guests: 3,
    amenities: ["Wi-Fi", "Full kitchen"],
  });
  assert.match(validateFilters(filters) ?? "", /maximum/i);
  assert.equal(
    filterSearchParams(filters).toString(),
    "q=first&min=210&max=142&guests=3&amenity=Full+kitchen&amenity=Wi-Fi",
  );
});

test("filter count treats budget as one and excludes the external search query", () => {
  assert.equal(countFilters(defaultFilters()), 0);
  assert.equal(countFilters({ ...defaultFilters(), query: "Cedar" }), 0);
  assert.equal(countFilters({ ...defaultFilters(), maxPrice: 0 }), 1);
  assert.equal(
    countFilters({
      query: "Cedar",
      minPrice: 0,
      maxPrice: 200,
      guests: 3,
      amenities: ["Wi-Fi", "Full kitchen", "Wi-Fi"],
    }),
    4,
  );
});
