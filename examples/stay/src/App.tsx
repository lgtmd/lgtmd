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
    <p className="error-message" role="alert">
      <CircleAlert size={17} aria-hidden="true" />
      {message}
    </p>
  );
}

function Status({ status }: { status: StayRequest["status"] }) {
  return (
    <span className={`status status-${status}`}>
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
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Stay home">
          <House size={28} strokeWidth={1.8} aria-hidden="true" />
          <span>
            stay<span className="brand-dot">.</span>
          </span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          {role === "guest" ? (
            <>
              <a
                href="#/"
                aria-current={
                  !section || section === "stays" ? "page" : undefined
                }
              >
                Explore stays
              </a>
              <a
                className="assistant-nav-link"
                href="#/assistant"
                aria-current={section === "assistant" ? "page" : undefined}
              >
                <Sparkles size={14} aria-hidden="true" />
                Ask Stay
              </a>
              <a
                href="#/trips"
                aria-current={section === "trips" ? "page" : undefined}
              >
                Your trips
              </a>
            </>
          ) : (
            <a href="#/inbox" aria-current="page">
              Host inbox
            </a>
          )}
        </nav>
        <div className="identity">
          <span className="identity-name">
            {actor?.name ?? (role === "host" ? "Host" : "Guest")}
          </span>
          <span className="avatar" aria-hidden="true">
            {role === "host" ? "MC" : "AM"}
          </span>
        </div>
      </header>
      <div className="demo-bar">
        <span>
          <span className="demo-dot" />
          An interactive demo
          <span className="demo-description">
            {" "}
            · A shared space for guests and hosts
          </span>
        </span>
        <div className="role-switch" role="group" aria-label="Demo role">
          <button
            type="button"
            aria-pressed={role === "guest"}
            onClick={() => switchRole("guest")}
          >
            Guest view
          </button>
          <button
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
          <div className="loading-state" role="status">
            <LoaderCircle className="spinner" size={22} aria-hidden="true" />
            Opening your space…
          </div>
        ) : error ? (
          <div className="page-width page-error">
            <ErrorMessage message={error} />
            {expired ? (
              <>
                <p className="expired-help">
                  The local server no longer has this demo. Start a fresh space
                  to explore again.
                </p>
                <button className="button secondary" onClick={startFresh}>
                  Start a fresh demo
                </button>
              </>
            ) : (
              <button
                className="button secondary"
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
              <div className="empty-state page-width">
                <House size={32} />
                <h1>This stay could not be found.</h1>
                <a className="button" href="#/">
                  Explore stays
                </a>
              </div>
            )}
            {role === "host" && section === "stays" && (
              <div className="empty-state page-width">
                <h1>Your host space</h1>
                <a className="button" href="#/inbox">
                  Open inbox
                </a>
              </div>
            )}
          </>
        ) : null}
      </main>
      <footer className="site-footer">
        <span className="footer-brand">stay.</span>
        <span>A little further from ordinary.</span>
        <span className="footer-note">
          Fictional stays · Local demo · No payments
        </span>
      </footer>
    </div>
  );
}

