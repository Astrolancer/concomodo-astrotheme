import { Component } from '@theme/component';
import { prefersReducedMotion } from '@theme/utilities';

/**
 * @typedef {Object} MattressLayersRefs
 * @property {HTMLElement} stage - The wrapper holding the stacked layer images.
 * @property {HTMLElement[]} [layers] - The individual layer image elements.
 * @property {HTMLElement[]} [captions] - The caption buttons (title + description).
 */

/**
 * Interactive "exploded view" of a mattress.
 *
 * On enter, the layers start collapsed (closed mattress) and, after a short beat,
 * animate outwards into a stacked "exploded" view where they stay.
 *
 * Clicking a caption (or a layer) highlights the matching layer + caption and
 * dims every other layer and caption. Clicking the active item again, clicking
 * outside, or pressing Escape resets the state.
 *
 * @extends {Component<MattressLayersRefs>}
 */
export class MattressLayersComponent extends Component {
  requiredRefs = ['stage'];

  /** @type {number | null} */
  #active = null;
  /** @type {IntersectionObserver | null} */
  #io = null;
  /** @type {AbortController | null} */
  #abort = null;
  /** @type {number} */
  #openTimer = 0;

  connectedCallback() {
    super.connectedCallback();

    this.#abort = new AbortController();
    const { signal } = this.#abort;

    // Reset when clicking anywhere outside the component or pressing Escape.
    document.addEventListener('click', this.#handleOutsideClick, { signal });
    document.addEventListener('keydown', this.#handleKeydown, { signal });

    if (prefersReducedMotion() || this.hasAttribute('data-no-animation')) {
      this.#open();
      return;
    }

    // Reveal (explode) the layers once the section scrolls into view.
    this.#io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.#io?.disconnect();
          this.#io = null;
          // Show the closed mattress briefly, then explode.
          this.#openTimer = window.setTimeout(() => this.#open(), 450);
        }
      },
      { threshold: 0.35 }
    );

    this.#io.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#io?.disconnect();
    this.#io = null;
    window.clearTimeout(this.#openTimer);
  }

  #open() {
    this.setAttribute('data-open', '');
  }

  /**
   * Toggle the active layer/caption. Bound declaratively via `on:click="/select"`.
   * The clicked element (caption or layer) must carry a `data-index` attribute.
   *
   * @param {MouseEvent} event
   */
  select(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = target.closest('[data-index]');
    if (!(item instanceof HTMLElement)) return;

    const index = Number(item.dataset.index);
    if (Number.isNaN(index)) return;

    this.#setActive(this.#active === index ? null : index);
  }

  /**
   * @param {number | null} index
   */
  #setActive(index) {
    this.#active = index;

    if (index === null) {
      this.removeAttribute('data-active');
    } else {
      this.setAttribute('data-active', String(index));
    }

    for (const el of [...(this.refs.layers ?? []), ...(this.refs.captions ?? [])]) {
      const isActive = index !== null && Number(el.dataset.index) === index;
      el.classList.toggle('is-active', isActive);
      if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(isActive));
    }
  }

  #handleOutsideClick = (/** @type {MouseEvent} */ event) => {
    if (this.#active === null) return;
    const target = /** @type {Node} */ (event.target);
    if (!this.contains(target)) this.#setActive(null);
  };

  #handleKeydown = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape' && this.#active !== null) this.#setActive(null);
  };
}

customElements.define('mattress-layers-component', MattressLayersComponent);
