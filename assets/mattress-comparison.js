import { Component } from '@theme/component';

/**
 * Two-mattress comparison section.
 *
 * Handles the "?" tooltips (click to toggle, close on outside click / Escape)
 * and toggles an `is-stuck` class on the sticky info bar so its shadow only
 * appears while the bar is pinned to the top.
 *
 * @typedef {Object} MattressComparisonRefs
 * @property {HTMLElement} [stickyBar]
 *
 * @extends {Component<MattressComparisonRefs>}
 */
export class MattressComparisonComponent extends Component {
  /** @type {AbortController | null} */
  #abort = null;
  /** @type {IntersectionObserver | null} */
  #stuckObserver = null;

  connectedCallback() {
    super.connectedCallback();
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    document.addEventListener('click', this.#handleOutsideClick, { signal });
    document.addEventListener('keydown', this.#handleKeydown, { signal });

    this.#observeStuck();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#stuckObserver?.disconnect();
    this.#stuckObserver = null;
  }

  #observeStuck() {
    const bar = this.refs.stickyBar;
    if (!bar) return;

    // Detection line sits 1px above the bar's resting sticky position, so the
    // element gets clipped (ratio < 1) exactly when it becomes pinned.
    const stuckTop = parseFloat(getComputedStyle(bar).top) || 0;

    this.#stuckObserver = new IntersectionObserver(
      ([entry]) => bar.classList.toggle('is-stuck', entry.intersectionRatio < 1),
      { threshold: [1], rootMargin: `${-(stuckTop + 1)}px 0px 0px 0px` }
    );
    this.#stuckObserver.observe(bar);
  }

  /**
   * Toggle a tooltip bubble. Bound via `on:click="/toggleTip"` on the button.
   * @param {MouseEvent} event
   */
  toggleTip(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const tip = target.closest('[data-tip]');
    if (!(tip instanceof HTMLElement)) return;

    const willOpen = !tip.classList.contains('is-open');
    this.#closeAll();
    tip.classList.toggle('is-open', willOpen);
    tip.querySelector('[data-tip-btn]')?.setAttribute('aria-expanded', String(willOpen));
  }

  #closeAll() {
    for (const tip of this.querySelectorAll('[data-tip].is-open')) {
      tip.classList.remove('is-open');
      tip.querySelector('[data-tip-btn]')?.setAttribute('aria-expanded', 'false');
    }
  }

  #handleOutsideClick = (/** @type {MouseEvent} */ event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest('[data-tip]')) this.#closeAll();
  };

  #handleKeydown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') this.#closeAll();
  };
}

customElements.define('mattress-comparison-component', MattressComparisonComponent);
