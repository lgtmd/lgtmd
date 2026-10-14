import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Car,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  CookingPot,
  House,
  Leaf,
  LoaderCircle,
  Laptop,
  MapPin,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trees,
  Waves,
  Wifi,
} from "lucide-react";
import type {
  Actor,
  Listing,
  ReplyEvent,
  Role,
  Sessions,
  StayRequest,
} from "./domain.ts";
import { ROLE_KEY, SESSION_KEY } from "./domain.ts";
import { ApiError, api, getSessions } from "./api.ts";
import { ListingFilters } from "./listing-filters.tsx";
import { StayAssistant } from "./stay-assistant.tsx";

const money = (value: number) => `$${value.toLocaleString("en-US")}`;
const date = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
const dates = (request: StayRequest) =>
  `${date(request.checkIn)} – ${date(request.checkOut)}`;

function navigate(path: string) {
  window.location.hash = path;
  window.scrollTo({ top: 0 });
}

function useRoute() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || "/");
  useEffect(() => {
    const update = () => setRoute(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      className="error-message py-2.5 px-3 gap-2 flex items-start text-[#a34d3f] text-[13px] leading-[1.6] border border-[#ead1c7] bg-[#fbf0ea] rounded-md mb-3.5 [&_svg]:mt-0.25 max-[700px]:p-2.25 max-[700px]:text-xs"
      role="alert"
    >
      <CircleAlert size={17} aria-hidden="true" />
      {message}
    </p>
  );
}

function Status({ status }: { status: StayRequest["status"] }) {
  return (
    <span
      className={`status py-1.25 px-1.75 gap-1.25 inline-flex items-center text-muted bg-[#f6f0e0] rounded text-xs font-medium whitespace-nowrap [&.status-accepted]:bg-soft [&.status-accepted]:text-accent status-${status}`}
    >
      {status === "accepted" ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Clock3 size={13} aria-hidden="true" />
      )}
      {status === "accepted" ? "Accepted" : "Pending"}
    </span>
  );
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [role, setRole] = useState<Role>(
    sessionStorage.getItem(ROLE_KEY) === "host" ? "host" : "guest",
  );
  const [actor, setActor] = useState<Actor | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [requests, setRequests] = useState<StayRequest[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expired, setExpired] = useState(false);
  const refreshGeneration = useRef(0);
  const token = sessions?.[role].token;

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSessions(await getSessions());
    } catch (cause) {
      setError((cause as Error).message);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const generation = ++refreshGeneration.current;
    setRefreshing(true);
    try {
      const [nextActor, nextListings, nextRequests] = await Promise.all([
        api<Actor>("/me", token),
        api<Listing[]>("/listings", token),
        api<StayRequest[]>("/requests", token),
      ]);
      if (generation !== refreshGeneration.current) return;
      setActor(nextActor);
      setListings(nextListings);
      setRequests(nextRequests);
      setError("");
      setExpired(false);
    } catch (cause) {
      if (generation !== refreshGeneration.current) return;
      setError((cause as Error).message);
      setExpired(cause instanceof ApiError && cause.status === 401);
    } finally {
      if (generation === refreshGeneration.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh, route]);
  useEffect(() => {
    const focused = () => {
      void refresh();
    };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [refresh]);

  function switchRole(next: Role) {
    if (next === role) return;
    ++refreshGeneration.current;
    sessionStorage.setItem(ROLE_KEY, next);
    setRole(next);
    setActor(null);
    navigate(next === "host" ? "/inbox" : "/trips");
  }
  function updateRequest(request: StayRequest) {
    ++refreshGeneration.current;
    setRefreshing(false);
    setRequests((current) => [
      ...current.filter((item) => item.id !== request.id),
      request,
    ]);
  }
  function startFresh() {
    ++refreshGeneration.current;
    sessionStorage.removeItem(SESSION_KEY);
    setSessions(null);
    setRequests([]);
    setActor(null);
    setExpired(false);
    navigate(role === "host" ? "/inbox" : "/");
    void bootstrap();
  }

  const [section, id] = route.split("/").filter(Boolean);
  const selectedRequest = requests.find((item) => item.id === id) ?? null;
  const selectedListing = listings.find(
    (item) =>
      item.id === (section === "stays" ? id : selectedRequest?.listingId),
  );

  return (
    <div className="app-shell min-h-dvh flex flex-col">
      <header className="site-header py-0 px-[max(40px,_calc((100vw_-_1168px)_/_2))] gap-12 h-22 flex items-center border-b border-b-line bg-canvas max-[1000px]:px-6 max-[700px]:px-5 max-[700px]:h-auto max-[700px]:min-h-28 max-[700px]:gap-y-0 max-[700px]:gap-x-5 max-[700px]:pt-4 max-[700px]:pb-0 max-[700px]:flex-wrap">
        <a
          className="brand gap-2 inline-flex items-center text-accent shrink-0 max-[700px]:gap-1.5 max-[700px]:[&_svg]:w-6"
          href="#/"
          aria-label="Stay home"
        >
          <House size={28} strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[34px] tracking-[-2px] font-bold leading-none max-[700px]:text-[29px]">
            stay<span className="brand-dot text-muted">.</span>
          </span>
        </a>
        <nav
          className="primary-nav gap-7.5 h-full flex items-center text-sm max-[700px]:gap-4 max-[700px]:order-3 max-[700px]:w-full max-[700px]:h-12 max-[700px]:justify-between max-[700px]:text-sm max-[700px]:mt-3"
          aria-label="Main navigation"
        >
          {role === "guest" ? (
            <>
              <a
                className="h-full flex items-center relative text-muted aria-[current=page]:text-ink aria-[current=page]:font-semibold aria-[current=page]:after:[content:''] aria-[current=page]:after:absolute aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-accent aria-[current=page]:after:-bottom-0.25 aria-[current=page]:after:[inset-inline:0]"
                href="#/"
                aria-current={
                  !section || section === "stays" ? "page" : undefined
                }
              >
                Explore stays
              </a>
              <a
                className="assistant-nav-link gap-1.75 h-full flex items-center relative text-muted aria-[current=page]:text-ink aria-[current=page]:font-semibold aria-[current=page]:after:[content:''] aria-[current=page]:after:absolute aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-accent aria-[current=page]:after:-bottom-0.25 aria-[current=page]:after:[inset-inline:0]"
                href="#/assistant"
                aria-current={section === "assistant" ? "page" : undefined}
              >
                <Sparkles size={14} aria-hidden="true" />
                Ask Stay
              </a>
              <a
                className="h-full flex items-center relative text-muted aria-[current=page]:text-ink aria-[current=page]:font-semibold aria-[current=page]:after:[content:''] aria-[current=page]:after:absolute aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-accent aria-[current=page]:after:-bottom-0.25 aria-[current=page]:after:[inset-inline:0]"
                href="#/trips"
                aria-current={section === "trips" ? "page" : undefined}
              >
                Your trips
              </a>
            </>
          ) : (
            <a
              className="h-full flex items-center relative text-muted aria-[current=page]:text-ink aria-[current=page]:font-semibold aria-[current=page]:after:[content:''] aria-[current=page]:after:absolute aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-accent aria-[current=page]:after:-bottom-0.25 aria-[current=page]:after:[inset-inline:0]"
              href="#/inbox"
              aria-current="page"
            >
              Host inbox
            </a>
          )}
        </nav>
        <div className="identity gap-3 ml-auto flex items-center text-sm font-semibold max-[700px]:[&_.avatar]:size-7.5 max-[700px]:[&_.avatar]:text-xs">
          <span className="identity-name max-[700px]:hidden">
            {actor?.name ?? (role === "host" ? "Host" : "Guest")}
          </span>
          <span
            className="avatar size-9.5 rounded-full inline-flex items-center justify-center bg-sand text-sand-ink text-[13px] font-semibold shrink-0"
            aria-hidden="true"
          >
            {role === "host" ? "MC" : "AM"}
          </span>
        </div>
      </header>
      <div className="demo-bar py-2.5 px-[max(40px,_calc((100vw_-_1168px)_/_2))] gap-4 min-h-12.5 bg-soft text-muted text-[13px] flex items-center justify-between max-[1000px]:px-6 max-[700px]:py-2 max-[700px]:px-5 max-[700px]:flex-wrap max-[700px]:min-h-12.25 max-[700px]:text-xs">
        <span className="flex items-center">
          <span className="demo-dot size-1.25 rounded-full mr-2 bg-[#8d9e77]" />
          An interactive demo
          <span className="demo-description max-[700px]:hidden">
            {" "}
            · A shared space for guests and hosts
          </span>
        </span>
        <div
          className="role-switch p-0.75 gap-0.5 flex bg-line rounded-lg shrink-0 [&_button[aria-pressed='true']]:text-ink [&_button[aria-pressed='true']]:bg-surface [&_button[aria-pressed='true']]:shadow-[0_1px_3px_#243c2810]"
          role="group"
          aria-label="Demo role"
        >
          <button
            className="py-1.5 px-2.5 min-h-9 bg-transparent text-muted text-[13px] rounded whitespace-nowrap max-[700px]:py-1.5 max-[700px]:px-2 max-[700px]:min-h-9 max-[700px]:text-xs"
            type="button"
            aria-pressed={role === "guest"}
            onClick={() => switchRole("guest")}
          >
            Guest view
          </button>
          <button
            className="py-1.5 px-2.5 min-h-9 bg-transparent text-muted text-[13px] rounded whitespace-nowrap max-[700px]:py-1.5 max-[700px]:px-2 max-[700px]:min-h-9 max-[700px]:text-xs"
            type="button"
            aria-pressed={role === "host"}
            onClick={() => switchRole("host")}
          >
            Host view
          </button>
        </div>
      </div>
      <main id="main-content" data-testid="stay-main">
        {loading ? (
          <div
            className="loading-state py-25 gap-2.5 flex justify-center items-center text-muted text-sm"
            role="status"
          >
            <LoaderCircle
              className="spinner animate-spin"
              size={22}
              aria-hidden="true"
            />
            Opening your space…
          </div>
        ) : error ? (
          <div className="page-width page-error my-12.5 mx-auto w-[min(1168px,_calc(100%_-_80px))] max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:w-[calc(100%_-_40px)]">
            <ErrorMessage message={error} />
            {expired ? (
              <>
                <p className="expired-help text-sm leading-[1.7] text-muted mb-5">
                  The local server no longer has this demo. Start a fresh space
                  to explore again.
                </p>
                <button
                  className="button secondary py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
                  onClick={startFresh}
                >
                  Start a fresh demo
                </button>
              </>
            ) : (
              <button
                className="button secondary py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
                onClick={() => void (sessions ? refresh() : bootstrap())}
              >
                Try again
              </button>
            )}
          </div>
        ) : token ? (
          <>
            {role === "guest" && !section && <Explore listings={listings} />}
            {role === "guest" && section === "assistant" && (
              <StayAssistant key={token} listings={listings} token={token} />
            )}
            {role === "guest" && section === "stays" && selectedListing && (
              <ListingDetail
                listing={selectedListing}
                token={token}
                onCreated={(request) => {
                  updateRequest(request);
                  navigate(`/trips/${request.id}`);
                }}
              />
            )}
            {role === "guest" && section === "trips" && !id && (
              <Trips
                listings={listings}
                requests={requests}
                refreshing={refreshing}
                onRefresh={refresh}
              />
            )}
            {role === "guest" &&
              section === "trips" &&
              id &&
              selectedRequest &&
              selectedListing && (
                <Conversation
                  key={`${role}-${id}`}
                  role={role}
                  request={selectedRequest}
                  listing={selectedListing}
                  token={token}
                  onUpdated={updateRequest}
                />
              )}
            {role === "host" && section !== "stays" && (
              <HostInbox
                listings={listings}
                requests={requests}
                selected={selectedRequest}
                token={token}
                refreshing={refreshing}
                onRefresh={refresh}
                onUpdated={updateRequest}
              />
            )}
            {role === "guest" && id && !selectedListing && (
              <div className="empty-state page-width mx-auto py-18.75 w-[min(1168px,_calc(100%_-_80px))] text-center text-muted [&_>_svg]:mb-5 [&_h2]:font-display [&_h2]:font-normal [&_h2]:text-[#53684c] [&_h2]:text-[28px] [&_h2]:tracking-[-0.5px] [&_p]:mt-3.25 [&_p]:mb-6 [&_p]:text-sm max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:py-13.75 max-[700px]:w-[calc(100%_-_40px)] max-[700px]:[&_h2]:text-[25px] max-[700px]:[&_p]:text-[13px]">
                <House size={32} />
                <h1 className="font-display font-normal text-[#53684c] text-[28px] tracking-[-0.5px] max-[700px]:text-[25px]">
                  This stay could not be found.
                </h1>
                <a
                  className="button py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
                  href="#/"
                >
                  Explore stays
                </a>
              </div>
            )}
            {role === "host" && section === "stays" && (
              <div className="empty-state page-width mx-auto py-18.75 w-[min(1168px,_calc(100%_-_80px))] text-center text-muted [&_>_svg]:mb-5 [&_h2]:font-display [&_h2]:font-normal [&_h2]:text-[#53684c] [&_h2]:text-[28px] [&_h2]:tracking-[-0.5px] [&_p]:mt-3.25 [&_p]:mb-6 [&_p]:text-sm max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:py-13.75 max-[700px]:w-[calc(100%_-_40px)] max-[700px]:[&_h2]:text-[25px] max-[700px]:[&_p]:text-[13px]">
                <h1 className="font-display font-normal text-[#53684c] text-[28px] tracking-[-0.5px] max-[700px]:text-[25px]">
                  Your host space
                </h1>
                <a
                  className="button py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
                  href="#/inbox"
                >
                  Open inbox
                </a>
              </div>
            )}
          </>
        ) : null}
      </main>
      <footer className="site-footer py-6.25 px-[max(40px,_calc((100vw_-_1168px)_/_2))] gap-4.5 border-t border-t-line flex items-center text-muted text-xs max-[1000px]:px-6 max-[700px]:py-5.5 max-[700px]:px-5 max-[700px]:flex-wrap max-[700px]:gap-y-2.25 max-[700px]:gap-x-3.75 max-[700px]:text-xs">
        <span className="footer-brand text-[22px] font-bold tracking-[-1.3px] text-muted">
          stay.
        </span>
        <span>A little further from ordinary.</span>
        <span className="footer-note ml-auto max-[700px]:ml-0 max-[700px]:w-full max-[700px]:pl-12">
          Fictional stays · Local demo · No payments
        </span>
      </footer>
    </div>
  );
}

function Explore({ listings }: { listings: Listing[] }) {
  return (
    <div className="page-width explore-page mx-auto w-[min(1168px,_calc(100%_-_80px))] pt-12 pb-15 max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:w-[calc(100%_-_40px)] max-[700px]:pt-8.5 max-[700px]:pb-9.25">
      <div className="explore-heading gap-9 flex justify-between items-end mb-11 max-[700px]:block max-[700px]:mb-8">
        <div>
          <p className="eyebrow text-muted text-xs font-semibold tracking-[1.9px] leading-[1.6] max-[700px]:text-[11px] max-[700px]:tracking-[1.5px]">
            THOUGHTFUL PLACES. UNHURRIED DAYS.
          </p>
          <h1 className="font-display font-normal text-[clamp(42px,_4.6vw,_59px)] tracking-[-1.7px] leading-[1.08] mt-3.5 max-[700px]:text-[44px] max-[700px]:tracking-[-1.6px] max-[700px]:mt-3.25">
            A little further
            <br />
            from ordinary.
          </h1>
        </div>
        <p className="intro max-w-80 text-sm leading-[1.75] text-muted pb-1 max-[700px]:text-sm max-[700px]:leading-[1.8] max-[700px]:mt-5 max-[700px]:max-w-77.5">
          A quiet cabin, a sunlit loft, a house among the trees. Find somewhere
          that feels like a deep breath.
        </p>
      </div>
      <ListingFilters listings={listings}>
        {(filtered) => (
          <div className="listing-grid gap-6.25 grid grid-cols-3 max-[700px]:gap-7.5 max-[700px]:grid-cols-1">
            {filtered.map((listing) => (
              <a
                className="listing-card rounded-xl block min-w-0 [&:hover_.listing-image_img]:scale-[1.025] [&:focus-visible_.listing-image_img]:scale-[1.025] [&:hover_.image-link]:opacity-100 [&:focus-visible_.image-link]:opacity-100"
                key={listing.id}
                href={`#/stays/${listing.id}`}
              >
                <div className="listing-image relative aspect-[1.38] overflow-hidden rounded-xl bg-[#d4d8c8] max-[700px]:aspect-[1.4]">
                  <img
                    className="h-full object-cover transition-transform duration-200 ease-out"
                    src={listing.image}
                    alt={listing.imageAlt}
                  />
                  <span className="image-tag py-1.75 px-2.5 absolute top-3.5 left-3.5 bg-[#fffdf2e6] rounded-md text-xs font-medium text-[#435147]">
                    {
                      [
                        "Among the trees",
                        "In the neighborhood",
                        "By the coast",
                      ][listings.indexOf(listing)]
                    }
                  </span>
                  <span
                    className="image-link size-10 absolute bottom-3.75 right-3.75 rounded-full bg-[#fffdf2e6] flex justify-center items-center text-[#526457] opacity-0 transition-opacity duration-150 max-[700px]:opacity-100"
                    aria-hidden="true"
                  >
                    <ArrowRight size={20} />
                  </span>
                </div>
                <div className="listing-location mx-0 gap-1 flex items-center text-xs text-muted mt-4.25 mb-1.75 max-[700px]:mt-3.75">
                  <MapPin size={13} aria-hidden="true" />
                  {listing.location}
                </div>
                <h3 className="text-xl font-display font-normal tracking-[-0.25px] max-[700px]:text-[22px]">
                  {listing.title}
                </h3>
                <p className="mx-0 text-[13px] text-muted mt-2 mb-3.5 max-[700px]:mb-2.75">
                  {listing.bedrooms} bedroom{listing.bedrooms === 1 ? "" : "s"}{" "}
                  <span className="px-1.25">·</span> Up to {listing.capacity}{" "}
                  guests
                </p>
                <div className="listing-price text-sm max-[700px]:text-sm">
                  <strong className="font-semibold">
                    {money(listing.nightlyRate)}
                  </strong>
                  <span className="text-muted"> / night</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </ListingFilters>
      <div className="explore-note gap-3.5 mt-10.5 border-t border-t-line pt-6.25 flex items-center text-muted max-[700px]:mt-8.5 max-[700px]:items-start">
        <Leaf size={21} aria-hidden="true" />
        <p className="gap-1.5 flex flex-col text-[13px] max-[700px]:text-xs max-[700px]:leading-[1.7]">
          <strong className="text-[#5e705d] font-medium text-sm max-[700px]:text-[13px]">
            Good stays start with a conversation.
          </strong>
          <span>
            Send your host a request and a little about your plans. They’ll take
            it from there.
          </span>
        </p>
      </div>
    </div>
  );
}

function ListingDetail({
  listing,
  token,
  onCreated,
}: {
  listing: Listing;
  token: string;
  onCreated: (request: StayRequest) => void;
}) {
  const [checkIn, setCheckIn] = useState("2026-11-06");
  const checkInInput = useRef<HTMLInputElement>(null);
  const [checkOut, setCheckOut] = useState("2026-11-09");
  const [guests, setGuests] = useState("2");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      onCreated(
        await api<StayRequest>("/requests", token, {
          listingId: listing.id,
          checkIn,
          checkOut,
          guests: Number(guests),
          message,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-width detail-page mx-auto w-[min(1168px,_calc(100%_-_80px))] pt-7 pb-16.25 max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:w-[calc(100%_-_40px)] max-[700px]:pt-5.75 max-[700px]:pb-8.75">
      <a
        className="back-link gap-1.75 min-h-11 inline-flex items-center text-[13px] text-muted mb-6.75 hover:text-ink max-[700px]:mb-5.75 max-[700px]:text-xs"
        href="#/"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        All stays
      </a>
      <div className="detail-heading gap-5 flex items-end justify-between mb-6.25 [&_>_div_>_p:last-child]:gap-1.25 [&_>_div_>_p:last-child]:flex [&_>_div_>_p:last-child]:items-center [&_>_div_>_p:last-child]:text-sm [&_>_div_>_p:last-child]:text-muted max-[700px]:mb-5.25 max-[700px]:[&_>_div_>_p:last-child]:text-[13px]">
        <div>
          <p className="eyebrow text-muted text-xs font-semibold tracking-[1.9px] leading-[1.6] max-[700px]:text-[11px] max-[700px]:tracking-[1.5px]">
            A PLACE TO SETTLE IN
          </p>
          <h1 className="mx-0 font-display font-normal text-[38px] tracking-[-0.9px] mt-2 mb-2.75 max-[700px]:text-[32px] max-[700px]:mt-1.75">
            {listing.title}
          </h1>
          <p>
            <MapPin size={15} aria-hidden="true" />
            {listing.location}
          </p>
        </div>
        <span className="detail-caption gap-1.75 flex items-center text-muted text-[13px] pb-0.75 max-[700px]:hidden">
          <Leaf size={16} aria-hidden="true" />
          Room to slow down
        </span>
      </div>
      <div className="mobile-request-shortcut hidden max-[700px]:py-4 max-[700px]:px-0 max-[700px]:gap-4 max-[700px]:flex max-[700px]:items-center max-[700px]:justify-between max-[700px]:mb-5.5 max-[700px]:border-y max-[700px]:border-y-line max-[700px]:[&_.rate_strong]:text-[22px]">
        <p className="rate text-sm text-muted">
          <strong className="text-2xl text-ink tracking-[-0.7px] font-semibold">
            {money(listing.nightlyRate)}
          </strong>{" "}
          / night
        </p>
        <button
          className="button py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
          type="button"
          onClick={() => {
            checkInInput.current?.focus({ preventScroll: true });
            checkInInput.current?.scrollIntoView({ block: "center" });
          }}
        >
          Choose dates
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="detail-layout gap-9 grid grid-cols-[minmax(0,_1fr)_370px] items-start max-[1000px]:gap-6 max-[1000px]:grid-cols-[minmax(0,_1fr)_310px] min-[701px]:max-[900px]:grid-cols-1 max-[700px]:gap-6.75 max-[700px]:flex max-[700px]:flex-col">
        <div className="property-content max-[700px]:w-full">
          <div className="detail-image aspect-[1.56] rounded-xl overflow-hidden bg-[#dde1d4] max-[700px]:aspect-[1.3]">
            <img
              className="h-full object-cover"
              src={listing.image}
              alt={listing.imageAlt}
            />
          </div>
          <div className="property-summary px-0 gap-3.75 flex items-center justify-between pt-6.25 pb-5 border-b border-b-line [&_.host-avatar]:size-10.75 max-[700px]:pt-5.5 max-[700px]:pb-4.5">
            <div>
              <h2 className="text-base font-medium tracking-[-0.3px] max-[700px]:text-sm max-[700px]:leading-[1.55] max-[700px]:max-w-60">
                Your own little corner of {listing.location.split(",")[0]}
              </h2>
              <p className="text-[13px] text-muted mt-2.25 max-[700px]:text-xs">
                {listing.capacity} guests{" "}
                <span className="mx-1.75 max-[700px]:mx-1">·</span>{" "}
                {listing.bedrooms} bedroom{listing.bedrooms === 1 ? "" : "s"}{" "}
                <span className="mx-1.75 max-[700px]:mx-1">·</span>{" "}
                {listing.beds} bed{listing.beds === 1 ? "" : "s"}
              </p>
            </div>
            <span
              className="host-avatar size-9.5 rounded-full inline-flex items-center justify-center bg-soft text-accent text-[13px] font-semibold shrink-0"
              aria-hidden="true"
            >
              MC
            </span>
          </div>
          <p className="property-description my-5.25 text-sm leading-[1.8] text-muted max-[700px]:my-4.5 max-[700px]:text-sm">
            {listing.description}
          </p>
          <div
            className="amenities grid grid-cols-2 gap-y-4 gap-x-5 mb-5.75 max-[700px]:gap-y-3.75 max-[700px]:gap-x-3"
            aria-label="Amenities"
          >
            {listing.amenities.map((amenity) => {
              const name = amenity.toLowerCase();
              const Icon = name.includes("wi-fi")
                ? Wifi
                : name.includes("kitchen")
                  ? CookingPot
                  : name.includes("parking")
                    ? Car
                    : name.includes("trail")
                      ? Trees
                      : name.includes("workspace")
                        ? Laptop
                        : name.includes("ocean")
                          ? Waves
                          : Leaf;
              return (
                <span
                  className="gap-2.5 flex items-center text-[13px] text-muted max-[700px]:gap-2 max-[700px]:text-xs"
                  key={amenity}
                >
                  <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                  {amenity}
                </span>
              );
            })}
          </div>
          <div className="host-note gap-3 border-t border-t-line pt-5.5 flex items-center max-[700px]:pt-4.5">
            <span
              className="avatar size-9.5 rounded-full inline-flex items-center justify-center bg-sand text-sand-ink text-[13px] font-semibold shrink-0"
              aria-hidden="true"
            >
              MC
            </span>
            <div>
              <strong className="text-sm font-medium">
                Hosted by {listing.hostName}
              </strong>
              <p className="mt-1.25 text-muted text-[13px]">
                Ask a question, share your plans, feel at home.
              </p>
            </div>
          </div>
        </div>
        <aside
          className="request-card p-6 scroll-mt-6 border border-line rounded-xl bg-surface shadow-[0_8px_28px_#3b4c3210] min-[1000px]:sticky min-[1000px]:top-6.25 max-[1000px]:p-5 min-[701px]:max-[900px]:w-full max-[700px]:p-5.5 max-[700px]:w-full"
          aria-labelledby="request-heading"
        >
          <div className="rate text-sm text-muted">
            <strong className="text-2xl text-ink tracking-[-0.7px] font-semibold">
              {money(listing.nightlyRate)}
            </strong>
            <span> / night</span>
          </div>
          <h2
            className="text-sm font-normal leading-[1.5] text-muted mt-2.5 mb-5.5 max-[700px]:text-sm"
            id="request-heading"
          >
            Make a little room for a getaway.
          </h2>
          <form onSubmit={submit}>
            <div className="date-fields gap-2.5 grid grid-cols-2 mb-4 max-[700px]:gap-4 max-[700px]:grid-cols-1">
              <label>
                Check-in
                <input
                  className="max-[700px]:text-base py-2.5 px-2.25 text-[13px]"
                  ref={checkInInput}
                  type="date"
                  required
                  value={checkIn}
                  onChange={(event) => setCheckIn(event.target.value)}
                />
              </label>
              <label>
                Check-out
                <input
                  className="max-[700px]:text-base py-2.5 px-2.25 text-[13px]"
                  type="date"
                  required
                  value={checkOut}
                  onChange={(event) => setCheckOut(event.target.value)}
                />
              </label>
            </div>
            <div className="guest-field mb-4 [&_.field-hint]:mt-1.5">
              <label>
                Guests
                <input
                  className="max-[700px]:text-base"
                  type="number"
                  min="1"
                  max={listing.capacity}
                  required
                  value={guests}
                  aria-describedby="guests-hint"
                  onChange={(event) => setGuests(event.target.value)}
                />
              </label>
              <p
                className="field-hint text-xs font-normal text-muted -mt-0.75"
                id="guests-hint"
              >
                Room for up to {listing.capacity} guests
              </p>
            </div>
            <label className="mb-4">
              Message to host
              <textarea
                className="max-[700px]:text-base"
                required
                rows={4}
                placeholder="Say hello and tell Maya a little about your stay…"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            {error && <ErrorMessage message={error} />}
            <button
              className="button full-width py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 w-full enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle
                  size={17}
                  className="spinner animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {busy ? "Sending request…" : "Request to stay"}
              {!busy && <ArrowRight size={17} aria-hidden="true" />}
            </button>
            <p className="request-help gap-1.5 flex items-center justify-center text-muted text-xs mt-3.5 max-[700px]:text-xs">
              <ShieldCheck size={15} aria-hidden="true" />
              This is a request. You won’t be charged.
            </p>
          </form>
        </aside>
      </div>
    </div>
  );
}

function Trips({
  listings,
  requests,
  refreshing,
  onRefresh,
}: {
  listings: Listing[];
  requests: StayRequest[];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="page-width trips-page mx-auto w-[min(1168px,_calc(100%_-_80px))] pt-10.75 pb-15 max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:w-[calc(100%_-_40px)] max-[700px]:pt-7.5 max-[700px]:pb-10">
      <div className="page-heading gap-5 flex justify-between items-end mb-8 [&_>_div_>_p:last-child:not(.eyebrow)]:text-muted [&_>_div_>_p:last-child:not(.eyebrow)]:text-sm max-[700px]:mb-6.75 max-[700px]:[&_>_div_>_p:last-child:not(.eyebrow)]:text-[13px] max-[700px]:[&_>_div_>_p:last-child:not(.eyebrow)]:leading-[1.7]">
        <div>
          <p className="eyebrow text-muted text-xs font-semibold tracking-[1.9px] leading-[1.6] max-[700px]:text-[11px] max-[700px]:tracking-[1.5px]">
            SOMEWHERE TO LOOK FORWARD TO
          </p>
          <h1 className="my-2.5 mx-0 font-display font-normal text-[38px] tracking-[-0.9px] max-[700px]:text-[32px]">
            Your trips
          </h1>
          <p>Your requests and conversations, all in one place.</p>
        </div>
        <button
          className="icon-button size-11 border border-line rounded-md bg-surface text-muted inline-flex justify-center items-center shrink-0 hover:bg-soft"
          aria-label="Refresh requests"
          onClick={() => void onRefresh()}
          disabled={refreshing}
        >
          <RefreshCw size={18} className={refreshing ? "spinner" : ""} />
        </button>
      </div>
      {!requests.length ? (
        <div className="empty-state py-18.75 text-center text-muted [&_>_svg]:mb-5 [&_h1]:font-display [&_h1]:font-normal [&_h1]:text-[#53684c] [&_h1]:text-[28px] [&_h1]:tracking-[-0.5px] max-[700px]:py-13.75 max-[700px]:[&_h1]:text-[25px]">
          <House size={34} strokeWidth={1.4} aria-hidden="true" />
          <h2 className="font-display font-normal text-[#53684c] text-[28px] tracking-[-0.5px] max-[700px]:text-[25px]">
            Your next chapter starts here.
          </h2>
          <p className="mt-3.25 mb-6 text-sm max-[700px]:text-[13px]">
            Find a stay you love and send your first request.
          </p>
          <a
            className="button py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
            href="#/"
          >
            Explore stays
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="trip-grid gap-6 grid grid-cols-2 max-[1000px]:grid-cols-1">
          {requests.map((request) => {
            const listing = listings.find(
              (item) => item.id === request.listingId,
            );
            if (!listing) return null;
            return (
              <a
                className="trip-card p-4.25 gap-5.5 flex border border-line bg-surface rounded-xl overflow-hidden max-[700px]:p-3 max-[700px]:gap-3.75"
                href={`#/trips/${request.id}`}
                key={request.id}
              >
                <img
                  className="h-47.5 w-42.5 object-cover rounded-md max-[700px]:w-27 max-[700px]:h-46.25"
                  src={listing.image}
                  alt={listing.imageAlt}
                />
                <div className="py-1.75">
                  <Status status={request.status} />
                  <h2 className="font-display text-2xl font-normal mt-3 max-[700px]:text-[21px]">
                    {listing.title}
                  </h2>
                  <p className="text-xs text-muted mt-2 max-[700px]:text-xs">
                    {listing.location}
                  </p>
                  <div className="trip-meta gap-1.75 flex text-xs text-muted mt-4.25 max-[700px]:gap-1 max-[700px]:text-xs">
                    {dates(request)}
                    <span>·</span>
                    {request.guests} guests
                  </div>
                  <span className="text-link gap-2.25 text-accent flex items-center mt-5.5 text-[13px] max-[700px]:text-xs">
                    Open conversation
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HostInbox({
  listings,
  requests,
  selected,
  token,
  refreshing,
  onRefresh,
  onUpdated,
}: {
  listings: Listing[];
  requests: StayRequest[];
  selected: StayRequest | null;
  token: string;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onUpdated: (request: StayRequest) => void;
}) {
  const selectedListing = listings.find(
    (item) => item.id === selected?.listingId,
  );
  return (
    <div
      className={`page-width inbox-page mx-auto w-[min(1168px,_calc(100%_-_80px))] pt-9.25 pb-12.5 max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:w-[calc(100%_-_40px)] max-[700px]:pt-6.75 max-[700px]:pb-8.75 max-[700px]:[&.has-selection_.inbox-detail]:block max-[700px]:[&.has-selection_.inbox-list]:hidden max-[700px]:[&.has-selection_.inbox-heading]:hidden ${selected ? "has-selection" : ""}`}
    >
      <div className="page-heading inbox-heading gap-5 flex justify-between items-end mb-5.5 [&_>_div_>_p:last-child:not(.eyebrow)]:text-muted [&_>_div_>_p:last-child:not(.eyebrow)]:text-sm max-[700px]:mb-5.5 max-[700px]:[&_>_div_>_p:last-child:not(.eyebrow)]:text-[13px] max-[700px]:[&_>_div_>_p:last-child:not(.eyebrow)]:leading-[1.7]">
        <div>
          <p className="eyebrow text-muted text-xs font-semibold tracking-[1.9px] leading-[1.6] max-[700px]:text-[11px] max-[700px]:tracking-[1.5px]">
            A THOUGHTFUL WELCOME STARTS HERE
          </p>
          <h1 className="mx-0 font-display font-normal text-[38px] tracking-[-0.9px] mt-2.5 mb-0 max-[700px]:text-[32px]">
            Inbox
          </h1>
        </div>
        <button
          className="icon-button size-11 border border-line rounded-md bg-surface text-muted inline-flex justify-center items-center shrink-0 hover:bg-soft"
          aria-label="Refresh requests"
          onClick={() => void onRefresh()}
          disabled={refreshing}
        >
          <RefreshCw size={18} className={refreshing ? "spinner" : ""} />
        </button>
      </div>
      <div className="inbox-layout border border-line rounded-xl grid grid-cols-[298px_minmax(0,_1fr)] min-h-142.5 overflow-hidden bg-surface max-[1000px]:grid-cols-[240px_minmax(0,_1fr)] max-[700px]:block max-[700px]:min-h-112.5">
        <aside
          className="inbox-list border-r border-r-line bg-canvas max-[700px]:border-0"
          aria-label="Stay requests"
        >
          <div className="inbox-list-heading px-5.25 flex items-center justify-between pt-5.75 pb-4.75">
            <h2 className="text-sm font-semibold">Stay requests</h2>
            <span className="py-0.75 px-1.5 bg-[#eaf0e1] text-muted text-xs rounded">
              {requests.length}
            </span>
          </div>
          {!requests.length && (
            <p className="inbox-empty py-3.5 px-5.5 text-sm leading-[1.7] text-muted">
              A little quiet for now. New requests will appear here.
            </p>
          )}
          {requests.map((request) => {
            const listing = listings.find(
              (item) => item.id === request.listingId,
            );
            return (
              <a
                className={`inbox-item py-5.5 px-4.75 gap-2.75 flex items-start border-t border-t-line border-l-2 border-l-transparent [&.selected]:border-l-[#467257] [&.selected]:bg-soft hover:bg-[#f3f5ed] [&_>_div]:min-w-0 [&_>_div]:flex-1 [&_>_svg]:mt-2.25 [&_>_svg]:text-muted [&_.guest-avatar]:size-8 [&_.guest-avatar]:text-xs ${selected?.id === request.id ? "selected" : ""}`}
                href={`#/inbox/${request.id}`}
                key={request.id}
                aria-current={selected?.id === request.id ? "page" : undefined}
              >
                <span
                  className="guest-avatar size-9.5 rounded-full inline-flex items-center justify-center bg-sand text-sand-ink text-[13px] font-semibold shrink-0"
                  aria-hidden="true"
                >
                  AM
                </span>
                <div>
                  <div className="inbox-item-heading flex items-center justify-between">
                    <strong className="text-sm font-semibold">
                      {request.guestName}
                    </strong>
                    <span
                      className={`status-dot size-1.25 rounded-full bg-[#b79c61] [&.accepted]:bg-[#709461] ${request.status}`}
                      aria-label={request.status}
                    />
                  </div>
                  <p className="inbox-listing-name text-xs text-muted mt-1.5">
                    {listing?.title}
                  </p>
                  <p className="inbox-preview mt-2.75 text-xs leading-[1.65] text-muted overflow-hidden line-clamp-2">
                    {request.messages.at(-1)?.body}
                  </p>
                  <span className="inbox-dates block text-xs text-muted mt-2.75">
                    {dates(request)} · {request.guests} guests
                  </span>
                </div>
                <ChevronRight size={15} aria-hidden="true" />
              </a>
            );
          })}
        </aside>
        <div className="inbox-detail max-[700px]:hidden">
          {selected && selectedListing ? (
            <Conversation
              key={`host-${selected.id}`}
              role="host"
              request={selected}
              listing={selectedListing}
              token={token}
              onUpdated={onUpdated}
            />
          ) : (
            <div className="empty-state inbox-prompt py-32.5 px-7.5 text-center text-muted [&_>_svg]:mb-5 [&_h1]:font-display [&_h1]:font-normal [&_h1]:text-[#53684c] [&_h1]:text-[28px] [&_h1]:tracking-[-0.5px] max-[700px]:py-13.75 max-[700px]:[&_h1]:text-[25px]">
              <MessageCircle size={35} strokeWidth={1.4} aria-hidden="true" />
              <h2 className="font-display font-normal text-[#53684c] text-[31px] tracking-[-0.5px] leading-[1.25] max-[700px]:text-[25px]">
                Every good stay
                <br />
                starts with hello.
              </h2>
              <p className="mt-3.25 mb-0 text-sm max-[700px]:text-[13px]">
                Choose a request to read the conversation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Conversation({
  role,
  request,
  listing,
  token,
  onUpdated,
}: {
  role: Role;
  request: StayRequest;
  listing: Listing;
  token: string;
  onUpdated: (request: StayRequest) => void;
}) {
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [generation, setGeneration] = useState<
    "idle" | "streaming" | "failed" | "complete"
  >("idle");
  const [generationError, setGenerationError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"sending" | "accepting" | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const generating = generation === "streaming";

  async function suggest() {
    setPartial("");
    setGenerationError("");
    setGeneration("streaming");
    const abort = new AbortController();
    controller.current = abort;
    let text = "";
    let complete = false;
    function receive(line: string) {
      if (!line.trim()) return;
      const event = JSON.parse(line) as ReplyEvent;
      if (event.type === "text") {
        text += event.text;
        setPartial(text);
      }
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") complete = true;
    }
    try {
      const response = await fetch(`/api/requests/${request.id}/reply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(
          result.error ?? "The suggestion could not be generated.",
        );
      }
      if (!response.body)
        throw new Error("The reply stream is unavailable. Please try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) receive(line);
        if (chunk.done) break;
      }
      receive(buffer);
      if (!complete)
        throw new Error(
          "The suggestion ended early. Your draft is still here. Please try again.",
        );
      setDraft(text);
      setGeneration("complete");
      setPartial("");
    } catch (cause) {
      if (abort.signal.aborted) return;
      setGeneration("failed");
      setGenerationError((cause as Error).message);
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || generating) return;
    setBusy("sending");
    setError("");
    try {
      onUpdated(
        await api<StayRequest>(`/requests/${request.id}/messages`, token, {
          body: draft,
        }),
      );
      setDraft("");
      setGeneration("idle");
      setGenerationError("");
      setPartial("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function accept() {
    setBusy("accepting");
    setError("");
    try {
      onUpdated(
        await api<StayRequest>(`/requests/${request.id}/accept`, token, {}),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className={`conversation p-7.5 max-[1000px]:p-6 max-[700px]:p-5 ${role === "guest" ? "guest-conversation page-width mx-auto w-[min(1168px,_calc(100%_-_80px))] [&.guest-conversation]:max-w-200 [&.guest-conversation]:pt-8.5 [&.guest-conversation]:pb-16.25 max-[1000px]:w-[calc(100%_-_48px)] max-[700px]:w-[calc(100%_-_40px)] max-[700px]:[&.guest-conversation]:px-0 max-[700px]:[&.guest-conversation]:pt-6.5 max-[700px]:[&.guest-conversation]:pb-8.75" : "host-conversation [&_>_.conversation-back]:hidden max-[700px]:[&_>_.conversation-back]:inline-flex"}`}
      aria-label="Stay conversation"
      data-testid="conversation"
    >
      <a
        className="back-link conversation-back gap-1.75 min-h-11 inline-flex items-center text-[13px] text-muted mb-6 hover:text-ink max-[700px]:mb-5.75 max-[700px]:text-xs"
        href={role === "host" ? "#/inbox" : "#/trips"}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {role === "host" ? "All requests" : "Your trips"}
      </a>
      <header className="conversation-heading gap-3.75 flex items-center justify-between mb-6 [&_>_div_>_p:last-child]:text-xs [&_>_div_>_p:last-child]:text-muted [&_>_div_>_p:last-child]:mt-2 max-[700px]:mb-5 max-[700px]:[&_>_div_>_p:last-child]:text-xs max-[700px]:[&_>_div_>_p:last-child]:leading-[1.6] max-[700px]:[&_>_div_>_p:last-child]:max-w-51.25">
        <div>
          <p className="eyebrow text-muted text-xs font-semibold tracking-[1.9px] leading-[1.6] max-[700px]:text-[11px] max-[700px]:tracking-[1.5px]">
            {role === "host" ? "YOUR GUEST" : "YOUR HOST"}
          </p>
          <h1 className="font-display text-[27px] font-normal tracking-[-0.4px] mt-1.75 max-[700px]:text-[25px]">
            {role === "host" ? request.guestName : listing.hostName}
          </h1>
          <p>
            {role === "host"
              ? "A new place. A warm welcome."
              : "A little conversation goes a long way."}
          </p>
        </div>
        <Status status={request.status} />
      </header>
      <div className="conversation-stay p-3.5 gap-3.5 flex items-center bg-soft border border-line rounded-lg [&_>_.icon-button]:border-0 [&_>_.icon-button]:bg-transparent max-[700px]:p-2.5 max-[700px]:gap-2.5 max-[700px]:[&_>_.icon-button]:hidden">
        <img
          className="w-22 h-17.25 object-cover rounded-md max-[700px]:w-16.25 max-[700px]:h-17.25"
          src={listing.image}
          alt={listing.imageAlt}
        />
        <div className="flex-1 min-w-0">
          <strong className="text-sm font-semibold max-[700px]:text-sm">
            {listing.title}
          </strong>
          <p className="text-muted text-xs mt-1.5 max-[700px]:text-xs">
            {listing.location}
          </p>
          <span className="block text-muted text-xs mt-2.25 max-[700px]:text-xs">
            {dates(request)}
            <span className="meta-dot mx-2">·</span>
            {request.guests} guests
          </span>
        </div>
        {role === "guest" && (
          <a
            href={`#/stays/${listing.id}`}
            className="icon-button size-11 border border-line rounded-md bg-surface text-muted inline-flex justify-center items-center shrink-0 hover:bg-soft"
            aria-label={`View ${listing.title}`}
          >
            <ArrowRight size={18} />
          </a>
        )}
      </div>
      {request.status === "accepted" && (
        <div
          className="accepted-banner p-3.75 gap-2.75 mt-4.75 flex items-start border border-[#dce8ce] rounded-lg bg-[#f0f6e8] text-muted max-[700px]:p-3 max-[700px]:gap-2.25"
          role="status"
        >
          <ShieldCheck size={21} aria-hidden="true" />
          <div>
            <strong className="text-[13px] font-medium text-[#607b50] max-[700px]:text-xs">
              {role === "guest"
                ? "You’re welcome here."
                : "You’ve made room for a great stay."}
            </strong>
            <p className="text-xs leading-[1.7] mt-1.25 max-[700px]:text-xs">
              {role === "guest"
                ? "Your host accepted your request. Your conversation stays right here."
                : "The request is accepted. Your guest can see the update in their trip."}
            </p>
          </div>
        </div>
      )}
      <div className="conversation-messages mt-5.75" aria-label="Messages">
        <p className="conversation-date text-center text-xs text-muted mb-5.75">
          {date(request.createdAt.slice(0, 10))} · Your conversation
        </p>
        {request.messages.map((message) => (
          <div
            className={`message gap-2.5 flex items-start mb-5.75 [&_>_div]:max-w-[83%] max-[700px]:[&_>_div]:max-w-[84%] max-[700px]:gap-2 ${message.sender === role ? "message-own flex-row-reverse [&_.message-author]:justify-end [&_.message-body]:bg-soft [&_.message-body]:border-line [&_.message-body]:rounded-[8px_0_8px_8px]" : "message-other"}`}
            key={message.id}
          >
            <span
              className={`message-avatar [&.message-avatar]:size-7.5 [&.message-avatar]:text-xs max-[700px]:[&.message-avatar]:size-6.25 max-[700px]:[&.message-avatar]:text-[11px] ${message.sender === "host" ? "host-avatar size-9.5 rounded-full inline-flex items-center justify-center bg-soft text-accent text-[13px] font-semibold shrink-0" : "guest-avatar size-9.5 rounded-full inline-flex items-center justify-center bg-sand text-sand-ink text-[13px] font-semibold shrink-0"}`}
              aria-hidden="true"
            >
              {message.sender === "host" ? "MC" : "AM"}
            </span>
            <div>
              <div className="message-author mx-0 gap-2.25 flex items-center mt-0.5 mb-2.25 max-[700px]:gap-1.75 max-[700px]:text-xs">
                <strong className="text-xs font-semibold">
                  {message.senderName}
                </strong>
                <span className="text-muted text-xs">
                  {message.sender === role
                    ? "You"
                    : message.sender === "host"
                      ? "Host"
                      : "Guest"}
                </span>
              </div>
              <p className="message-body py-3.25 px-3.75 whitespace-pre-wrap wrap-anywhere bg-soft border border-line text-muted text-sm leading-[1.75] rounded-[0_8px_8px_8px] max-[700px]:py-2.75 max-[700px]:px-3 max-[700px]:text-[13px]">
                {message.body}
              </p>
            </div>
          </div>
        ))}
      </div>
      <form className="reply-form pt-5 border-t border-t-line" onSubmit={send}>
        <div className="reply-heading gap-3 flex items-center justify-between mb-3 min-h-6.5 max-[700px]:gap-1.5">
          <label
            className="text-[13px] max-[700px]:text-xs"
            htmlFor={`reply-${request.id}`}
          >
            {role === "host" ? "Reply to guest" : "Message your host"}
          </label>
          {role === "host" && (
            <button
              className="suggest-button py-1.75 px-2.25 gap-1.5 min-h-11 inline-flex items-center border border-[#dce5d2] text-muted bg-[#f5f8ef] rounded-md text-xs enabled:hover:bg-[#ecf2e2] max-[700px]:p-1.75 max-[700px]:gap-1.25 max-[700px]:text-xs max-[700px]:[&_>_svg]:w-3.25"
              type="button"
              onClick={() => void suggest()}
              disabled={generating || busy !== null}
            >
              {generating ? (
                <LoaderCircle
                  size={15}
                  className="spinner animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles size={15} aria-hidden="true" />
              )}
              {generating
                ? "Writing a suggestion…"
                : generation === "failed"
                  ? "Try again"
                  : "Suggest a reply"}
            </button>
          )}
        </div>
        {generating && (
          <div
            className="suggestion-preview py-3.25 px-3.75 border border-[#d9e3cc] rounded-lg bg-[#f5f8ee] mb-3"
            role="status"
            aria-label="Suggested reply"
          >
            <div className="gap-1.5 flex items-center text-muted text-xs">
              <Sparkles size={14} aria-hidden="true" />
              <span>Suggestion in progress</span>
            </div>
            <p className="min-h-8 text-[13px] leading-[1.8] mt-2.5 whitespace-pre-wrap text-[#637957]">
              {partial || "Thinking about your guest’s plans…"}
            </p>
            <span className="suggestion-hint block text-muted text-xs mt-2.5">
              A draft for you to review. Nothing has been sent.
            </span>
          </div>
        )}
        {generation === "failed" && (
          <div className="suggestion-error mb-3.5 [&_.error-message]:mb-1.75">
            <ErrorMessage message={generationError} />
            <p className="text-xs text-muted leading-[1.7]">
              Your draft and conversation are unchanged. Try again or write your
              own reply.
            </p>
          </div>
        )}
        <textarea
          className="py-3 px-3.5 bg-surface min-h-24 max-[700px]:text-base"
          id={`reply-${request.id}`}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            role === "host"
              ? "A warm welcome, a local tip, a helpful answer…"
              : "Ask a question or share a little more about your plans…"
          }
          disabled={generating || busy === "sending"}
        />
        <div className="reply-actions gap-3.75 flex justify-between items-center mt-2.5 [&_>_.button]:shrink-0 max-[700px]:gap-3 max-[700px]:flex-wrap max-[700px]:[&_.button]:py-2.5 max-[700px]:[&_.button]:px-2.75 max-[700px]:[&_.button]:text-xs">
          <p className="text-xs text-muted leading-[1.6] max-[700px]:text-[11px] max-[700px]:max-w-40">
            {role === "host"
              ? generation === "complete"
                ? "Suggested draft · Review and make it yours."
                : "AI suggestions are scripted in this demo."
              : "Sent directly to your host."}
          </p>
          <button
            className="button small py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
            disabled={!draft.trim() || generating || busy !== null}
          >
            {busy === "sending" ? (
              <LoaderCircle
                size={15}
                className="spinner animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Send size={15} aria-hidden="true" />
            )}
            {role === "host" ? "Send reply" : "Send message"}
          </button>
        </div>
      </form>
      {error && <ErrorMessage message={error} />}
      {role === "host" && request.status === "pending" && (
        <div className="accept-request gap-5 flex items-center justify-between border-t border-t-line pt-5.25 mt-5.75 [&_>_.button]:py-2.5 [&_>_.button]:px-3.25 [&_>_.button]:whitespace-nowrap [&_>_.button]:text-xs max-[1000px]:gap-3 max-[1000px]:items-start max-[1000px]:flex-col max-[700px]:mt-5 max-[700px]:pt-4.5">
          <div>
            <strong className="text-[13px] font-medium">
              Ready to welcome {request.guestName.split(" ")[0]}?
            </strong>
            <p className="text-xs leading-[1.65] text-muted mt-1.5 max-[700px]:text-xs">
              Accepting updates their trip. Your messages stay together.
            </p>
          </div>
          <button
            className="button secondary py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
            type="button"
            onClick={() => void accept()}
            disabled={busy !== null || generating}
          >
            {busy === "accepting" ? (
              <LoaderCircle
                size={16}
                className="spinner animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            Accept request
          </button>
        </div>
      )}
    </section>
  );
}
