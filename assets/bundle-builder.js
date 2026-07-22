import { CartAddEvent } from '@theme/events';

/**
 * <bundle-builder>
 *
 * A fixed "sleep set" builder for the collection/landing pages: the merchant
 * configures one mattress + one topper + one pillow in the theme editor, the
 * customer picks a single shared size (and how many sets), sees a live total,
 * and adds all three products to the cart in one request.
 *
 * The pillow can be flagged as "free": it is still added to the cart as a
 * normal line item (Shopify has no free-price-on-add), so its cost is meant to
 * be zeroed by an automatic discount configured in the admin ("buy mattress +
 * topper, get the pillow free"). The UI reflects this by excluding the pillow
 * from the displayed total and showing it as a saving.
 *
 * Adds happen through /cart/add.js with several items, exactly like the theme's
 * own linked-size-add bundle, and dispatch a CartAddEvent so the cart drawer,
 * cart bubble and section morphing keep working.
 */

const ADDED_STATE_DURATION = 2600;

/**
 * Formats an amount in cents against a Shopify money_format string.
 * Supports the {{amount}}, {{amount_with_comma_separator}},
 * {{amount_no_decimals}} and {{amount_no_decimals_with_comma_separator}}
 * placeholders — the ones the storefront actually emits.
 *
 * @param {number} cents
 * @param {string} format
 * @returns {string}
 */
function formatMoney(cents, format) {
  const value = Number(cents) || 0;
  // Some shops wrap money_format in markup (e.g. <span class="money">…</span>);
  // strip it so the result is safe to assign via textContent.
  const cleanFormat = String(format || '€{{amount}}').replace(/<[^>]+>/g, '');

  const withDelimiters = (number, precision, thousands, decimal) => {
    const fixed = (number / 100).toFixed(precision);
    const [whole, fraction] = fixed.split('.');
    const grouped = whole.replace(/(\d)(?=(\d{3})+$)/g, `$1${thousands}`);
    return precision && fraction ? `${grouped}${decimal}${fraction}` : grouped;
  };

  return cleanFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token) => {
    switch (token) {
      case 'amount':
        return withDelimiters(value, 2, '.', ',');
      case 'amount_with_comma_separator':
        return withDelimiters(value, 2, '.', ',');
      case 'amount_no_decimals':
        return withDelimiters(value, 0, '.', ',');
      case 'amount_no_decimals_with_comma_separator':
        return withDelimiters(value, 0, '.', ',');
      case 'amount_with_space_separator':
        return withDelimiters(value, 2, ' ', ',');
      default:
        return withDelimiters(value, 2, '.', ',');
    }
  });
}

class BundleBuilder extends HTMLElement {
  /**
   * @type {{
   *   cushionFree: boolean,
   *   moneyFormat: string,
   *   sizeOptionName: string,
   *   products: Record<string, {
   *     role: string,
   *     id: number,
   *     title: string,
   *     variants: Array<{ id: number, size: string, available: boolean, price: number, compareAt: number|null }>,
   *     single: boolean
   *   }>
   * } | null}
   */
  #data = null;

  /** @type {string} */
  #size = '';

  /** @type {number} */
  #quantity = 1;

  #abort = new AbortController();

  /** @type {number | undefined} */
  #addedTimeout;

