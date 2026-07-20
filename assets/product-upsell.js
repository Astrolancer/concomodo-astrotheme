import { ThemeEvents, CartUpdateEvent } from '@theme/events';
import { fetchConfig } from '@theme/utilities';

/**
 * <product-upsell>
 *
 * Product-page upsell that talks to the rest of the page:
 *
 * - Optional topper cards in mutually exclusive choice (adding one removes the
 *   other), inheriting the Dimensione/Misure selected on the main product.
 * - A gift pillow that reads the cart: as soon as a topper is in the cart —
 *   added from this block OR from any other block on the page (e.g. the
 *   recommendations cards) — the pillow is auto-added free of charge, flagged
 *   with a hidden `_in_regalo` line property. When the last topper leaves the
 *   cart, the flagged pillow leaves with it. A pillow the customer pays for
 *   (no flag) is never touched.
 * - Bundle behaviour: adds from this block also put the main product (the
 *   mattress, in the selected variant) in the cart when it is not there yet,
 *   so the upsell CTA buys everything together.
 *
 * Toppers are recognised in the cart either by the products configured in the
 * block settings or by a configurable keyword matched against the cart line's
 * product title/type (default "topper").
 *
 * The component only renders the promo prices. The actual cart prices must be
 * backed by automatic discounts configured in the Shopify admin.
 */

const GIFT_FLAG = '_in_regalo';
const GIFT_PROPERTY_LABEL = 'Omaggio';

/**
 * Reads the Dimensione/Misure currently selected on the page's main variant picker.
 * Returns null when the page has no picker exposing those options.
 *
 * @returns {{dimensione?: string, misure?: string} | null}
 */
function readMainSelection() {
  for (const picker of document.querySelectorAll('variant-picker')) {
    // Ignore pickers rendered inside quick-add modals.
    if (picker.closest('dialog')) continue;

    const selection = {};

    for (const fieldset of picker.querySelectorAll('fieldset[data-option-name]')) {
      const name = fieldset.dataset.optionName;
      const checked = fieldset.querySelector('input:checked');
      if (name && checked instanceof HTMLInputElement) selection[name] = checked.value;
    }

    for (const select of picker.querySelectorAll('select[data-option-name]')) {
      const name = select.dataset.optionName;
      if (name && select.value) selection[name] = select.value;
    }

    if (selection.Dimensione || selection.Misure) {
      return { dimensione: selection.Dimensione, misure: selection.Misure };
    }
  }

  return null;
}

/**
 * Reads the page's main product form (the mattress): its product id and the
 * currently selected variant id. Forms living inside cards, dialogs or upsell
 * components are ignored.
 *
 * @returns {{productId: number, variantId: number} | null}
 */
function readMainProduct() {
  for (const component of document.querySelectorAll('product-form-component')) {
    if (component.closest('dialog, product-card, linked-size-add, product-upsell')) continue;

    const input = component.querySelector('input[name="id"]');
    if (!(input instanceof HTMLInputElement) || !input.value) continue;

    const productId = Number(component.getAttribute('data-product-id'));
    const variantId = Number(input.value);
    if (!productId || !variantId) continue;

    return { productId, variantId };
  }

  return null;
}

class ProductUpsell extends HTMLElement {
  /** @type {Array<Object>} */
  #rows = [];

  /** @type {{items?: Array<Object>, item_count?: number} | null} */
  #cart = null;

  #busy = false;

  /** Set when the customer removes the gift while a topper is in the cart, so we stop re-adding it. */
  #giftDeclined = false;

  #abortController = new AbortController();

