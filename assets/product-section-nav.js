class ProductSectionNav extends HTMLElement {
  connectedCallback() {
    this.list = this.querySelector('[ref="list"]');
    this.headingSelector = this.getAttribute('data-heading-selector') || 'h2';
    this.links = [];
    this.targets = [];

    // Build after layout so sibling sections are present.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.build(), { once: true });
    } else {
      requestAnimationFrame(() => this.build());
    }
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  build() {
    const self = this.closest('.shopify-section') || this;
    let node = self.nextElementSibling;

    while (node) {
      if (node.classList && node.classList.contains('shopify-section')) {
        const heading = node.querySelector(this.headingSelector);
        const label = (node.dataset.navLabel || (heading && heading.textContent) || '').trim();
        if (label) {
          if (!node.id) node.id = `section-${Math.random().toString(36).slice(2, 8)}`;
          this.targets.push(node);
          this.addLink(node.id, label);
        }
      }
      node = node.nextElementSibling;
    }

    if (!this.links.length) {
      this.remove();
      return;
    }

    this.spy();
  }

  addLink(id, label) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${id}`;
    a.className = 'section-nav__link';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.scrollTo(document.getElementById(id));
    });
    li.appendChild(a);
    this.list.appendChild(li);
    this.links.push(a);
  }

  offset() {
    const header = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
    return header + this.getBoundingClientRect().height + 8;
  }

  scrollTo(target) {
    if (!target) return;
    const y = target.getBoundingClientRect().top + window.scrollY - this.offset();
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  spy() {
    const setActive = (id) => {
      this.links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${id}`));
    };

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: `-${this.offset() + 40}px 0px -55% 0px`, threshold: 0 }
    );

    this.targets.forEach((t) => this.observer.observe(t));
  }
}

if (!customElements.get('product-section-nav')) {
  customElements.define('product-section-nav', ProductSectionNav);
}
