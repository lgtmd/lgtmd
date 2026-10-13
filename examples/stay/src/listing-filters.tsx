import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Car,
  Check,
  ChevronDown,
  CircleAlert,
  CookingPot,
  House,
  Laptop,
  Leaf,
  Search,
  SlidersHorizontal,
  Trees,
  Users,
  Waves,
  Wifi,
  X,
} from "lucide-react";
import type { Listing } from "./domain.ts";
import {
  countFilters,
  defaultFilters,
  filterListings,
  filterSearchParams,
  readFilters,
  validateFilters,
} from "./filters.ts";
import type { StayFilters } from "./filters.ts";
import "./listing-filters.css";

const price = (value: number) => `$${value.toLocaleString("en-US")}`;
const stayCount = (count: number) =>
  `${count} ${count === 1 ? "stay" : "stays"}`;
const filterParams = ["q", "min", "max", "guests", "amenity"];

function writeFilters(filters: StayFilters) {
  const url = new URL(window.location.href);
  for (const key of filterParams) url.searchParams.delete(key);
  for (const [key, value] of filterSearchParams(filters)) {
    url.searchParams.append(key, value);
  }
  window.history.replaceState(window.history.state, "", url);
}

function AmenityIcon({ name }: { name: string }) {
  const Icon = name.includes("Wi-Fi")
    ? Wifi
    : name.includes("kitchen")
      ? CookingPot
      : name.includes("parking")
        ? Car
        : name.includes("Workspace")
          ? Laptop
          : name.includes("trails")
            ? Trees
            : name.includes("Ocean")
              ? Waves
              : name.includes("courtyard")
                ? Leaf
                : House;
  return <Icon size={21} strokeWidth={1.65} aria-hidden="true" />;
}

function budgetLabel(filters: StayFilters): string {
  if (filters.minPrice !== null && filters.maxPrice !== null) {
    return `${price(filters.minPrice)}–${price(filters.maxPrice)} / night`;
  }
  if (filters.minPrice !== null)
    return `From ${price(filters.minPrice)} / night`;
  return `Up to ${price(filters.maxPrice!)} / night`;
}

