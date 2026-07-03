import { Component } from '@theme/component';

/**
 * Two-mattress comparison section.
 *
 * Only behaviour needed here is the "?" tooltips: clicking a tooltip button
 * toggles its bubble, closes any other open one, and closes on outside click
 * or Escape. Everything else is static Liquid + CSS.
 *
 * @extends {Component}
 */
export class MattressComparisonComponent extends Component {
  /** @type {AbortController | null} */
  #abort = null;

  connectedCallback() {
    super.connectedCallback();
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    document.addEventListener('click', this.#handleOutsideClick, { signal });
    document.addEventListener('keydown', this.#handleKeydown, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
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