  connectedCallback() {
    const source = this.querySelector('[data-bundle-data]');
    if (!source?.textContent) return;

    try {
      this.#data = JSON.parse(source.textContent);
    } catch {
      return;
    }
    if (!this.#data) return;

    const { signal } = this.#abort;

    // Initial size = first size button (already the first available one from Liquid).
    const firstSize = this.querySelector('[data-bundle-size]:not([disabled])');
    if (firstSize instanceof HTMLElement) this.#size = firstSize.dataset.bundleSize ?? '';

    for (const control of this.querySelectorAll('[data-bundle-size]')) {
      control.addEventListener('click', this.#onSizeClick, { signal });
    }

    this.querySelector('[data-bundle-qty-decrease]')?.addEventListener('click', () => this.#setQuantity(this.#quantity - 1), { signal });
    this.querySelector('[data-bundle-qty-increase]')?.addEventListener('click', () => this.#setQuantity(this.#quantity + 1), { signal });
    this.querySelector('[data-bundle-add]')?.addEventListener('click', this.#addSet, { signal });

    this.#render();
  }

  disconnectedCallback() {
    this.#abort.abort();
    clearTimeout(this.#addedTimeout);
  }

  /** @param {Event} event */
  #onSizeClick = (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement) || target.hasAttribute('disabled')) return;
    this.#size = target.dataset.bundleSize ?? '';
    this.#render();
  };

  /** @param {number} next */
  #setQuantity(next) {
    this.#quantity = Math.min(Math.max(1, next), 10);
    this.#render();
  }

  /**
   * Resolves the variant of a product that matches the current size. Single-variant
   * products (a one-size pillow) always use their first available variant.
   *
   * @param {{ variants: Array<{ id:number, size:string, available:boolean, price:number, compareAt:number|null }>, single:boolean }} product
   */
  #variantFor(product) {
    if (!product) return null;
    if (product.single) {
      return product.variants.find((v) => v.available) ?? product.variants[0] ?? null;
    }
    return (
      product.variants.find((v) => v.size === this.#size && v.available) ??
      product.variants.find((v) => v.size === this.#size) ??
      null
    );
  }

  #render() {
    const data = this.#data;
    if (!data) return;

    // Highlight the selected size.
    for (const control of this.querySelectorAll('[data-bundle-size]')) {
      const active = control instanceof HTMLElement && control.dataset.bundleSize === this.#size;
      control.setAttribute('aria-pressed', active ? 'true' : 'false');
      control.classList.toggle('is-selected', active);
    }

    let total = 0;
    let cushionSaving = 0;
    let addable = true;

    for (const [role, product] of Object.entries(data.products)) {
      const row = this.querySelector(`[data-bundle-row="${role}"]`);
      const variant = this.#variantFor(product);
      const isFreeCushion = role === 'cuscino' && data.cushionFree;

      if (row instanceof HTMLElement) {
        const priceEl = row.querySelector('[data-bundle-row-price]');
        const unavailableEl = row.querySelector('[data-bundle-row-unavailable]');
        const available = Boolean(variant?.available);

        row.classList.toggle('is-unavailable', !available);
        if (unavailableEl instanceof HTMLElement) unavailableEl.hidden = available;

        if (priceEl instanceof HTMLElement) {
          if (isFreeCushion) {
            priceEl.innerHTML = `<span class="bundle-builder__free">Gratis</span>`;
          } else if (variant) {
            priceEl.textContent = formatMoney(variant.price, data.moneyFormat);
          } else {
            priceEl.textContent = '—';
          }
        }
      }

      // A missing mattress/topper variant blocks the whole set; a missing pillow
      // just drops out of the set.
      if (!variant?.available) {
        if (role !== 'cuscino') addable = false;
        continue;
      }

      if (isFreeCushion) {
        cushionSaving += variant.price;
      } else {
        total += variant.price;
      }
    }

    const qty = this.#quantity;
    const totalEl = this.querySelector('[data-bundle-total]');
    if (totalEl instanceof HTMLElement) totalEl.textContent = formatMoney(total * qty, data.moneyFormat);

    const savingEl = this.querySelector('[data-bundle-saving]');
    const savingWrap = this.querySelector('[data-bundle-saving-wrap]');
    if (savingEl instanceof HTMLElement) savingEl.textContent = formatMoney(cushionSaving * qty, data.moneyFormat);
    if (savingWrap instanceof HTMLElement) savingWrap.hidden = cushionSaving <= 0;

    const qtyValue = this.querySelector('[data-bundle-qty-value]');
    if (qtyValue instanceof HTMLElement) qtyValue.textContent = String(qty);

    const addButton = this.querySelector('[data-bundle-add]');
    if (addButton instanceof HTMLButtonElement && !addButton.dataset.added) {
      addButton.disabled = !addable;
    }
  }

  /** Builds the list of line items for the current selection. */
  #items() {
    const data = this.#data;
    if (!data) return [];
    const items = [];
    for (const product of Object.values(data.products)) {
      const variant = this.#variantFor(product);
      if (variant?.available) items.push({ id: variant.id, quantity: this.#quantity });
    }
    return items;
  }

  #addSet = async () => {
    const data = this.#data;
    const button = this.querySelector('[data-bundle-add]');
    if (!data || !(button instanceof HTMLButtonElement) || button.disabled) return;

    const items = this.#items();
    if (items.length < 2) return; // need at least mattress + topper

    button.disabled = true;
    button.classList.add('is-loading');

    try {
      const sectionIds = [...document.querySelectorAll('cart-items-component')]
        .map((el) => (el instanceof HTMLElement ? el.dataset.sectionId : null))
        .filter(Boolean);

      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          sectionIds.length ? { items, sections: sectionIds.join(','), sections_url: window.location.pathname } : { items }
        ),
      });
      const result = await response.json();
      if (result.status) throw new Error(result.description ?? result.message ?? 'Cart add failed');

      const cart = await fetch(`${Theme.routes.cart_url}.js`).then((r) => r.json());

      this.dispatchEvent(
        new CartAddEvent(cart, this.id || 'bundle-builder', {
          source: 'bundle-builder',
          itemCount: cart?.item_count ?? 0,
          sections: result.sections,
        })
      );

      this.#showAdded(button);
    } catch (error) {
      console.error(error);
      button.disabled = false;
    } finally {
      button.classList.remove('is-loading');
    }
  };

  /** @param {HTMLButtonElement} button */
  #showAdded(button) {
    const label = button.querySelector('[data-bundle-add-label]') ?? button;
    if (!button.dataset.labelDefault) button.dataset.labelDefault = label.textContent ?? '';
    button.dataset.added = 'true';
    button.disabled = false;
    label.textContent = 'Set aggiunto ✓';

    clearTimeout(this.#addedTimeout);
    this.#addedTimeout = setTimeout(() => {
      delete button.dataset.added;
      label.textContent = button.dataset.labelDefault ?? '';
      this.#render();
    }, ADDED_STATE_DURATION);
  }
}

if (!customElements.get('bundle-builder')) {
  customElements.define('bundle-builder', BundleBuilder);
}