function Explore({ listings }: { listings: Listing[] }) {
  return (
    <div className="page-width explore-page">
      <div className="explore-heading">
        <div>
          <p className="eyebrow">THOUGHTFUL PLACES. UNHURRIED DAYS.</p>
          <h1>
            A little further
            <br />
            from ordinary.
          </h1>
        </div>
        <p className="intro">
          A quiet cabin, a sunlit loft, a house among the trees. Find somewhere
          that feels like a deep breath.
        </p>
      </div>
      <ListingFilters listings={listings}>
        {(filtered) => (
          <div className="listing-grid">
            {filtered.map((listing) => (
              <a
                className="listing-card"
                key={listing.id}
                href={`#/stays/${listing.id}`}
              >
                <div className="listing-image">
                  <img src={listing.image} alt={listing.imageAlt} />
                  <span className="image-tag">
                    {
                      [
                        "Among the trees",
                        "In the neighborhood",
                        "By the coast",
                      ][listings.indexOf(listing)]
                    }
                  </span>
                  <span className="image-link" aria-hidden="true">
                    <ArrowRight size={20} />
                  </span>
                </div>
                <div className="listing-location">
                  <MapPin size={13} aria-hidden="true" />
                  {listing.location}
                </div>
                <h3>{listing.title}</h3>
                <p>
                  {listing.bedrooms} bedroom{listing.bedrooms === 1 ? "" : "s"}{" "}
                  <span>·</span> Up to {listing.capacity} guests
                </p>
                <div className="listing-price">
                  <strong>{money(listing.nightlyRate)}</strong>
                  <span> / night</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </ListingFilters>
      <div className="explore-note">
        <Leaf size={21} aria-hidden="true" />
        <p>
          <strong>Good stays start with a conversation.</strong>
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
    <div className="page-width detail-page">
      <a className="back-link" href="#/">
        <ArrowLeft size={16} aria-hidden="true" />
        All stays
      </a>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">A PLACE TO SETTLE IN</p>
          <h1>{listing.title}</h1>
          <p>
            <MapPin size={15} aria-hidden="true" />
            {listing.location}
          </p>
        </div>
        <span className="detail-caption">
          <Leaf size={16} aria-hidden="true" />
          Room to slow down
        </span>
      </div>
      <div className="detail-layout">
        <div className="property-content">
          <div className="detail-image">
            <img src={listing.image} alt={listing.imageAlt} />
          </div>
          <div className="property-summary">
            <div>
              <h2>
                Your own little corner of {listing.location.split(",")[0]}
              </h2>
              <p>
                {listing.capacity} guests <span>·</span> {listing.bedrooms}{" "}
                bedroom{listing.bedrooms === 1 ? "" : "s"} <span>·</span>{" "}
                {listing.beds} bed{listing.beds === 1 ? "" : "s"}
              </p>
            </div>
            <span className="host-avatar" aria-hidden="true">
              MC
            </span>
          </div>
          <p className="property-description">{listing.description}</p>
          <div className="amenities" aria-label="Amenities">
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
                <span key={amenity}>
                  <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                  {amenity}
                </span>
              );
            })}
          </div>
          <div className="host-note">
            <span className="avatar" aria-hidden="true">
              MC
            </span>
            <div>
              <strong>Hosted by {listing.hostName}</strong>
              <p>Ask a question, share your plans, feel at home.</p>
            </div>
          </div>
        </div>
        <aside className="request-card" aria-labelledby="request-heading">
          <div className="rate">
            <strong>{money(listing.nightlyRate)}</strong>
            <span> / night</span>
          </div>
          <h2 id="request-heading">Make a little room for a getaway.</h2>
          <form onSubmit={submit}>
            <div className="date-fields">
              <label>
                Check-in
                <input
                  type="date"
                  required
                  value={checkIn}
                  onChange={(event) => setCheckIn(event.target.value)}
                />
              </label>
              <label>
                Check-out
                <input
                  type="date"
                  required
                  value={checkOut}
                  onChange={(event) => setCheckOut(event.target.value)}
                />
              </label>
            </div>
            <div className="guest-field">
              <label>
                Guests
                <input
                  type="number"
                  min="1"
                  max={listing.capacity}
                  required
                  value={guests}
                  aria-describedby="guests-hint"
                  onChange={(event) => setGuests(event.target.value)}
                />
              </label>
              <p className="field-hint" id="guests-hint">
                Room for up to {listing.capacity} guests
              </p>
            </div>
            <label>
              Message to host
              <textarea
                required
                rows={4}
                placeholder="Say hello and tell Maya a little about your stay…"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            {error && <ErrorMessage message={error} />}
            <button className="button full-width" disabled={busy}>
              {busy ? (
                <LoaderCircle
                  size={17}
                  className="spinner"
                  aria-hidden="true"
                />
              ) : null}
              {busy ? "Sending request…" : "Request to stay"}
              {!busy && <ArrowRight size={17} aria-hidden="true" />}
            </button>
            <p className="request-help">
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
    <div className="page-width trips-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SOMEWHERE TO LOOK FORWARD TO</p>
          <h1>Your trips</h1>
          <p>Your requests and conversations, all in one place.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh requests"
          onClick={() => void onRefresh()}
          disabled={refreshing}
        >
          <RefreshCw size={18} className={refreshing ? "spinner" : ""} />
        </button>
      </div>
      {!requests.length ? (
        <div className="empty-state">
          <House size={34} strokeWidth={1.4} aria-hidden="true" />
          <h2>Your next chapter starts here.</h2>
          <p>Find a stay you love and send your first request.</p>
          <a className="button" href="#/">
            Explore stays
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="trip-grid">
          {requests.map((request) => {
            const listing = listings.find(
              (item) => item.id === request.listingId,
            );
            if (!listing) return null;
            return (
              <a
                className="trip-card"
                href={`#/trips/${request.id}`}
                key={request.id}
              >
                <img src={listing.image} alt={listing.imageAlt} />
                <div>
                  <Status status={request.status} />
                  <h2>{listing.title}</h2>
                  <p>{listing.location}</p>
                  <div className="trip-meta">
                    {dates(request)}
                    <span>·</span>
                    {request.guests} guests
                  </div>
                  <span className="text-link">
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
    <div className={`page-width inbox-page ${selected ? "has-selection" : ""}`}>
      <div className="page-heading inbox-heading">
        <div>
          <p className="eyebrow">A THOUGHTFUL WELCOME STARTS HERE</p>
          <h1>Inbox</h1>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh requests"
          onClick={() => void onRefresh()}
          disabled={refreshing}
        >
          <RefreshCw size={18} className={refreshing ? "spinner" : ""} />
        </button>
      </div>
      <div className="inbox-layout">
        <aside className="inbox-list" aria-label="Stay requests">
          <div className="inbox-list-heading">
            <h2>Stay requests</h2>
            <span>{requests.length}</span>
          </div>
          {!requests.length && (
            <p className="inbox-empty">
              A little quiet for now. New requests will appear here.
            </p>
          )}
          {requests.map((request) => {
            const listing = listings.find(
              (item) => item.id === request.listingId,
            );
            return (
              <a
                className={`inbox-item ${selected?.id === request.id ? "selected" : ""}`}
                href={`#/inbox/${request.id}`}
                key={request.id}
                aria-current={selected?.id === request.id ? "page" : undefined}
              >
                <span className="guest-avatar" aria-hidden="true">
                  AM
                </span>
                <div>
                  <div className="inbox-item-heading">
                    <strong>{request.guestName}</strong>
                    <span
                      className={`status-dot ${request.status}`}
                      aria-label={request.status}
                    />
                  </div>
                  <p className="inbox-listing-name">{listing?.title}</p>
                  <p className="inbox-preview">
                    {request.messages.at(-1)?.body}
                  </p>
                  <span className="inbox-dates">
                    {dates(request)} · {request.guests} guests
                  </span>
                </div>
                <ChevronRight size={15} aria-hidden="true" />
              </a>
            );
          })}
        </aside>
        <div className="inbox-detail">
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
            <div className="empty-state inbox-prompt">
              <MessageCircle size={35} strokeWidth={1.4} aria-hidden="true" />
              <h2>
                Every good stay
                <br />
                starts with hello.
              </h2>
              <p>Choose a request to read the conversation.</p>
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
      className={`conversation ${role === "guest" ? "guest-conversation page-width" : "host-conversation"}`}
      aria-label="Stay conversation"
      data-testid="conversation"
    >
      <a
        className="back-link conversation-back"
        href={role === "host" ? "#/inbox" : "#/trips"}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {role === "host" ? "All requests" : "Your trips"}
      </a>
      <header className="conversation-heading">
        <div>
          <p className="eyebrow">
            {role === "host" ? "YOUR GUEST" : "YOUR HOST"}
          </p>
          <h1>{role === "host" ? request.guestName : listing.hostName}</h1>
          <p>
            {role === "host"
              ? "A new place. A warm welcome."
              : "A little conversation goes a long way."}
          </p>
        </div>
        <Status status={request.status} />
      </header>
      <div className="conversation-stay">
        <img src={listing.image} alt={listing.imageAlt} />
        <div>
          <strong>{listing.title}</strong>
          <p>{listing.location}</p>
          <span>
            {dates(request)}
            <span className="meta-dot">·</span>
            {request.guests} guests
          </span>
        </div>
        {role === "guest" && (
          <a
            href={`#/stays/${listing.id}`}
            className="icon-button"
            aria-label={`View ${listing.title}`}
          >
            <ArrowRight size={18} />
          </a>
        )}
      </div>
      {request.status === "accepted" && (
        <div className="accepted-banner" role="status">
          <ShieldCheck size={21} aria-hidden="true" />
          <div>
            <strong>
              {role === "guest"
                ? "You’re welcome here."
                : "You’ve made room for a great stay."}
            </strong>
            <p>
              {role === "guest"
                ? "Your host accepted your request. Your conversation stays right here."
                : "The request is accepted. Your guest can see the update in their trip."}
            </p>
          </div>
        </div>
      )}
      <div className="conversation-messages" aria-label="Messages">
        <p className="conversation-date">
          {date(request.createdAt.slice(0, 10))} · Your conversation
        </p>
        {request.messages.map((message) => (
          <div
            className={`message ${message.sender === role ? "message-own" : "message-other"}`}
            key={message.id}
          >
            <span
              className={`message-avatar ${message.sender === "host" ? "host-avatar" : "guest-avatar"}`}
              aria-hidden="true"
            >
              {message.sender === "host" ? "MC" : "AM"}
            </span>
            <div>
              <div className="message-author">
                <strong>{message.senderName}</strong>
                <span>
                  {message.sender === role
                    ? "You"
                    : message.sender === "host"
                      ? "Host"
                      : "Guest"}
                </span>
              </div>
              <p className="message-body">{message.body}</p>
            </div>
          </div>
        ))}
      </div>
      <form className="reply-form" onSubmit={send}>
        <div className="reply-heading">
          <label htmlFor={`reply-${request.id}`}>
            {role === "host" ? "Reply to guest" : "Message your host"}
          </label>
          {role === "host" && (
            <button
              className="suggest-button"
              type="button"
              onClick={() => void suggest()}
              disabled={generating || busy !== null}
            >
              {generating ? (
                <LoaderCircle
                  size={15}
                  className="spinner"
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
            className="suggestion-preview"
            role="status"
            aria-label="Suggested reply"
          >
            <div>
              <Sparkles size={14} aria-hidden="true" />
              <span>Suggestion in progress</span>
            </div>
            <p>{partial || "Thinking about your guest’s plans…"}</p>
            <span className="suggestion-hint">
              A draft for you to review. Nothing has been sent.
            </span>
          </div>
        )}
        {generation === "failed" && (
          <div className="suggestion-error">
            <ErrorMessage message={generationError} />
            <p>
              Your draft and conversation are unchanged. Try again or write your
              own reply.
            </p>
          </div>
        )}
        <textarea
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
        <div className="reply-actions">
          <p>
            {role === "host"
              ? generation === "complete"
                ? "Suggested draft · Review and make it yours."
                : "AI suggestions are scripted in this demo."
              : "Sent directly to your host."}
          </p>
          <button
            className="button small"
            disabled={!draft.trim() || generating || busy !== null}
          >
            {busy === "sending" ? (
              <LoaderCircle size={15} className="spinner" aria-hidden="true" />
            ) : (
              <Send size={15} aria-hidden="true" />
            )}
            {role === "host" ? "Send reply" : "Send message"}
          </button>
        </div>
      </form>
      {error && <ErrorMessage message={error} />}
      {role === "host" && request.status === "pending" && (
        <div className="accept-request">
          <div>
            <strong>Ready to welcome {request.guestName.split(" ")[0]}?</strong>
            <p>Accepting updates their trip. Your messages stay together.</p>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={() => void accept()}
            disabled={busy !== null || generating}
          >
            {busy === "accepting" ? (
              <LoaderCircle size={16} className="spinner" aria-hidden="true" />
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