export function ListingFilters({
  listings,
  children,
}: {
  listings: Listing[];
  children: (filtered: Listing[]) => ReactNode;
}) {
  const [applied, setApplied] = useState(() =>
    readFilters(window.location.search),
  );
  const [draft, setDraft] = useState<StayFilters>(() => defaultFilters());
  const [invalidPrices, setInvalidPrices] = useState({
    minPrice: false,
    maxPrice: false,
  });
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const minimumPriceRef = useRef<HTMLInputElement>(null);
  const maximumPriceRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const titleId = `${ids}-title`;
  const errorId = `${ids}-error`;
  const budgetHelpId = `${ids}-budget-help`;
  const guestId = `${ids}-guests`;
  const result = filterListings(listings, applied);
  const previewCount = filterListings(listings, draft).length;
  const error =
    invalidPrices.minPrice || invalidPrices.maxPrice
      ? "Enter a valid price of zero or more."
      : validateFilters(draft);
  const activeCount = countFilters(applied);
  const hasFilters = activeCount > 0 || Boolean(applied.query.trim());
  const amenities = [
    ...new Set(listings.flatMap((item) => item.amenities)),
  ].sort();
  const maximumGuests = Math.max(1, ...listings.map((item) => item.capacity));
  const minimumPrice = Math.min(...listings.map((item) => item.nightlyRate));
  const maximumPrice = Math.max(...listings.map((item) => item.nightlyRate));

  useEffect(() => {
    const update = () => setApplied(readFilters(window.location.search));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function replaceDraft(filters: StayFilters) {
    // Native number editors can retain invalid text while their value is empty.
    // Assigning the value explicitly clears that text on Reset and reopening.
    if (minimumPriceRef.current) {
      minimumPriceRef.current.value =
        filters.minPrice === null ? "" : String(filters.minPrice);
    }
    if (maximumPriceRef.current) {
      maximumPriceRef.current.value =
        filters.maxPrice === null ? "" : String(filters.maxPrice);
    }
    setInvalidPrices({ minPrice: false, maxPrice: false });
    setDraft(filters);
  }
  function readNativePriceValidity(
    field: "minPrice" | "maxPrice",
    input: HTMLInputElement,
  ) {
    const invalid = input.validity.badInput;
    setInvalidPrices((current) =>
      current[field] === invalid ? current : { ...current, [field]: invalid },
    );
  }
  function update(filters: StayFilters) {
    setApplied(filters);
    writeFilters(filters);
  }
  function dismiss() {
    dialogRef.current?.close();
    setOpen(false);
    openerRef.current?.focus({ preventScroll: true });
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (error) return;
    update(draft);
    dismiss();
  }
  function toggleAmenity(name: string) {
    setDraft((current) => ({
      ...current,
      amenities: current.amenities.includes(name)
        ? current.amenities.filter((amenity) => amenity !== name)
        : [...current.amenities, name],
    }));
  }

  return (
    <>
      <div
        className="stay-search-toolbar"
        role="search"
        aria-label="Find a stay"
      >
        <div className="stay-search-field">
          <Search size={20} strokeWidth={1.7} aria-hidden="true" />
          <div>
            <label htmlFor={`${ids}-search`}>Search stays</label>
            <input
              id={`${ids}-search`}
              type="search"
              autoComplete="off"
              placeholder="City, region, or stay"
              value={applied.query}
              onChange={(event) =>
                update({ ...applied, query: event.target.value })
              }
            />
          </div>
          {applied.query && (
            <button
              type="button"
              className="stay-search-clear"
              aria-label="Clear search"
              onClick={() => update({ ...applied, query: "" })}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="stay-filter-trigger"
          ref={openerRef}
          aria-haspopup="dialog"
          aria-controls={`${ids}-dialog`}
          aria-expanded={open}
          aria-label={
            activeCount ? `Filters, ${activeCount} active` : "Filters"
          }
          onClick={() => {
            replaceDraft({ ...applied, amenities: [...applied.amenities] });
            setOpen(true);
          }}
        >
          <SlidersHorizontal size={18} strokeWidth={1.7} aria-hidden="true" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="stay-filter-count">{activeCount}</span>
          )}
        </button>
      </div>
      {hasFilters && (
        <div className="stay-applied-filters" aria-label="Applied filters">
          {applied.query.trim() && (
            <FilterChip
              label={`“${applied.query.trim()}”`}
              removeLabel="Remove search filter"
              onRemove={() => update({ ...applied, query: "" })}
            />
          )}
          {(applied.minPrice !== null || applied.maxPrice !== null) && (
            <FilterChip
              label={budgetLabel(applied)}
              removeLabel="Remove price filter"
              onRemove={() =>
                update({ ...applied, minPrice: null, maxPrice: null })
              }
            />
          )}
          {applied.guests > 1 && (
            <FilterChip
              label={`${applied.guests} guests`}
              removeLabel="Remove guests filter"
              onRemove={() => update({ ...applied, guests: 1 })}
            />
          )}
          {applied.amenities.map((amenity) => (
            <FilterChip
              key={amenity}
              label={amenity}
              removeLabel={`Remove ${amenity}`}
              onRemove={() =>
                update({
                  ...applied,
                  amenities: applied.amenities.filter(
                    (value) => value !== amenity,
                  ),
                })
              }
            />
          ))}
          <button
            className="stay-clear-filters"
            onClick={() => update(defaultFilters())}
          >
            Clear all
          </button>
        </div>
      )}
      <div className="collection-heading stay-filter-results-heading">
        <h2>Places to make your own</h2>
        <span role="status" aria-live="polite" aria-atomic="true">
          {`${stayCount(result.length)}${hasFilters ? (result.length === 1 ? " matches your search" : " match your search") : ", thoughtfully chosen"}`}
        </span>
      </div>
      {result.length > 0 ? (
        children(result)
      ) : (
        <div className="stay-filter-empty">
          <Search size={27} strokeWidth={1.5} aria-hidden="true" />
          <h3>No stays match these filters</h3>
          <p>Try a broader price range, fewer amenities, or another place.</p>
          <button
            className="button secondary"
            onClick={() => update(defaultFilters())}
          >
            Clear all filters
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        id={`${ids}-dialog`}
        className="stay-filter-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            dismiss();
        }}
      >
        <form className="stay-filter-form" onSubmit={apply}>
          <header className="stay-filter-header">
            <div>
              <h2 id={titleId} ref={titleRef} tabIndex={-1}>
                Filters
              </h2>
              <p>A few details to find your kind of stay.</p>
            </div>
            <button
              type="button"
              className="stay-filter-close"
              aria-label="Close filters"
              onClick={dismiss}
            >
              <X size={19} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </header>
          <div className="stay-filter-body">
            <fieldset className="stay-filter-section">
              <legend>Nightly budget</legend>
              <p id={budgetHelpId} className="stay-filter-help">
                {listings.length
                  ? `${price(minimumPrice)}–${price(maximumPrice)} per night in this collection. Prices in USD.`
                  : "Prices per night, in USD."}
              </p>
              <div className="stay-price-fields">
                <label>
                  <span>Minimum price per night</span>
                  <div className="stay-price-input">
                    <span aria-hidden="true">$</span>
                    <input
                      ref={minimumPriceRef}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="No minimum"
                      value={draft.minPrice ?? ""}
                      onInput={(event) =>
                        readNativePriceValidity("minPrice", event.currentTarget)
                      }
                      aria-label="Minimum price per night"
                      aria-describedby={`${budgetHelpId}${error ? ` ${errorId}` : ""}`}
                      aria-invalid={Boolean(error)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          minPrice:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </label>
                <label>
                  <span>Maximum price per night</span>
                  <div className="stay-price-input">
                    <span aria-hidden="true">$</span>
                    <input
                      ref={maximumPriceRef}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="No maximum"
                      value={draft.maxPrice ?? ""}
                      onInput={(event) =>
                        readNativePriceValidity("maxPrice", event.currentTarget)
                      }
                      aria-label="Maximum price per night"
                      aria-describedby={`${budgetHelpId}${error ? ` ${errorId}` : ""}`}
                      aria-invalid={Boolean(error)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          maxPrice:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </label>
              </div>
              <div
                className="stay-price-error"
                id={errorId}
                role={error ? "alert" : undefined}
                aria-live="polite"
              >
                {error && (
                  <>
                    <CircleAlert size={15} aria-hidden="true" />
                    {error}
                  </>
                )}
              </div>
            </fieldset>
            <div className="stay-filter-section stay-guest-section">
              <div>
                <label htmlFor={guestId} className="stay-filter-legend">
                  <Users size={19} strokeWidth={1.65} aria-hidden="true" />
                  Guests
                </label>
                <p className="stay-filter-help">
                  Enough room for your whole group.
                </p>
              </div>
              <div className="stay-guest-select">
                <select
                  id={guestId}
                  value={draft.guests}
                  onChange={(event) =>
                    setDraft({ ...draft, guests: Number(event.target.value) })
                  }
                >
                  <option value={1}>Any group size</option>
                  {Array.from(
                    { length: maximumGuests - 1 },
                    (_, index) => index + 2,
                  ).map((guests) => (
                    <option key={guests} value={guests}>
                      {guests} guests
                    </option>
                  ))}
                  {draft.guests > maximumGuests && (
                    <option value={draft.guests}>{draft.guests} guests</option>
                  )}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
            </div>
            <fieldset className="stay-filter-section stay-amenity-section">
              <legend>The little things</legend>
              <p className="stay-filter-help">
                Stays must have every amenity you select.
              </p>
              <div className="stay-amenity-grid">
                {amenities.map((amenity) => (
                  <label className="stay-amenity-option" key={amenity}>
                    <input
                      type="checkbox"
                      checked={draft.amenities.includes(amenity)}
                      onChange={() => toggleAmenity(amenity)}
                    />
                    <AmenityIcon name={amenity} />
                    <span>{amenity}</span>
                    <span className="stay-amenity-check" aria-hidden="true">
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <footer className="stay-filter-footer">
            <button
              type="button"
              className="stay-filter-reset"
              onClick={() =>
                replaceDraft({ ...defaultFilters(), query: applied.query })
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="stay-filter-cancel"
              onClick={dismiss}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="stay-filter-apply"
              disabled={Boolean(error)}
            >
              Show {stayCount(previewCount)}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}

function FilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      className="stay-filter-chip"
      aria-label={removeLabel}
      onClick={onRemove}
    >
      <span>{label}</span>
      <X size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
