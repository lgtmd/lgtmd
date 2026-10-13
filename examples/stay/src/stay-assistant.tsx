import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  CircleAlert,
  CornerDownLeft,
  House,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { api } from "./api.ts";
import type {
  AssistantConversation,
  AssistantMessage,
} from "./assistant-domain.ts";
import type { Listing } from "./domain.ts";
import "./stay-assistant.css";

const starters = [
  "A quiet stay for 3 guests under $200 with a kitchen",
  "Somewhere by the ocean for 2 guests",
  "A place in Portland with a workspace",
];
const money = (value: number) => `$${value.toLocaleString("en-US")}`;

export function StayAssistant({
  listings,
  token,
}: {
  listings: Listing[];
  token: string;
}) {
  const [conversation, setConversation] =
    useState<AssistantConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerForm = useRef<HTMLFormElement>(null);
  const focusAfterSend = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const completed = focusAfterSend.current;
    if (completed === undefined) return;
    focusAfterSend.current = undefined;
    if (completed !== generation.current) return;
    composerForm.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
    composer.current?.focus({ preventScroll: true });
  }, [conversation]);

  useEffect(() => {
    const current = ++generation.current;
    setConversation(null);
    setDraft("");
    setLoading(true);
    setBusy(false);
    setError("");
    void api<AssistantConversation>("/assistant", token)
      .then((next) => {
        if (current === generation.current) setConversation(next);
      })
      .catch((cause: unknown) => {
        if (current === generation.current) setError((cause as Error).message);
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      ++generation.current;
    };
  }, [token, loadAttempt]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || loading || busy || !conversation) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await api<AssistantConversation>(
        "/assistant/messages",
        token,
        { message },
      );
      if (current !== generation.current) return;
      focusAfterSend.current = current;
      setConversation(next);
      setDraft("");
    } catch (cause) {
      if (current === generation.current) setError((cause as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  async function reset() {
    if (busy || loading) return;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await api<AssistantConversation>(
        "/assistant/reset",
        token,
        {},
      );
      if (current !== generation.current) return;
      setConversation(next);
      setDraft("");
      composer.current?.focus({ preventScroll: true });
    } catch (cause) {
      if (current === generation.current) setError((cause as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  function choosePrompt(prompt: string) {
    setDraft(prompt);
    composer.current?.focus();
  }

  return (
    <div className="page-width assistant-page" data-testid="stay-assistant">
      <div className="assistant-intro">
        <p className="eyebrow">AI STAY FINDER</p>
        <h1 aria-label="Find your kind of stay">
          Find your
          <br className="assistant-title-break" /> kind of stay<span>.</span>
        </h1>
        <p className="assistant-description">
          A few words about your trip. A little help finding a place that fits.
        </p>
        <div className="assistant-scope">
          <span className="assistant-scope-icon">
            <House size={20} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <div>
            <strong>A small, thoughtful collection</strong>
            <p>
              Compare our three stays by place, nightly budget, guests and
              amenities.
            </p>
          </div>
        </div>
        <details className="assistant-demo-details">
          <summary>About this demo</summary>
          <p>
            Replies come from a scripted AI SDK mock. This example matches your
            preferences to local listings; it does not check availability, book
            a stay, or contact a host. Prices are per night, before any fees.
          </p>
        </details>
        <a className="assistant-explore-link" href="#/">
          Prefer to browse? Explore stays{" "}
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      </div>
      <section
        className="assistant-chat"
        aria-label="Stay finder conversation"
        aria-busy={loading || busy}
      >
        <header className="assistant-chat-header">
          <div className="assistant-chat-identity">
            <span className="assistant-mark">
              <Sparkles size={18} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div>
              <h2>Ask Stay</h2>
              <span className="assistant-demo-label">Scripted demo</span>
            </div>
          </div>
          <button
            type="button"
            className="assistant-reset"
            onClick={() => void reset()}
            disabled={loading || busy || !conversation?.messages.length}
          >
            <RotateCcw size={14} aria-hidden="true" />
            New chat
          </button>
        </header>
        <div
          className="assistant-messages"
          role="log"
          aria-label="Conversation with Stay"
          aria-live="polite"
          aria-relevant="additions"
        >
          {loading ? (
            <div className="assistant-loading" role="status">
              <LoaderCircle size={20} className="spinner" aria-hidden="true" />
              Opening your conversation…
            </div>
          ) : conversation && conversation.messages.length === 0 ? (
            <div className="assistant-welcome">
              <span className="assistant-welcome-mark">
                <Sparkles size={26} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <h3>Where would you like to unwind?</h3>
              <p>
                Tell me where, who’s coming, and what matters to you. We’ll
                narrow it down together.
              </p>
              <div
                className="assistant-starters"
                aria-label="Ideas to get started"
              >
                {starters.map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    disabled={busy}
                    onClick={() => choosePrompt(prompt)}
                  >
                    <span>{prompt}</span>
                    <CornerDownLeft size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            conversation?.messages.map((message) => (
              <ChatTurn
                key={message.id}
                message={message}
                listings={listings}
              />
            ))
          )}
          {busy && (
            <div className="assistant-pending" role="status">
              <LoaderCircle size={15} className="spinner" aria-hidden="true" />
              Finding your next little escape…
            </div>
          )}
        </div>
        <form
          ref={composerForm}
          className="assistant-composer"
          onSubmit={(event) => void send(event)}
        >
          {error && (
            <p className="assistant-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>
                {error}{" "}
                {conversation
                  ? "Your draft is still here. Try again when you’re ready."
                  : "You can try opening this conversation again."}
              </span>
            </p>
          )}
          {error && !conversation && (
            <button
              type="button"
              className="button secondary small"
              onClick={() => setLoadAttempt((current) => current + 1)}
            >
              Try again
            </button>
          )}
          <label
            className="assistant-composer-label"
            htmlFor="stay-assistant-message"
          >
            What are you looking for?
          </label>
          <div className="assistant-input-row">
            <textarea
              ref={composer}
              id="stay-assistant-message"
              value={draft}
              maxLength={1000}
              rows={2}
              readOnly={busy}
              disabled={loading || !conversation}
              placeholder="A cabin for two, with an ocean view…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={loading || busy || !conversation || !draft.trim()}
            >
              <Send size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <p className="assistant-composer-help">
            <span>Local listings · No live model calls</span>
            <span className="assistant-keyboard-help">
              Enter to send · Shift + Enter for a new line
            </span>
          </p>
        </form>
      </section>
    </div>
  );
}

function ChatTurn({
  message,
  listings,
}: {
  message: AssistantMessage;
  listings: Listing[];
}) {
  const recommendations = (message.listingIds ?? []).flatMap((id) => {
    const listing = listings.find((item) => item.id === id);
    return listing ? [listing] : [];
  });
  const isAssistant = message.role === "assistant";
  return (
    <article
      className={`assistant-turn ${isAssistant ? "assistant-reply" : "assistant-user"}`}
      data-testid={isAssistant ? "assistant-turn" : "assistant-user-turn"}
      aria-label={isAssistant ? "Stay reply" : "Your message"}
    >
      <p className="assistant-speaker">
        {isAssistant ? (
          <>
            <Sparkles size={12} aria-hidden="true" />
            Stay
          </>
        ) : (
          "You"
        )}
      </p>
      <p className="assistant-message-text">{message.text}</p>
      {isAssistant && recommendations.length > 0 && (
        <div className="assistant-recommendations" aria-label="Matching stays">
          {recommendations.map((listing) => (
            <a
              className="assistant-stay-card"
              key={listing.id}
              href={`#/stays/${listing.id}`}
              aria-label={listing.title}
            >
              <img src={listing.image} alt={listing.imageAlt} />
              <div className="assistant-stay-info">
                <p className="assistant-stay-location">
                  <MapPin size={11} aria-hidden="true" />
                  {listing.location}
                </p>
                <h3>{listing.title}</h3>
                <p className="assistant-stay-capacity">
                  <Users size={12} aria-hidden="true" />
                  Up to {listing.capacity} guests<span>·</span>
                  {listing.bedrooms}{" "}
                  {listing.bedrooms === 1 ? "bedroom" : "bedrooms"}
                </p>
                <div className="assistant-stay-bottom">
                  <p>
                    <strong>{money(listing.nightlyRate)}</strong>
                    <span> / night</span>
                  </p>
                  <span className="assistant-stay-arrow">
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
      {isAssistant && message.listingIds?.length === 0 && (
        <div className="assistant-no-matches">
          <House size={20} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <h3>No matching stays yet</h3>
            <p>
              Try a different budget, place or amenity. Tell me what you’d like
              to change.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
