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
 * Single-variant products (a pillow, a mattress protector) get the same dialog without
 * the size rows.
 */

const ADDED_STATE_DURATION = 2600;

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
    this.dialog?.addEventListener('click', this.#handleBackdropClick, { signal });

    for (const cancel of this.querySelectorAll('[data-linked-cancel]')) {
      cancel.addEventListener('click', this.#closeDialog, { signal });
    }

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
  };

  #closeDialog = () => {
    this.dialog?.close();
  };

  /**
   * The surrounding <product-card> navigates to the product on any click that isn't on a
   * form control, so every click inside the dialog has to stop before it gets there.
   * A click landing on the dialog element itself is a click on its backdrop: dismiss.
   */
  #handleBackdropClick = (/** @type {MouseEvent} */ event) => {
    event.stopPropagation();
    if (event.target === this.dialog) this.#closeDialog();
  };

  #confirm = () => {
    this.querySelector('[data-linked-submit]')?.click();
    this.#closeDialog();
  };

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