  connectedCallback() {
    this.#rows = Array.from(this.querySelectorAll('[data-upsell-row]'))
      .map((element) => {
        const source = element.querySelector('[data-upsell-variants]');
        let variants = [];

        try {
          variants = JSON.parse(source?.textContent ?? '[]');
        } catch {
          return null;
        }

        return {
          element,
          role: element.dataset.upsellRole === 'gift' ? 'gift' : 'topper',
          productId: Number(element.dataset.productId),
          linked: element.dataset.linked === 'true',
          variants,
          matched: null,
        };
      })
      .filter(Boolean);

    if (this.#rows.length === 0) return;

    const { signal } = this.#abortController;

    this.addEventListener('click', this.#handleClick, { signal });

    // The picker checks the real radio during the capture phase of `change`, and
    // morphs itself once the fetch resolves. Listening to both keeps rows in step.
    document.addEventListener('change', this.#syncSizes, { signal });
    document.addEventListener(ThemeEvents.variantUpdate, this.#syncSizes, { signal });
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleExternalCartUpdate, { signal });

    this.#syncSizes();
    this.#refreshCart({ announce: false });
  }

  disconnectedCallback() {
    this.#abortController.abort();
  }

  get #giftEnabled() {
    return this.dataset.giftEnabled === 'true';
  }

  get #bundleMain() {
    return this.dataset.bundleMain === 'true';
  }

  get #soloPercent() {
    return Number(this.dataset.soloPercent ?? 0);
  }

