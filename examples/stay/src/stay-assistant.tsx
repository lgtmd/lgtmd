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
import { api, streamAssistant } from "./api.ts";
import type {
  AssistantConversation,
  AssistantMessage,
} from "./assistant-domain.ts";
import type { Listing } from "./domain.ts";

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
  const [partial, setPartial] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerForm = useRef<HTMLFormElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const focusAfterSend = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (messages.current) {
      messages.current.scrollTop =
        conversation?.messages.length || pendingPrompt
          ? messages.current.scrollHeight
          : 0;
    }
    const completed = focusAfterSend.current;
    if (completed === undefined) return;
    focusAfterSend.current = undefined;
    if (completed !== generation.current) return;
    composerForm.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
    composer.current?.focus({ preventScroll: true });
  }, [conversation, busy, partial, pendingPrompt]);

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
      controller.current?.abort();
    };
  }, [token, loadAttempt]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || loading || busy || !conversation) return;
    const current = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setPartial("");
    setPendingPrompt(message);
    try {
      const next = await streamAssistant(
        token,
        message,
        abort.signal,
        (text) => {
          if (current === generation.current)
            setPartial((previous) => previous + text);
        },
      );
      if (current !== generation.current) return;
      focusAfterSend.current = current;
      setConversation(next);
      setDraft("");
    } catch (cause) {
      if (current === generation.current) setError((cause as Error).message);
    } finally {
      if (controller.current === abort) controller.current = null;
      if (current === generation.current) {
        setBusy(false);
        setPartial("");
        setPendingPrompt(null);
      }
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
    <div
      className="page-width assistant-page mx-auto gap-19 w-[min(1168px,_calc(100%_-_80px))] grid grid-cols-[minmax(230px,_0.8fr)_minmax(0,_1.6fr)] pt-15.5 pb-16 items-start max-[1000px]:gap-9 max-[1000px]:w-[calc(100%_-_48px)] max-[1000px]:grid-cols-[minmax(200px,_0.7fr)_minmax(0,_1.5fr)] max-[700px]:w-[calc(100%_-_40px)] max-[700px]:block max-[700px]:pt-7 max-[700px]:pb-8"
      data-testid="stay-assistant"
    >
      <div className="assistant-intro pt-5.5 max-[700px]:pt-0">
        <p className="eyebrow text-muted text-xs font-semibold tracking-[1.9px] leading-[1.6] max-[700px]:text-[11px] max-[700px]:tracking-[1.5px]">
          AI STAY FINDER
        </p>
        <h1
          className="font-display text-[clamp(36px,_3.6vw,_50px)] font-normal leading-[1.12] tracking-[-1.8px] mt-4.25 mb-5.5 max-[700px]:my-3 max-[700px]:text-[35px] max-[700px]:tracking-[-1.2px]"
          aria-label="Find your kind of stay"
        >
          Find your
          <br className="assistant-title-break max-[700px]:hidden" /> kind of
          stay<span className="text-[#aa8662]">.</span>
        </h1>
        <p className="assistant-description text-[15px] leading-[1.8] text-muted max-w-72.5 max-[700px]:text-sm max-[700px]:max-w-77.5 max-[700px]:leading-[1.8]">
          A few words about your trip. A little help finding a place that fits.
        </p>
        <div className="assistant-scope gap-3.25 mt-11.5 pt-6.5 border-t border-t-line flex items-start max-[700px]:hidden">
          <span className="assistant-scope-icon text-accent flex pt-0.75">
            <House size={20} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <div>
            <strong className="text-sm font-semibold">
              A small, thoughtful collection
            </strong>
            <p className="text-muted leading-[1.7] text-sm mt-2">
              Compare our three stays by place, nightly budget, guests and
              amenities.
            </p>
          </div>
        </div>
        <details className="assistant-demo-details mt-5.75 text-[13px] text-muted leading-[1.7] max-[700px]:mt-3.25 max-[700px]:text-xs max-[700px]:max-w-77.5">
          <summary className="cursor-pointer w-fit underline underline-offset-3">
            About this demo
          </summary>
          <p className="mt-2.25">
            Replies come from a scripted AI SDK mock. This example matches your
            preferences to local listings; it does not check availability, book
            a stay, or contact a host. Prices are per night, before any fees.
          </p>
        </details>
        <a
          className="assistant-explore-link gap-2 inline-flex items-center text-[13px] mt-7.5 font-semibold text-accent max-[700px]:hidden"
          href="#/"
        >
          Prefer to browse? Explore stays{" "}
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      </div>
      <section
        className="assistant-chat flex flex-col h-[min(680px,_calc(100dvh_-_240px))] min-h-105 overflow-hidden border border-line rounded-2xl bg-white shadow-[0_8px_26px_#253b3704] min-w-0 max-[700px]:h-[min(640px,_calc(100dvh_-_32px))] max-[700px]:mt-6.25 max-[700px]:rounded-2xl motion-reduce:[&_.spinner]:animate-none"
        aria-label="Stay finder conversation"
        aria-busy={loading || busy}
      >
        <header className="assistant-chat-header py-5 px-6.25 gap-3 shrink-0 flex items-center justify-between border-b border-b-line max-[700px]:py-3.75 max-[700px]:px-4">
          <div className="assistant-chat-identity gap-2.75 flex items-center">
            <span className="assistant-mark size-9 rounded-xl bg-soft text-accent grid place-items-center">
              <Sparkles size={18} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold max-[700px]:text-sm">
                Ask Stay
              </h2>
              <span className="assistant-demo-label block text-muted text-xs mt-0.75 max-[700px]:text-[11px]">
                Scripted demo
              </span>
            </div>
          </div>
          <button
            type="button"
            className="assistant-reset py-1.75 gap-1.5 min-h-11 flex items-center pr-0 pl-1.75 bg-transparent text-muted text-[13px] enabled:hover:text-accent max-[700px]:text-xs"
            onClick={() => void reset()}
            disabled={loading || busy || !conversation?.messages.length}
          >
            <RotateCcw size={14} aria-hidden="true" />
            New chat
          </button>
        </header>
        <div
          ref={messages}
          className="assistant-messages p-6.5 flex-1 min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] max-[700px]:py-4.5 max-[700px]:px-4"
          tabIndex={0}
          role="log"
          aria-label="Conversation with Stay"
          aria-live="polite"
          aria-relevant="additions"
        >
          {loading ? (
            <div
              className="assistant-loading gap-2.5 flex items-center justify-center min-h-76.25 text-sm text-muted"
              role="status"
            >
              <LoaderCircle
                size={20}
                className="spinner animate-spin"
                aria-hidden="true"
              />
              Opening your conversation…
            </div>
          ) : conversation &&
            conversation.messages.length === 0 &&
            !pendingPrompt ? (
            <div className="assistant-welcome py-2 max-[700px]:py-1.25">
              <span className="assistant-welcome-mark size-12 inline-grid place-items-center text-accent bg-soft rounded-2xl mb-5.25 max-[700px]:size-10 max-[700px]:mb-4.25 max-[700px]:rounded-xl max-[700px]:[&_>_svg]:w-5.5">
                <Sparkles size={26} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <h3 className="text-[23px] font-medium tracking-[-0.6px] leading-[1.3] max-[700px]:text-xl max-[700px]:max-w-57.5">
                Where would you like to unwind?
              </h3>
              <p className="text-sm text-muted leading-[1.8] max-w-97.5 mt-3 max-[700px]:text-[13px]">
                Tell me where, who’s coming, and what matters to you. We’ll
                narrow it down together.
              </p>
              <div
                className="assistant-starters gap-2 flex flex-col mt-6.25 [&_button_>_svg]:text-[#8e9982] [&_button:hover]:border-[#b4c1a8] [&_button:hover]:bg-[#f5f8ef] max-[700px]:gap-1.75 max-[700px]:mt-4.75"
                aria-label="Ideas to get started"
              >
                {starters.map((prompt) => (
                  <button
                    className="py-3 px-3.5 gap-3.25 min-h-11 flex justify-between items-center border border-line rounded-lg bg-canvas text-ink text-left text-[13px] leading-[1.5] max-[700px]:py-2.5 max-[700px]:px-2.75 max-[700px]:text-xs"
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
          {pendingPrompt && (
            <>
              <ChatTurn
                message={{
                  id: "pending-user",
                  role: "user",
                  text: pendingPrompt,
                }}
                listings={listings}
              />
              {partial && (
                <ChatTurn
                  pending
                  message={{
                    id: "pending-reply",
                    role: "assistant",
                    text: partial,
                  }}
                  listings={listings}
                />
              )}
            </>
          )}
          {busy && (
            <div
              className="assistant-pending gap-2 flex items-center text-muted text-[13px] pt-5.5"
              role="status"
            >
              <LoaderCircle
                size={15}
                className="spinner animate-spin"
                aria-hidden="true"
              />
              {partial
                ? "Writing your reply…"
                : "Finding your next little escape…"}
            </div>
          )}
        </div>
        <form
          ref={composerForm}
          className="assistant-composer px-5.75 shrink-0 pt-4.75 pb-4.5 border-t border-t-line bg-white max-[700px]:p-4"
          onSubmit={(event) => void send(event)}
        >
          {error && (
            <p
              className="assistant-error gap-2 flex items-start text-sm leading-[1.7] text-[#a44536] mb-3.25 [&_>_svg]:mt-0.75"
              role="alert"
            >
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
              className="button secondary small py-3.25 px-4.75 gap-2.25 inline-flex justify-center items-center border border-transparent bg-accent text-surface rounded-md text-sm font-medium leading-[1.4] min-h-11 enabled:hover:bg-accent-hover [&.secondary]:bg-surface [&.secondary]:text-accent [&.secondary]:border-[#c6d1bd] [&.secondary:hover:not(:disabled)]:bg-soft [&.small]:py-2.5 [&.small]:px-3.5 [&.small]:text-[13px]"
              onClick={() => setLoadAttempt((current) => current + 1)}
            >
              Try again
            </button>
          )}
          <label
            className="assistant-composer-label block text-[13px] font-semibold mb-2.5"
            htmlFor="stay-assistant-message"
          >
            What are you looking for?
          </label>
          <div className="assistant-input-row p-2.75 gap-2.5 flex items-end border border-line rounded-xl bg-canvas focus-within:border-[#809976] [&_textarea::placeholder]:text-muted [&_button:hover:not(:disabled)]:bg-accent-hover max-[700px]:p-2.5">
            <textarea
              className="p-0 flex-1 resize-y min-w-0 w-full min-h-11.25 max-h-45 border-0 bg-transparent text-sm leading-[1.65] text-ink outline-offset-2 max-[700px]:text-base"
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
              className="size-11 rounded-lg grid place-items-center bg-accent text-white shrink-0"
              type="submit"
              aria-label="Send message"
              disabled={loading || busy || !conversation || !draft.trim()}
            >
              <Send size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <p className="assistant-composer-help gap-2.5 flex justify-between text-muted text-[11px] mt-2.25 leading-[1.6] max-[700px]:text-[11px]">
            <span>Local listings · No live model calls</span>
            <span className="assistant-keyboard-help max-[1000px]:hidden">
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
  pending = false,
}: {
  pending?: boolean;
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
      className={`assistant-turn [&_+_.assistant-turn]:mt-6.75 ${isAssistant ? "assistant-reply" : "assistant-user py-3.5 px-4.25 bg-soft rounded-[13px_13px_3px_13px] ml-12 [&_.assistant-speaker]:text-muted [&_.assistant-speaker]:font-medium [&_.assistant-speaker]:mb-0.75 [&_.assistant-message-text]:text-sm max-[700px]:py-3 max-[700px]:px-3.25 max-[700px]:ml-6.5 max-[700px]:[&_.assistant-message-text]:text-[13px]"}`}
      data-testid={
        pending
          ? "assistant-streaming"
          : isAssistant
            ? "assistant-turn"
            : "assistant-user-turn"
      }
      aria-label={isAssistant ? "Stay reply" : "Your message"}
    >
      <p className="assistant-speaker gap-1.25 flex items-center text-accent text-xs font-semibold mb-2.25">
        {isAssistant ? (
          <>
            <Sparkles size={12} aria-hidden="true" />
            Stay
          </>
        ) : (
          "You"
        )}
      </p>
      <p className="assistant-message-text text-sm leading-[1.85] whitespace-pre-wrap wrap-anywhere max-[700px]:text-sm">
        {message.text}
      </p>
      {isAssistant && recommendations.length > 0 && (
        <div
          className="assistant-recommendations gap-2.75 grid grid-cols-1 mt-4.25"
          aria-label="Matching stays"
        >
          {recommendations.map((listing) => (
            <a
              className="assistant-stay-card flex border border-line rounded-xl overflow-hidden bg-white min-w-0 hover:border-[#aabb9c] max-[700px]:flex-col"
              key={listing.id}
              href={`#/stays/${listing.id}`}
              aria-label={listing.title}
            >
              <img
                className="w-[40%] min-w-0 object-cover aspect-[1] max-[1000px]:w-[37%] max-[700px]:w-full max-[700px]:aspect-[1.7]"
                src={listing.image}
                alt={listing.imageAlt}
              />
              <div className="assistant-stay-info p-4.25 flex-1 min-w-0 flex flex-col max-[1000px]:p-3.25 max-[700px]:p-3.5">
                <p className="assistant-stay-location gap-1 flex items-center text-muted text-[11px] max-[700px]:text-[11px]">
                  <MapPin size={11} aria-hidden="true" />
                  {listing.location}
                </p>
                <h3 className="text-[21px] leading-[1.3] font-medium tracking-[-0.5px] mt-1.75 max-[1000px]:text-[19px] max-[700px]:text-[22px]">
                  {listing.title}
                </h3>
                <p className="assistant-stay-capacity gap-1.25 flex items-center text-[11px] text-muted mt-2 flex-wrap max-[700px]:text-xs">
                  <Users size={12} aria-hidden="true" />
                  Up to {listing.capacity} guests<span>·</span>
                  {listing.bedrooms}{" "}
                  {listing.bedrooms === 1 ? "bedroom" : "bedrooms"}
                </p>
                <div className="assistant-stay-bottom gap-2.25 flex items-center justify-between mt-auto pt-5 max-[700px]:pt-3.25">
                  <p className="text-sm">
                    <strong className="font-semibold">
                      {money(listing.nightlyRate)}
                    </strong>
                    <span className="text-muted text-xs"> / night</span>
                  </p>
                  <span className="assistant-stay-arrow size-7.25 grid place-items-center border border-line rounded-full text-accent">
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
      {isAssistant && message.listingIds?.length === 0 && (
        <div className="assistant-no-matches p-4.25 gap-3 flex items-start border border-dashed border-[#d4dbc9] rounded-xl mt-3.75 bg-canvas text-muted [&_>_svg]:mt-0.25">
          <House size={20} strokeWidth={1.6} aria-hidden="true" />
          <div>
            <h3 className="text-ink text-sm font-semibold">
              No matching stays yet
            </h3>
            <p className="text-[13px] leading-[1.7] mt-1.25">
              Try a different budget, place or amenity. Tell me what you’d like
              to change.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
