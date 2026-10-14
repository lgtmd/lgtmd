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
        className="stay-search-toolbar gap-3 flex items-stretch mb-6 max-[640px]:gap-2 max-[640px]:mb-5.5"
        role="search"
        aria-label="Find a stay"
      >
        <div className="stay-search-field py-3.25 px-4.5 gap-3.5 flex items-center min-h-18 border border-line rounded-xl bg-surface flex-1 min-w-0 [&_>_svg]:text-muted [&_input::-webkit-search-cancel-button]:hidden [&_input::placeholder]:text-muted max-[640px]:py-2.75 max-[640px]:px-3 max-[640px]:gap-2.5 max-[640px]:min-h-17 max-[640px]:[&_>_svg]:w-4.5">
          <Search size={20} strokeWidth={1.7} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <label
              className="block text-[13px] font-semibold leading-[1.5] mb-1"
              htmlFor={`${ids}-search`}
            >
              Search stays
            </label>
            <input
              className="p-0 border-0 bg-transparent block w-full min-w-0 text-ink text-sm leading-[1.5] appearance-none max-[640px]:text-base"
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
              className="stay-search-clear size-11 inline-flex items-center justify-center bg-transparent text-muted rounded-full shrink-0 hover:bg-[#edf0e7] hover:text-ink"
              aria-label="Clear search"
              onClick={() => update({ ...applied, query: "" })}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="stay-filter-trigger py-0 px-5.75 gap-2.5 inline-flex items-center justify-center bg-surface text-ink border border-line rounded-xl text-sm font-medium hover:border-[#8a9c87] hover:bg-[#f4f5ef] max-[640px]:py-2.5 max-[640px]:px-3.5 max-[640px]:gap-1.5 max-[640px]:flex-col max-[640px]:relative max-[640px]:text-xs"
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
            <span className="stay-filter-count px-1.25 flex items-center justify-center min-w-5.25 h-5.25 rounded-full bg-accent text-white text-xs font-semibold max-[640px]:absolute max-[640px]:-top-1.75 max-[640px]:-right-1.25 max-[640px]:min-w-4.75 max-[640px]:h-4.75 max-[640px]:text-[11px]">
              {activeCount}
            </span>
          )}
        </button>
      </div>
      {hasFilters && (
        <div
          className="stay-applied-filters gap-2 flex items-center flex-wrap -mt-2 mb-6"
          aria-label="Applied filters"
        >
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
            className="stay-clear-filters p-2 min-h-11 bg-transparent text-ink text-[13px] rounded-md underline underline-offset-3 hover:text-accent hover:bg-soft"
            onClick={() => update(defaultFilters())}
          >
            Clear all
          </button>
        </div>
      )}
      <div className="collection-heading stay-filter-results-heading gap-5 flex items-center justify-between mb-5 max-[700px]:mb-4.25 [&.stay-filter-results-heading_>_span]:block max-[640px]:gap-2 max-[640px]:items-start max-[640px]:flex-col">
        <h2 className="text-[17px] font-semibold tracking-[-0.3px] max-[700px]:text-sm">
          Places to make your own
        </h2>
        <span
          className="text-[13px] text-muted max-[700px]:hidden"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {`${stayCount(result.length)}${hasFilters ? (result.length === 1 ? " matches your search" : " match your search") : ", thoughtfully chosen"}`}
        </span>
      </div>
      {result.length > 0 ? (
        children(result)
      ) : (
        <div className="stay-filter-empty py-14 px-5 min-h-77.5 flex flex-col items-center justify-center text-center border border-dashed border-line rounded-xl text-muted [&_.button]:mt-5.5 max-[640px]:py-8.75 max-[640px]:px-5.5 max-[640px]:min-h-78.75">
          <Search size={27} strokeWidth={1.5} aria-hidden="true" />
          <h3 className="text-ink font-display text-[26px] font-normal mt-4.5 max-[640px]:text-2xl">
            No stays match these filters
          </h3>
          <p className="text-sm mt-2.5 leading-[1.7]">
            Try a broader price range, fewer amenities, or another place.
          </p>
          <button
            className="button secondary py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
            onClick={() => update(defaultFilters())}
          >
            Clear all filters
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        id={`${ids}-dialog`}
        className="stay-filter-dialog p-0 text-ink bg-surface border border-line rounded-2xl w-[min(620px,_calc(100%_-_48px))] max-h-[min(790px,_calc(100dvh_-_64px))] overflow-hidden shadow-[0_24px_90px_#152a2833] backdrop:bg-[#1d302b63] backdrop:backdrop-blur-[3px] open:animate-filter-in max-[640px]:m-0 max-[640px]:[inset:auto_0_0] max-[640px]:w-full max-[640px]:max-w-none max-[640px]:max-h-[calc(100dvh_-_30px)] max-[640px]:rounded-[18px_18px_0_0] max-[640px]:border-x-0 max-[640px]:border-b-0 motion-reduce:open:animate-none"
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
        <form
          className="stay-filter-form flex flex-col max-h-[min(790px,_calc(100dvh_-_66px))] max-[640px]:max-h-[calc(100dvh_-_31px)]"
          onSubmit={apply}
        >
          <header className="stay-filter-header px-7.5 gap-5 flex items-start justify-between pt-6.5 pb-5.5 border-b border-b-line shrink-0 max-[640px]:px-5.5 max-[640px]:pt-5.5 max-[640px]:pb-4.75">
            <div>
              <h2
                className="font-display text-[29px] font-normal leading-[1.15] tracking-[-0.5px] focus:outline-none max-[640px]:text-[27px]"
                id={titleId}
                ref={titleRef}
                tabIndex={-1}
              >
                Filters
              </h2>
              <p className="text-sm text-muted mt-2 leading-[1.5] max-[640px]:text-[13px]">
                A few details to find your kind of stay.
              </p>
            </div>
            <button
              type="button"
              className="stay-filter-close size-11 inline-flex items-center justify-center bg-transparent text-muted rounded-full shrink-0 -mt-1 -mr-2 mb-0 ml-0 hover:bg-[#edf0e7] hover:text-ink"
              aria-label="Close filters"
              onClick={dismiss}
            >
              <X size={19} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </header>
          <div className="stay-filter-body px-7.5 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] min-h-0 max-[640px]:px-5.5">
            <fieldset className="stay-filter-section m-0 py-6 px-0 border-0 border-b border-b-line min-w-0 max-[640px]:py-5.5">
              <legend className="p-0 gap-2 float-left w-full flex items-center text-sm font-semibold leading-[1.5] mb-1.75">
                Nightly budget
              </legend>
              <p
                id={budgetHelpId}
                className="stay-filter-help clear-both text-[13px] text-muted leading-[1.65]"
              >
                {listings.length
                  ? `${price(minimumPrice)}–${price(maximumPrice)} per night in this collection. Prices in USD.`
                  : "Prices per night, in USD."}
              </p>
              <div className="stay-price-fields gap-3.5 grid grid-cols-2 mt-4.5 max-[640px]:gap-2.5">
                <label className="block min-w-0">
                  <span className="block text-xs font-medium mb-2 max-[640px]:text-[11px]">
                    Minimum price per night
                  </span>
                  <div className="stay-price-input py-0 px-3.25 gap-2.25 flex items-center border border-line rounded-lg h-11.75 bg-surface focus-within:border-[#65826b] [&:has([aria-invalid='true'])]:border-[#b47156] [&_input::placeholder]:text-muted [&_input::placeholder]:text-[13px] max-[640px]:px-2.5">
                    <span className="text-sm text-muted" aria-hidden="true">
                      $
                    </span>
                    <input
                      className="p-0 bg-transparent text-ink border-0 min-w-0 w-full text-sm leading-[1.7] max-[640px]:text-base"
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
                <label className="block min-w-0">
                  <span className="block text-xs font-medium mb-2 max-[640px]:text-[11px]">
                    Maximum price per night
                  </span>
                  <div className="stay-price-input py-0 px-3.25 gap-2.25 flex items-center border border-line rounded-lg h-11.75 bg-surface focus-within:border-[#65826b] [&:has([aria-invalid='true'])]:border-[#b47156] [&_input::placeholder]:text-muted [&_input::placeholder]:text-[13px] max-[640px]:px-2.5">
                    <span className="text-sm text-muted" aria-hidden="true">
                      $
                    </span>
                    <input
                      className="p-0 bg-transparent text-ink border-0 min-w-0 w-full text-sm leading-[1.7] max-[640px]:text-base"
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
                className="stay-price-error gap-1.5 min-h-4.5 mt-2 text-[#995136] text-xs flex items-center leading-[1.5]"
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
            <div className="stay-filter-section stay-guest-section m-0 py-6 px-0 gap-5 border-0 border-b border-b-line min-w-0 flex items-center justify-between [&_legend]:p-0 [&_legend]:gap-2 [&_legend]:float-left [&_legend]:w-full [&_legend]:flex [&_legend]:items-center [&_legend]:text-sm [&_legend]:font-semibold [&_legend]:leading-[1.5] [&_legend]:mb-1.75 [&_.stay-filter-legend]:flex-row [&_.stay-filter-legend]:float-none [&_.stay-filter-legend]:mb-1.25 max-[640px]:py-5.5 max-[640px]:gap-3 max-[640px]:[&_.stay-filter-help]:max-w-38.75">
              <div>
                <label
                  htmlFor={guestId}
                  className="stay-filter-legend p-0 gap-2 float-left w-full flex items-center text-sm font-semibold leading-[1.5] mb-1.75"
                >
                  <Users size={19} strokeWidth={1.65} aria-hidden="true" />
                  Guests
                </label>
                <p className="stay-filter-help clear-both text-[13px] text-muted leading-[1.65]">
                  Enough room for your whole group.
                </p>
              </div>
              <div className="stay-guest-select relative shrink-0 [&_>_svg]:absolute [&_>_svg]:right-3 [&_>_svg]:top-1/2 [&_>_svg]:-translate-y-1/2 [&_>_svg]:pointer-events-none [&_>_svg]:text-muted">
                <select
                  className="py-3 appearance-none pr-9 pl-3.25 border border-line rounded-lg bg-surface text-ink text-sm cursor-pointer max-[640px]:text-[13px] max-[640px]:pl-2.5"
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
            <fieldset className="stay-filter-section stay-amenity-section m-0 px-0 pt-6 pb-7 border-0 border-b-0 min-w-0 max-[640px]:py-5.5">
              <legend className="p-0 gap-2 float-left w-full flex items-center text-sm font-semibold leading-[1.5] mb-1.75">
                The little things
              </legend>
              <p className="stay-filter-help clear-both text-[13px] text-muted leading-[1.65]">
                Stays must have every amenity you select.
              </p>
              <div className="stay-amenity-grid gap-2.5 grid grid-cols-2 mt-4.5 max-[640px]:gap-2">
                {amenities.map((amenity) => (
                  <label
                    className="stay-amenity-option py-3.5 px-3 gap-2.75 flex flex-row items-center relative min-h-14.5 border border-line rounded-lg cursor-pointer text-muted bg-surface [&_>_span:not(.stay-amenity-check)]:text-[13px] [&_>_span:not(.stay-amenity-check)]:text-ink [&_>_span:not(.stay-amenity-check)]:leading-[1.4] hover:border-[#a8baa0] [&:has(input:checked)]:border-[#5c7a58] [&:has(input:checked)]:bg-[#f0f4eb] [&:has(input:checked)]:text-[#3e6344] [&:has(input:checked)_.stay-amenity-check]:bg-[#426745] [&:has(input:checked)_.stay-amenity-check]:border-[#426745] [&:has(input:checked)_.stay-amenity-check]:text-white [&:has(input:focus-visible)]:outline-2 [&:has(input:focus-visible)]:outline-focus [&:has(input:focus-visible)]:outline-offset-3 max-[640px]:py-3 max-[640px]:px-2.5 max-[640px]:gap-2 max-[640px]:min-h-15.5 max-[640px]:[&_>_svg]:w-4.5 max-[640px]:[&_>_span:not(.stay-amenity-check)]:text-xs"
                    key={amenity}
                  >
                    <input
                      className="m-0 size-full absolute [inset:0] opacity-0 cursor-pointer"
                      type="checkbox"
                      checked={draft.amenities.includes(amenity)}
                      onChange={() => toggleAmenity(amenity)}
                    />
                    <AmenityIcon name={amenity} />
                    <span>{amenity}</span>
                    <span
                      className="stay-amenity-check size-4 ml-auto border border-[#bcc9b6] rounded flex items-center justify-center text-transparent shrink-0 max-[640px]:size-3.5"
                      aria-hidden="true"
                    >
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <footer className="stay-filter-footer py-4.5 px-7.5 gap-3 flex items-center border-t border-t-line bg-surface shrink-0 max-[640px]:px-5.5 max-[640px]:gap-2 max-[640px]:pt-4 max-[640px]:pb-[max(16px,_env(safe-area-inset-bottom))]">
            <button
              type="button"
              className="stay-filter-reset py-2 min-h-11 bg-transparent text-ink text-sm rounded-md pr-2 pl-0 underline underline-offset-3 mr-auto hover:text-accent hover:bg-soft"
              onClick={() =>
                replaceDraft({ ...defaultFilters(), query: applied.query })
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="stay-filter-cancel p-2 min-h-11 bg-transparent text-ink text-sm rounded-md hover:text-accent hover:bg-soft"
              onClick={dismiss}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="stay-filter-apply py-3.25 px-5.25 bg-accent text-surface text-sm font-medium rounded-lg min-w-31.5 leading-[1.4] enabled:hover:bg-accent-hover max-[640px]:px-3.75 max-[640px]:min-w-29.75"
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
      className="stay-filter-chip py-1.75 px-2.5 gap-2.25 min-h-11 inline-flex items-center max-w-full border border-[#d7dfcf] rounded-full bg-soft text-[#405440] text-[13px] leading-[1.45] text-left hover:bg-[#e4ebdd]"
      aria-label={removeLabel}
      onClick={onRemove}
    >
      <span className="min-w-0 wrap-anywhere">{label}</span>
      <X size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
