import { CartUpdateEvent } from '@theme/events';

/**
 * <linked-size-add>
 *
 * Sits inside a recommended-product card and lets the customer add that product to the
 * cart in the same Dimensione/Misure they picked for the product they are looking at.
 *
 * It never adds anything silently: the trigger opens a confirmation dialog showing the
 * inherited size and the price of that exact variant. Confirming clicks the hidden
 * theme product form, so cart bubble, cart drawer and error handling keep working.
 *
 * On product pages (data-bundle-main="true") the add behaves like a bundle: if the
 * page's main product (the mattress, in the selected variant) is not in the cart yet,
 * it is added together with the recommended product — everything is bought in one go.
 * The dialog tells the customer when this is about to happen.
 *
 * Single-variant products (a pillow, a mattress protector) get the same dialog without
 * the size rows.
 */

const ADDED_STATE_DURATION = 2600;

/**
 * Reads the page's main product form (the mattress): its product id and the currently
 * selected variant id. Forms living inside cards, dialogs or upsell components are
 * ignored.
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

class LinkedSizeAdd extends HTMLElement {
  /** @type {Array<{id: number, dimensione: string, misure: string, available: boolean, price: string, compareAt?: string}>} */
  #variants = [];

  /** @type {{id: number, price: string, compareAt?: string} | null} */
  #matched = null;

  /** @type {number | undefined} */
  #addedTimeout;

  #abortController = new AbortController();

  connectedCallback() {
    const source = this.querySelector('[data-linked-size-variants]');
    if (!source?.textContent) return;

    try {
      this.#variants = JSON.parse(source.textContent);
    } catch {
      return;
    }

    const { signal } = this.#abortController;
    const { trigger } = this;
    const triggerLabel = trigger?.querySelector('[data-linked-trigger-label]');

    if (trigger && triggerLabel) trigger.dataset.labelDefault = triggerLabel.textContent?.trim() ?? '';

    trigger?.addEventListener('click', this.#openDialog, { signal });
    this.dialog?.addEventListener('click', this.#handleDialogClick, { signal });
    this.querySelector('[data-linked-confirm]')?.addEventListener('click', this.#confirm, { signal });
    this.addEventListener('cart:update', this.#handleCartUpdate, { signal });

    // The picker checks the real radio during the capture phase of `change`, and morphs
    // itself once the fetch resolves. Listening to both keeps the card in step.
    document.addEventListener('change', this.#sync, { signal });
    document.addEventListener('variant:update', this.#sync, { signal });

    this.#sync();
  }

  disconnectedCallback() {
    this.#abortController.abort();
    clearTimeout(this.#addedTimeout);
  }

  get isLinked() {
    return this.dataset.linked === 'true';
  }

  /** @returns {HTMLButtonElement | null} */
  get trigger() {
    return this.querySelector('[data-linked-trigger]');
  }

  /** @returns {HTMLDialogElement | null} */
  get dialog() {
    return this.querySelector('[data-linked-dialog]');
  }

  /** Resolves which variant of this product matches the main product's selection. */
  #sync = () => {
    if (!this.isLinked) {
      this.#matched = this.#variants.find((variant) => variant.available) ?? null;
      this.#render();
      return;
    }

    const selection = readMainSelection();

    // The page we're on doesn't expose sizes, so there is nothing to inherit.
    if (!selection?.dimensione || !selection.misure) {
      this.hidden = true;
      return;
    }

    this.hidden = false;
    this.#matched =
      this.#variants.find(
        (variant) => variant.dimensione === selection.dimensione && variant.misure === selection.misure
      ) ?? null;

    this.#setText('[data-linked-dimensione]', selection.dimensione);
    this.#setText('[data-linked-misure]', selection.misure);
    this.#render();
  };

  /** Pushes the matched variant into the hidden form, the dialog and the card price. */
  #render() {
    const { trigger } = this;
    const variantInput = this.querySelector('input[name="id"]');
    const matched = this.#matched;
    const purchasable = Boolean(matched?.available);

    if (trigger) {
      trigger.disabled = !purchasable;
      const label = trigger.querySelector('[data-linked-trigger-label]');
      if (label && !trigger.dataset.added) {
        label.textContent = purchasable ? trigger.dataset.labelDefault ?? '' : 'Misura non disponibile';
      }
    }

    if (!matched) return;

    if (variantInput instanceof HTMLInputElement) variantInput.value = String(matched.id);

    this.#setText('[data-linked-price]', matched.price);

    const compare = this.querySelector('[data-linked-compare]');
    if (compare instanceof HTMLElement) {
      compare.hidden = !matched.compareAt;
      compare.textContent = matched.compareAt ?? '';
    }

    this.#updateCardPrice(matched);
  }

  /**
   * Rewrites the price block of the surrounding product card so that the number the
   * customer sees before opening the dialog is the number they'll see inside it.
   *
   * @param {{price: string, compareAt?: string}} variant
   */
  #updateCardPrice(variant) {
    const container = this.closest('product-card')?.querySelector('[ref="priceContainer"]');
    const priceElement = container?.querySelector('.price');
    if (!(priceElement instanceof HTMLElement)) return;

    priceElement.textContent = variant.price;
    priceElement.classList.toggle('price--on-sale', Boolean(variant.compareAt));

    const existing = container?.querySelector('.compare-at-price');

    if (!variant.compareAt) {
      (existing?.closest('[role="group"]') ?? existing)?.remove();
      return;
    }

    if (existing instanceof HTMLElement) {
      existing.textContent = variant.compareAt;
      return;
    }

    const compare = document.createElement('span');
    compare.className = 'compare-at-price';
    compare.textContent = variant.compareAt;
    (priceElement.closest('[role="group"]') ?? priceElement).after(compare);
  }

  #openDialog = () => {
    if (!this.#matched?.available) return;
    this.dialog?.showModal();
    this.#updateBundleNote();
  };

  /**
   * Shows the "we're adding the mattress too" line in the dialog only when the
   * bundle really is about to happen: bundling on, a main product on the page,
   * and that product not in the cart yet.
   */
  async #updateBundleNote() {
    const note = this.querySelector('[data-linked-bundle-note]');
    if (!(note instanceof HTMLElement)) return;

    note.hidden = true;
    if (this.dataset.bundleMain !== 'true') return;

    const main = readMainProduct();
    if (!main) return;

    try {
      const response = await fetch(`${Theme.routes.cart_url}.js`);
      const cart = await response.json();
      const mainInCart = Array.isArray(cart.items) && cart.items.some((item) => item.product_id === main.productId);
      note.hidden = mainInCart;
    } catch {
      // Leave the note hidden: the add still works, only the message is skipped.
    }
  }

  #closeDialog = () => {
    this.dialog?.close();
  };

  /**
   * The surrounding <product-card> navigates to the product on any click that isn't on a
   * form control, so every click inside the dialog has to stop before it gets there.
   *
   * A click landing on the dialog element itself is a click on its backdrop: dismiss.
   * The dismiss buttons close natively through method="dialog"; the delegated call here
   * is a fallback for when that form is submitted by something other than a click.
   */
  #handleDialogClick = (/** @type {MouseEvent} */ event) => {
    event.stopPropagation();

    const target = event.target instanceof Element ? event.target : null;

    if (target === this.dialog || target?.closest('[data-linked-cancel]')) this.#closeDialog();
  };

  #confirm = async () => {
    if (this.dataset.bundleMain !== 'true') {
      this.querySelector('[data-linked-submit]')?.click();
      this.#closeDialog();
      return;
    }

    const added = await this.#confirmBundle();

    if (!added) {
      // Nothing to bundle (or the bundle failed): the hidden theme form adds
      // the recommended product alone, keeping the standard cart behaviour.
      this.querySelector('[data-linked-submit]')?.click();
    }

    this.#closeDialog();
  };

  /**
   * Adds main product + recommended product in one request, when the main
   * product is missing from the cart. Returns true when the bundle add
   * happened (and was announced), false when the caller should fall back to
   * the plain single add.
   */
  async #confirmBundle() {
    const matched = this.#matched;
    if (!matched?.available) return false;

    try {
      const main = readMainProduct();
      if (!main) return false;

      const cartResponse = await fetch(`${Theme.routes.cart_url}.js`);
      const cart = await cartResponse.json();
      const mainInCart = Array.isArray(cart.items) && cart.items.some((item) => item.product_id === main.productId);
      if (mainInCart) return false;

      const addResponse = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          items: [
            { id: main.variantId, quantity: 1 },
            { id: matched.id, quantity: 1 },
          ],
        }),
      });
      const result = await addResponse.json();
      if (result.status) throw new Error(result.description ?? result.message ?? 'Cart add failed');

      const refreshed = await fetch(`${Theme.routes.cart_url}.js`).then((response) => response.json());

      document.dispatchEvent(
        new CartUpdateEvent(refreshed, this.dataset.productId ?? 'linked-size-add', {
          itemCount: refreshed?.item_count ?? 0,
          source: 'linked-size-add',
        })
      );

      this.#showAdded();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  #handleCartUpdate = (/** @type {CustomEvent} */ event) => {
    if (event.detail?.data?.didError) return;
    this.#showAdded();
  };

  #showAdded() {
    const { trigger } = this;
    const label = trigger?.querySelector('[data-linked-trigger-label]');
    if (!trigger || !label) return;

    if (!trigger.dataset.labelDefault) trigger.dataset.labelDefault = label.textContent ?? '';
    trigger.dataset.added = 'true';
    label.textContent = 'Aggiunto ✓';

    clearTimeout(this.#addedTimeout);
    this.#addedTimeout = setTimeout(() => {
      delete trigger.dataset.added;
      label.textContent = trigger.dataset.labelDefault ?? '';
    }, ADDED_STATE_DURATION);
  }

  /**
   * @param {string} selector
   * @param {string} value
   */
  #setText(selector, value) {
    const element = this.querySelector(selector);
    if (element) element.textContent = value;
  }
}

if (!customElements.get('linked-size-add')) {
  customElements.define('linked-size-add', LinkedSizeAdd);
}