  get #topperKeyword() {
    return (this.dataset.topperKeyword ?? '').trim().toLowerCase();
  }

  get #mattressKeyword() {
    return (this.dataset.mattressKeyword ?? '').trim().toLowerCase();
  }

  /** Product ids configured as toppers, with or without a rendered card. */
  get #topperProductIds() {
    return (this.dataset.topperProducts ?? '')
      .split(',')
      .map((value) => Number(value))
      .filter(Boolean);
  }

  get #toppers() {
    return this.#rows.filter((row) => row.role === 'topper');
  }

  get #gift() {
    return this.#rows.find((row) => row.role === 'gift') ?? null;
  }

  /** @returns {Array<Object>} */
  #items() {
    return Array.isArray(this.#cart?.items) ? this.#cart.items : [];
  }

  /** @param {Object} row */
  #itemsOf(row) {
    return this.#items().filter((item) => item.product_id === row.productId);
  }

  /**
   * Whether a cart line is a topper: either one of the configured topper
   * products, or a product whose title/type matches the topper keyword.
   *
   * @param {Object} item
   */
  #isTopperItem(item) {
    if (this.#topperProductIds.includes(item.product_id)) return true;

    const keyword = this.#topperKeyword;
    if (!keyword) return false;

    const title = String(item.product_title ?? '').toLowerCase();
    const type = String(item.product_type ?? '').toLowerCase();
    return title.includes(keyword) || type.includes(keyword);
  }

  #topperItemsInCart() {
    const gift = this.#gift;
    return this.#items().filter((item) => {
      if (gift && item.product_id === gift.productId) return false;
      return this.#isTopperItem(item);
    });
  }

  /**
   * Whether the cart holds a mattress: the page's main product, or any line
   * whose product title/type matches the mattress keyword.
   */
  #hasMattressInCart() {
    const main = readMainProduct();
    if (main && this.#items().some((item) => item.product_id === main.productId)) return true;

    const keyword = this.#mattressKeyword;
    if (!keyword) return false;

    return this.#items().some((item) => {
      const title = String(item.product_title ?? '').toLowerCase();
      const type = String(item.product_type ?? '').toLowerCase();
      return title.includes(keyword) || type.includes(keyword);
    });
  }

  /** The gift is free when the cart holds the bundle: topper + mattress. */
  #bundleInCart() {
    return this.#topperItemsInCart().length > 0 && this.#hasMattressInCart();
  }

  /** The topper row (if rendered) whose product is in the cart. */
  #selectedTopperRow() {
    return this.#toppers.find((row) => this.#itemsOf(row).length > 0) ?? null;
  }

  /** Resolves which variant of each row matches the main product's selection. */
  #syncSizes = () => {
    const selection = readMainSelection();

    for (const row of this.#rows) {
      if (row.role === 'gift' || !row.linked) {
        row.matched = row.variants.find((variant) => variant.available) ?? row.variants[0] ?? null;
        continue;
      }

      if (!selection?.dimensione || !selection.misure) {
        row.matched = null;
        continue;
      }

      row.matched =
        row.variants.find(
          (variant) => variant.dimensione === selection.dimensione && variant.misure === selection.misure
        ) ?? null;
    }

    this.#render();
  };

  #render() {
    const selection = readMainSelection();
    const bundleInCart = this.#bundleInCart();

    for (const row of this.#rows) {
      const { element } = row;
      const inCart = this.#itemsOf(row).length > 0;
      const addButton = element.querySelector('[data-upsell-add]');
      const addLabel = element.querySelector('[data-upsell-add-label]');
      const removeButton = element.querySelector('[data-upsell-remove]');
      const priceElement = element.querySelector('[data-upsell-price]');
      const compareElement = element.querySelector('[data-upsell-compare]');
      const badgeElement = element.querySelector('[data-upsell-badge]');
      const metaElement = element.querySelector('[data-upsell-meta]');
      const sizeElement = element.querySelector('[data-upsell-size]');

      element.toggleAttribute('data-selected', inCart);
      if (addButton instanceof HTMLButtonElement) addButton.hidden = inCart;
      if (removeButton instanceof HTMLElement) removeButton.hidden = !inCart;

      if (row.role === 'topper') {
        // A size-linked topper has nothing to inherit on a page without sizes.
        if (row.linked && !selection) {
          element.hidden = true;
          continue;
        }

        element.hidden = false;

        const purchasable = Boolean(row.matched?.available);

        if (addButton instanceof HTMLButtonElement) {
          addButton.disabled = !purchasable;
          if (addLabel) {
            addLabel.textContent = purchasable
              ? addButton.dataset.labelDefault ?? ''
              : addButton.dataset.labelUnavailable ?? '';
          }
        }

        if (metaElement instanceof HTMLElement && sizeElement) {
          const line = this.#itemsOf(row)[0];
          const sizeText = inCart ? line?.variant_title ?? '' : row.matched?.sizeLabel ?? '';
          sizeElement.textContent = sizeText;
          metaElement.hidden = !sizeText;
        }

        if (row.matched) {
          if (priceElement) priceElement.textContent = row.matched.price;
          if (compareElement instanceof HTMLElement) {
            compareElement.hidden = !row.matched.compareAt;
            compareElement.textContent = row.matched.compareAt ?? '';
          }
        }

        continue;
      }

      // Gift row.
      const variant = row.matched;

      if (!variant) {
        element.hidden = true;
        continue;
      }

      element.hidden = false;

      const isFree = bundleInCart && this.#giftEnabled;
      const hasSoloDiscount = this.#soloPercent > 0;
      const struckPrice = variant.compareAt ?? variant.price;

      if (badgeElement instanceof HTMLElement) {
        const badgeText = isFree
          ? element.dataset.giftBadge ?? ''
          : hasSoloDiscount
            ? element.dataset.soloBadge ?? ''
            : '';
        badgeElement.textContent = badgeText;
        badgeElement.hidden = !badgeText;
      }

      if (priceElement) {
        priceElement.textContent = isFree
          ? element.dataset.freeLabel ?? ''
          : hasSoloDiscount
            ? variant.soloPrice ?? variant.price
            : variant.price;
      }

      if (compareElement instanceof HTMLElement) {
        const showCompare = isFree || hasSoloDiscount || Boolean(variant.compareAt);
        compareElement.hidden = !showCompare;
        compareElement.textContent = showCompare ? struckPrice : '';
      }

      if (addButton instanceof HTMLButtonElement) {
        addButton.disabled = !variant.available;
        if (addLabel) {
          addLabel.textContent = variant.available
            ? addButton.dataset.labelDefault ?? ''
            : addButton.dataset.labelUnavailable ?? '';
        }
      }
    }
  }

  /**
   * Keeps the gift in step with the cart, wherever the topper came from: a
   * topper in the cart with no gift yet auto-adds the flagged gift; no topper
   * left with a flagged gift still in the cart removes it. Lines without the
   * flag (a pillow the customer pays for) are never touched.
   */
  async #autoSyncGift() {
    const gift = this.#gift;
    if (!gift || !this.#giftEnabled || this.#busy) return;

    const bundleInCart = this.#bundleInCart();
    const giftLines = this.#itemsOf(gift);
    const flaggedLines = giftLines.filter((item) => item.properties?.[GIFT_FLAG]);

    if (bundleInCart && giftLines.length === 0 && !this.#giftDeclined && gift.matched?.available) {
      this.#setBusy(true);
      try {
        await this.#add([{ id: gift.matched.id, quantity: 1, properties: this.#giftProperties() }]);
        await this.#refreshCart({ announce: true });
      } catch (error) {
        console.error(error);
      } finally {
        this.#setBusy(false);
      }
      return;
    }

    if (!bundleInCart && flaggedLines.length > 0) {
      this.#setBusy(true);
      try {
        for (const line of flaggedLines) await this.#change(line.key, 0);
        await this.#refreshCart({ announce: true });
      } catch (error) {
        console.error(error);
      } finally {
        this.#setBusy(false);
      }
      return;
    }

    if (!bundleInCart) this.#giftDeclined = false;
  }

  /** @param {MouseEvent} event */
  #handleClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const rowElement = target?.closest('[data-upsell-row]');
    if (!rowElement) return;

    const row = this.#rows.find((candidate) => candidate.element === rowElement);
    if (!row) return;

    if (target?.closest('[data-upsell-add]')) {
      event.preventDefault();
      if (row.role === 'topper') this.#addTopper(row);
      else this.#addGift(row);
    } else if (target?.closest('[data-upsell-remove]')) {
      event.preventDefault();
      if (row.role === 'topper') this.#removeTopper(row);
      else this.#removeGift(row);
    }
  };

  /**
   * The main product (mattress) as a cart item, when bundling is on and it is
   * not in the cart yet.
   */
  #mainBundleItem() {
    if (!this.#bundleMain) return null;

    const main = readMainProduct();
    if (!main) return null;

    const alreadyInCart = this.#items().some((item) => item.product_id === main.productId);
    if (alreadyInCart) return null;

    return { id: main.variantId, quantity: 1 };
  }

  /**
   * Adds items, retrying without the bundled mattress if the combined request
   * fails (e.g. the selected mattress variant just went out of stock).
   *
   * @param {Array<Object>} items
   * @param {Object | null} mainItem
   */
  async #addWithMain(items, mainItem) {
    if (!mainItem) {
      await this.#add(items);
      return;
    }

    try {
      await this.#add([mainItem, ...items]);
    } catch (error) {
      console.error(error);
      await this.#add(items);
    }
  }

  /**
   * Adds a topper in the size inherited from the main product, bundling the
   * mattress when needed. The other topper is removed first (mutually
   * exclusive choice) and the gift is added alongside, flagged as such, unless
   * it is already in the cart.
   *
   * @param {Object} row
   */
  async #addTopper(row) {
    if (this.#busy || !row.matched?.available) return;
    this.#setBusy(true);

    try {
      const updates = {};
      for (const other of this.#toppers) {
        if (other === row) continue;
        for (const item of this.#itemsOf(other)) updates[item.variant_id] = 0;
      }
      if (Object.keys(updates).length > 0) await this.#update(updates);

      const items = [{ id: row.matched.id, quantity: 1 }];
      const gift = this.#gift;

      if (this.#giftEnabled && gift?.matched?.available && this.#itemsOf(gift).length === 0 && !this.#giftDeclined) {
        items.push({ id: gift.matched.id, quantity: 1, properties: this.#giftProperties() });
      }

      await this.#addWithMain(items, this.#mainBundleItem());
      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  /**
   * Removes a topper. If it was the last topper, the pillow lines that were
   * auto-added as a gift are removed too; a pillow the customer added on its
   * own (no gift flag) is left in the cart.
   *
   * @param {Object} row
   */
  async #removeTopper(row) {
    if (this.#busy) return;
    this.#setBusy(true);

    try {
      const updates = {};
      for (const item of this.#itemsOf(row)) updates[item.variant_id] = 0;
      if (Object.keys(updates).length > 0) await this.#update(updates);

      await this.#refreshCart({ announce: false });

      const gift = this.#gift;

      if (gift && !this.#bundleInCart()) {
        const flaggedLines = this.#itemsOf(gift).filter((item) => item.properties?.[GIFT_FLAG]);
        for (const line of flaggedLines) await this.#change(line.key, 0);
      }

      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  /**
   * Adds the gift pillow. With a topper in the cart it goes in flagged (free —
   * backed by the admin discount); alone it goes in as a normal purchase,
   * bundling the mattress when needed.
   *
   * @param {Object} row
   */
  async #addGift(row) {
    if (this.#busy || !row.matched?.available) return;
    this.#setBusy(true);

    try {
      const bundleInCart = this.#bundleInCart();
      const item = { id: row.matched.id, quantity: 1 };

      if (this.#giftEnabled && bundleInCart) {
        item.properties = this.#giftProperties();
        this.#giftDeclined = false;
        await this.#add([item]);
      } else {
        await this.#addWithMain([item], this.#mainBundleItem());
      }

      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  /** @param {Object} row */
  async #removeGift(row) {
    if (this.#busy) return;
    this.#setBusy(true);

    try {
      if (this.#bundleInCart()) this.#giftDeclined = true;

      const updates = {};
      for (const item of this.#itemsOf(row)) updates[item.variant_id] = 0;
      if (Object.keys(updates).length > 0) await this.#update(updates);

      await this.#refreshCart({ announce: true });
    } catch (error) {
      console.error(error);
    } finally {
      this.#setBusy(false);
    }
  }

  #giftProperties() {
    const properties = { [GIFT_FLAG]: '1' };
    const note = this.dataset.giftCartProperty;
    if (note) properties[GIFT_PROPERTY_LABEL] = note;
    return properties;
  }

  /** @param {Array<{id: number, quantity: number, properties?: Object}>} items */
  async #add(items) {
    const response = await fetch(
      Theme.routes.cart_add_url,
      fetchConfig('json', { body: JSON.stringify({ items }) })
    );
    const data = await response.json();
    if (data.status) throw new Error(data.description ?? data.message ?? 'Cart add failed');
    return data;
  }

  /** @param {Record<string, number>} updates */
  async #update(updates) {
    const response = await fetch(
      `${Theme.routes.cart_update_url}.js`,
      fetchConfig('json', { body: JSON.stringify({ updates }) })
    );
    const data = await response.json();
    if (data.status) throw new Error(data.description ?? data.message ?? 'Cart update failed');
    return data;
  }

  /**
   * Removes a single line by its key, so gift lines can be told apart from a
   * pillow the customer is paying for.
   *
   * @param {string} key
   * @param {number} quantity
   */
  async #change(key, quantity) {
    const response = await fetch(
      `${Theme.routes.cart_change_url}.js`,
      fetchConfig('json', { body: JSON.stringify({ id: key, quantity }) })
    );
    const data = await response.json();
    if (data.status) throw new Error(data.description ?? data.message ?? 'Cart change failed');
    return data;
  }

  /** @param {{announce: boolean}} options */
  async #refreshCart({ announce }) {
    try {
      const response = await fetch(`${Theme.routes.cart_url}.js`);
      this.#cart = await response.json();
    } catch (error) {
      console.error(error);
      return;
    }

    if (announce) {
      document.dispatchEvent(
        new CartUpdateEvent(this.#cart, this.id || 'product-upsell', {
          itemCount: this.#cart?.item_count ?? 0,
          source: 'product-upsell',
        })
      );
    }

    this.#render();
  }

  /** @param {CustomEvent} event */
  #handleExternalCartUpdate = async (event) => {
    if (event.detail?.data?.source === 'product-upsell') return;

    const resource = event.detail?.resource;

    if (Array.isArray(resource?.items)) {
      this.#cart = resource;
      this.#render();
    } else {
      await this.#refreshCart({ announce: false });
    }

    // A topper added or removed anywhere on the page drives the gift.
    this.#autoSyncGift();
  };

  /** @param {boolean} busy */
  #setBusy(busy) {
    this.#busy = busy;
    this.toggleAttribute('data-busy', busy);
  }
}

if (!customElements.get('product-upsell')) {
  customElements.define('product-upsell', ProductUpsell);
}
