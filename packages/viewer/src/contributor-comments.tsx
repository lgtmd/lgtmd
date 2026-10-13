import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MessageSquareText, X } from "lucide-react";

/** Presentation of authored notes, without adding a conversation backend. */
export function ContributorComments({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => {
    cancelClose();
    setOpen(false);
    setPinned(false);
  };
  const reveal = () => {
    cancelClose();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(352, window.innerWidth - 32);
    const height = Math.min(400, window.innerHeight - 32);
    setPosition({
      left: Math.max(
        16,
        Math.min(rect.right - width, window.innerWidth - width - 16),
      ),
      top: Math.max(
        16,
        Math.min(rect.bottom + 8, window.innerHeight - height - 16),
      ),
    });
    setOpen(true);
  };
  const leave = () => {
    if (!pinned) timer.current = setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const exit = setTimeout(() => setPresent(false), 120);
    return () => clearTimeout(exit);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const height = panel.current.offsetHeight;
    setPosition((position) => ({
      ...position,
      top: Math.max(
        16,
        anchor.bottom + 8 + height <= window.innerHeight - 16
          ? anchor.bottom + 8
          : anchor.top - height - 8,
      ),
    }));
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    const reposition = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", reposition);
    // Dismiss when the document moves, but allow scrolling inside the card.
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  return (
    <aside
      className="contributor-notes"
      data-lgtmd-part="notes"
      aria-label="Contributor notes"
    >
      <button
        ref={trigger}
        className="comment-marker inline-flex items-center justify-center gap-1"
        aria-label={`Contributor notes (${count})`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") reveal();
        }}
        onPointerLeave={leave}
        onClick={(event) => {
          if (pinned) close();
          else {
            reveal();
            setPinned(true);
            if (event.detail === 0)
              requestAnimationFrame(() => panel.current?.focus());
          }
        }}
      >
        <MessageSquareText size={17} strokeWidth={1.75} aria-hidden="true" />
        {count > 1 ? <span>{count}</span> : null}
      </button>
      {open || present
        ? createPortal(
            <section
              ref={panel}
              id={id}
              role="dialog"
              tabIndex={-1}
              aria-label="Contributor notes"
              className="comment-popover"
              data-state={open ? "open" : "closed"}
              aria-hidden={!open}
              inert={!open}
              style={position}
              onPointerEnter={cancelClose}
              onPointerLeave={leave}
              onFocusCapture={() => {
                cancelClose();
                setPinned(true);
              }}
            >
              <header className="comment-heading flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquareText
                    size={15}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <strong>Notes</strong>
                  <span className="comment-count">{count}</span>
                </div>
                <button
                  aria-label="Close contributor notes"
                  onClick={() => {
                    close();
                    trigger.current?.focus();
                  }}
                >
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </header>
              <div className="prose comment-body">{children}</div>
            </section>,
            document.body,
          )
        : null}
    </aside>
  );
}
