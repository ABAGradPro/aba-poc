// ABA edit mode: runs inside the preview (origin localhost:4000) and talks to the ABA page
// (origin localhost:5173) with postMessage only. It never changes files itself; it only
// reports what the user picked or dragged, and the API makes the change.
//
// Messages from ABA → here:  { type: 'aba:edit', on: boolean }, { type: 'aba:clear' }
// Messages here → ABA:       aba:select { id, rect, tag, label }
//                            aba:move   { id, parentId, beforeId }   (drag)
//                            aba:offset { id, dx, dy }               (Alt-drag)

/** Replaced by the preview server with the GUI's origin, e.g. "http://localhost:5173". */
const PARENT_ORIGIN = '__ABA_PARENT_ORIGIN__';
const ID_ATTR = 'data-aba-id';
const DRAG_THRESHOLD = 5; // pixels before a press becomes a drag

let on = false;
let hovered: HTMLElement | null = null;
let selected: HTMLElement | null = null;
let drag: {
  el: HTMLElement;
  alt: boolean;
  startX: number;
  startY: number;
  active: boolean;
  drop?: { target: HTMLElement; before: boolean };
} | null = null;

const style = document.createElement('style');
style.textContent = `
.__aba-on [${ID_ATTR}] { cursor: pointer; }
.__aba-hover { outline: 2px dashed #8b5cf6 !important; outline-offset: 2px !important; }
.__aba-selected { outline: 2px solid #7c3aed !important; outline-offset: 2px !important; cursor: grab !important; }
.__aba-dragging { opacity: .6 !important; cursor: grabbing !important; }
.__aba-drop-before { box-shadow: 0 -4px 0 0 #22c55e !important; }
.__aba-drop-after { box-shadow: 0 4px 0 0 #22c55e !important; }
`;

function send(message: Record<string, unknown>): void {
  window.parent.postMessage(message, PARENT_ORIGIN);
}

function idOf(el: Element | null): string | null {
  return el?.getAttribute(ID_ATTR) ?? null;
}

/** The nearest element (itself or an ancestor) that has a data-aba-id. */
function pick(node: EventTarget | null): HTMLElement | null {
  const el = node instanceof Element ? node : null;
  return (el?.closest(`[${ID_ATTR}]`) as HTMLElement | null) ?? null;
}

function setHover(el: HTMLElement | null): void {
  hovered?.classList.remove('__aba-hover');
  hovered = el && el !== selected ? el : null;
  hovered?.classList.add('__aba-hover');
}

function select(el: HTMLElement | null): void {
  selected?.classList.remove('__aba-selected');
  selected = el;
  if (!el) return;
  el.classList.remove('__aba-hover');
  el.classList.add('__aba-selected');
  const r = el.getBoundingClientRect();
  const label = (el.innerText || el.getAttribute('alt') || el.tagName).trim().slice(0, 60);
  send({
    type: 'aba:select',
    id: idOf(el),
    tag: el.tagName.toLowerCase(),
    label,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
  });
}

function clearDropMarks(): void {
  document.querySelectorAll('.__aba-drop-before, .__aba-drop-after').forEach((n) => {
    n.classList.remove('__aba-drop-before', '__aba-drop-after');
  });
}

function setOn(value: boolean): void {
  on = value;
  document.documentElement.classList.toggle('__aba-on', on);
  if (!on) {
    setHover(null);
    select(null);
    clearDropMarks();
  }
}

// --- messages from the ABA page (and only from it)
window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== PARENT_ORIGIN || e.source !== window.parent) return;
  const data = e.data as { type?: string; on?: boolean } | null;
  if (data?.type === 'aba:edit') setOn(Boolean(data.on));
  if (data?.type === 'aba:clear') select(null);
});

// --- hover and click
document.addEventListener(
  'mouseover',
  (e) => {
    if (on && !drag?.active) setHover(pick(e.target));
  },
  true,
);

document.addEventListener(
  'click',
  (e) => {
    if (!on) return;
    // In edit mode a click picks an element instead of following links or submitting forms.
    e.preventDefault();
    e.stopPropagation();
    const el = pick(e.target);
    if (el) select(el);
  },
  true,
);

document.addEventListener('keydown', (e) => {
  if (on && e.key === 'Escape') {
    select(null);
    send({ type: 'aba:select', id: null });
  }
});

// --- drag (move) and Alt-drag (offset), only on the selected element
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!on || !selected || e.button !== 0) return;
    if (pick(e.target) !== selected) return;
    drag = { el: selected, alt: e.altKey, startX: e.clientX, startY: e.clientY, active: false };
  },
  true,
);

document.addEventListener(
  'pointermove',
  (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.active) {
      drag.active = true;
      drag.el.classList.add('__aba-dragging');
      setHover(null);
    }
    e.preventDefault();
    if (drag.alt) {
      drag.el.style.translate = `${dx}px ${dy}px`; // preview only; the API writes the real rule
      return;
    }
    // Find where it would be dropped: before or after the element under the pointer.
    drag.el.style.pointerEvents = 'none';
    const under = pick(document.elementFromPoint(e.clientX, e.clientY));
    drag.el.style.pointerEvents = '';
    clearDropMarks();
    drag.drop = undefined;
    if (!under || under === drag.el || drag.el.contains(under)) return;
    const r = under.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    under.classList.add(before ? '__aba-drop-before' : '__aba-drop-after');
    drag.drop = { target: under, before };
  },
  true,
);

document.addEventListener(
  'pointerup',
  (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('__aba-dragging');
    clearDropMarks();
    if (!d.active) return;
    e.preventDefault();
    const id = idOf(d.el);
    if (d.alt) {
      send({
        type: 'aba:offset',
        id,
        dx: Math.round(e.clientX - d.startX),
        dy: Math.round(e.clientY - d.startY),
      });
      return;
    }
    if (!d.drop) return;
    const { target, before } = d.drop;
    const parent = target.parentElement;
    let beforeEl: Element | null = before ? target : target.nextElementSibling;
    while (beforeEl && (beforeEl === d.el || !idOf(beforeEl))) beforeEl = beforeEl.nextElementSibling;
    send({
      type: 'aba:move',
      id,
      parentId: parent && parent !== document.body ? idOf(parent) : null,
      beforeId: idOf(beforeEl),
    });
  },
  true,
);

// Swallow the click that ends a drag so it does not select something else.
document.addEventListener(
  'dragstart',
  (e) => {
    if (on) e.preventDefault();
  },
  true,
);

document.head.appendChild(style);
send({ type: 'aba:ready' });
