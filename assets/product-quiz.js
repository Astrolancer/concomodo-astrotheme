/**
 * Con comodo — Quiz materasso (stile Typeform)
 *
 * Meccanica ispirata al quiz Casper (Typeform): una domanda alla volta,
 * avanzamento automatico sulle scelte singole, punteggio pesato per
 * prodotto e schermata risultato con cross-sell.
 */
(function () {
  'use strict';

  const AUTO_ADVANCE_DELAY = 420;
  // Nell'editor tema di Shopify l'anteprima ricarica se cambia l'URL:
  // in design mode saltiamo ogni riscrittura dell'URL.
  const DESIGN_MODE = !!(window.Shopify && window.Shopify.designMode);

  class ProductQuiz {
    constructor(root) {
      this.root = root;
      this.steps = Array.from(root.querySelectorAll('.cq-step'));
      this.questionSteps = this.steps.filter((s) => s.dataset.stepType === 'question');
      this.progressBar = root.querySelector('.cq__progress-bar');
      this.nav = root.querySelector('.cq__nav');
      this.navPrev = root.querySelector('[data-cq-prev]');
      this.navNext = root.querySelector('[data-cq-next]');
      this.counter = root.querySelector('.cq__counter');
      this.emailForm = root.querySelector('[data-cq-email-form]');
      this.resultCards = Array.from(root.querySelectorAll('.cq__result-card'));
      this.xsellCards = Array.from(root.querySelectorAll('.cq__xsell-card'));
      this.xsellWrap = root.querySelector('.cq__xsell');
      this.current = 0;
      this.answers = {};
      this.emailSubmitted = false;

      this.bind();
      this.restoreFromUrl();
      this.show(this.current, true);
    }

    /* ------------------------------------------------ binding eventi */
    bind() {
      this.root.querySelectorAll('[data-cq-start]').forEach((btn) => {
        btn.addEventListener('click', () => this.next());
      });

      this.steps.forEach((step) => {
        const options = Array.from(step.querySelectorAll('.cq-opt'));
        options.forEach((opt) => {
          opt.addEventListener('click', () => this.selectOption(step, opt));
        });

        const okBtn = step.querySelector('[data-cq-ok]');
        if (okBtn) okBtn.addEventListener('click', () => this.next());
      });

      if (this.navPrev) this.navPrev.addEventListener('click', () => this.prev());
      if (this.navNext) this.navNext.addEventListener('click', () => this.tryAdvance());

      const skipBtn = this.root.querySelector('[data-cq-skip-email]');
      if (skipBtn) skipBtn.addEventListener('click', () => this.showResult());

      if (this.emailForm) {
        this.emailForm.addEventListener('submit', (e) => {
          if (DESIGN_MODE) {
            // nell'editor tema niente POST reale: mostra solo il risultato
            e.preventDefault();
            this.showResult();
            return;
          }
          // invio nativo: lascia lavorare il captcha anti-spam di Shopify.
          // return_to riporta l'utente alla pagina con ?quiz_result=<vincitore>,
          // che restoreFromUrl() ripristina al caricamento.
          if (!this.prepareEmailSubmit()) e.preventDefault();
        });
      }

      const restart = this.root.querySelector('[data-cq-restart]');
      if (restart) restart.addEventListener('click', () => this.restart());

      document.addEventListener('keydown', (e) => this.onKey(e));
    }

    onKey(e) {
      // ignora se il quiz non è in viewport o l'utente sta scrivendo
      if (!this.root.closest('body')) return;
      const active = this.steps[this.current];
      if (!active) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);

      if (e.key === 'Enter' && !typing) {
        if (active.dataset.stepType === 'intro') {
          e.preventDefault();
          this.next();
          return;
        }
        if (active.dataset.stepType === 'question' && this.isAnswered(active)) {
          e.preventDefault();
          this.next();
          return;
        }
      }

      if (typing) return;

      // scorciatoie lettera (A, B, C…) come su Typeform
      if (active.dataset.stepType === 'question' && /^[a-zA-Z]$/.test(e.key)) {
        const idx = e.key.toUpperCase().charCodeAt(0) - 65;
        const options = active.querySelectorAll('.cq-opt');
        if (options[idx]) {
          e.preventDefault();
          this.selectOption(active, options[idx]);
        }
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.prev();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.tryAdvance();
      }
    }

    /* ------------------------------------------------ selezione opzioni */
    selectOption(step, opt) {
      const multi = step.dataset.multi === 'true';
      const max = parseInt(step.dataset.max || '2', 10);
      const options = Array.from(step.querySelectorAll('.cq-opt'));

      if (multi) {
        const checked = opt.getAttribute('aria-checked') === 'true';
        const checkedCount = options.filter((o) => o.getAttribute('aria-checked') === 'true').length;
        if (!checked && checkedCount >= max) {
          // limite raggiunto: sostituisci la prima selezione (comportamento gentile)
          const first = options.find((o) => o.getAttribute('aria-checked') === 'true');
          if (first) first.setAttribute('aria-checked', 'false');
        }
        opt.setAttribute('aria-checked', checked ? 'false' : 'true');
        const okBtn = step.querySelector('[data-cq-ok]');
        if (okBtn) okBtn.disabled = !this.isAnswered(step);
      } else {
        options.forEach((o) => o.setAttribute('aria-checked', o === opt ? 'true' : 'false'));
        window.clearTimeout(this.advanceTimer);
        this.advanceTimer = window.setTimeout(() => this.next(), AUTO_ADVANCE_DELAY);
      }

      this.saveAnswer(step);
    }

    saveAnswer(step) {
      const key = step.dataset.key;
      const values = Array.from(step.querySelectorAll('.cq-opt[aria-checked="true"]')).map(
        (o) => o.dataset.value
      );
      this.answers[key] = values;
    }

    isAnswered(step) {
      return !!step.querySelector('.cq-opt[aria-checked="true"]');
    }

    /* ------------------------------------------------ navigazione */
    show(index, immediate) {
      const prevStep = this.steps[this.current];
      const nextStep = this.steps[index];
      if (!nextStep) return;

      if (prevStep && prevStep !== nextStep) {
        prevStep.classList.remove('is-active');
        if (index > this.current) prevStep.classList.add('is-leaving-up');
        window.setTimeout(() => prevStep.classList.remove('is-leaving-up'), 500);
      }

      this.current = index;
      nextStep.classList.add('is-active');
      if (immediate) nextStep.style.transition = 'none';
      requestAnimationFrame(() => (nextStep.style.transition = ''));

      this.updateChrome();

      const focusable = nextStep.querySelector('.cq-opt, .cq__email-input, .cq-btn');
      if (focusable && !immediate) focusable.focus({ preventScroll: true });
    }

    updateChrome() {
      const step = this.steps[this.current];
      const type = step.dataset.stepType;
      const qIndex = this.questionSteps.indexOf(step);
      const total = this.questionSteps.length;

      let progress = 0;
      if (type === 'question') progress = (qIndex / total) * 100;
      if (type === 'email') progress = 96;
      if (type === 'result') progress = 100;
      this.progressBar.style.width = `${progress}%`;

      const inQuiz = type === 'question';
      this.nav.classList.toggle('is-visible', inQuiz || type === 'email');
      this.counter.classList.toggle('is-visible', inQuiz);
      if (inQuiz) {
        this.counter.textContent = `${qIndex + 1} / ${total}`;
        this.navPrev.disabled = this.current <= 1;
        this.navNext.disabled = !this.isAnswered(step);
      }
      if (type === 'email') {
        this.navPrev.disabled = false;
        this.navNext.disabled = true;
      }
    }

    tryAdvance() {
      const step = this.steps[this.current];
      if (step.dataset.stepType === 'question' && !this.isAnswered(step)) return;
      this.next();
    }

    next() {
      window.clearTimeout(this.advanceTimer);
      const step = this.steps[this.current];
      if (step.dataset.stepType === 'question') this.saveAnswer(step);

      const nextIndex = this.current + 1;
      const nextStep = this.steps[nextIndex];
      if (!nextStep) return;

      if (nextStep.dataset.stepType === 'result') {
        this.showResult();
        return;
      }
      this.show(nextIndex);
    }

    prev() {
      if (this.current <= 1) return;
      this.show(this.current - 1);
    }

    /* ------------------------------------------------ punteggio */
    computeWinner() {
      const scores = {};
      this.root.querySelectorAll('.cq-opt[aria-checked="true"]').forEach((opt) => {
        let points = {};
        try {
          points = JSON.parse(opt.dataset.points || '{}');
        } catch (e) {
          points = {};
        }
        Object.keys(points).forEach((k) => {
          scores[k] = (scores[k] || 0) + points[k];
        });
      });

      // parità: vince il prodotto più completo (specchia le soglie "premium" di Casper)
      const priority = ['m3b', 'm3a', 'm2', 'm1'];
      let winner = priority[0];
      let best = -1;
      priority.forEach((k) => {
        const s = scores[k] || 0;
        if (s > best) {
          best = s;
          winner = k;
        }
      });
      return { winner, scores };
    }

    /* ------------------------------------------------ email */
    prepareEmailSubmit() {
      const input = this.emailForm.querySelector('.cq__email-input');
      const error = this.emailForm.querySelector('.cq__email-error');
      const value = (input.value || '').trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

      input.classList.toggle('is-invalid', !valid);
      error.classList.toggle('is-visible', !valid);
      if (!valid) {
        input.focus();
        return false;
      }

      // dopo il POST (ed eventuale captcha) Shopify riporta qui, sul risultato
      const { winner } = this.computeWinner();
      // il flusso captcha può ignorare return_to: salviamo il risultato anche
      // in sessionStorage, così viene ripristinato ovunque si atterri dopo
      try {
        sessionStorage.setItem('cq_pending', JSON.stringify({ winner: winner, ts: Date.now() }));
      } catch (e) {
        /* storage non disponibile */
      }
      const returnInput = this.emailForm.querySelector('[data-cq-return]');
      if (returnInput) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('quiz_result', winner);
          returnInput.value = url.pathname + url.search;
        } catch (e) {
          returnInput.value = window.location.pathname + '?quiz_result=' + winner;
        }
      }
      this.track('quiz_email_submitted', { result: winner });
      return true;
    }

    /* ------------------------------------------------ risultato */
    showResult() {
      const { winner, scores } = this.computeWinner();
      const resultStep = this.steps.find((s) => s.dataset.stepType === 'result');
      const resultIndex = this.steps.indexOf(resultStep);

      this.resultCards.forEach((card) => {
        card.classList.toggle('is-visible', card.dataset.key === winner);
      });

      let anyXsell = false;
      this.xsellCards.forEach((card) => {
        const forList = (card.dataset.crossFor || '').split(',').map((s) => s.trim());
        const visible = forList.includes(winner);
        card.classList.toggle('is-visible', visible);
        if (visible) anyXsell = true;
      });
      if (this.xsellWrap) this.xsellWrap.style.display = anyXsell ? '' : 'none';

      // aggiunge la taglia scelta ai link risultato (utile per preselezionare la variante)
      const size = (this.answers.size || [])[0];
      if (size && size !== 'unknown') {
        this.root.querySelectorAll('.cq__result-card.is-visible a[href]').forEach((a) => {
          try {
            const url = new URL(a.href, window.location.origin);
            url.searchParams.set('quiz_size', size);
            a.href = url.toString();
          } catch (e) {
            /* URL non valido: lascia com'è */
          }
        });
      }

      this.show(resultIndex);
      this.track('quiz_completed', { result: winner, scores });

      if (!DESIGN_MODE) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('quiz_result', winner);
          window.history.replaceState({}, '', url.toString());
        } catch (e) {
          /* niente URL API: pazienza */
        }
      }
    }

    /* anteprima risultato per l'editor tema (selezione blocco) */
    previewResult(key) {
      const resultStep = this.steps.find((s) => s.dataset.stepType === 'result');
      if (!resultStep) return;
      this.resultCards.forEach((card) => {
        card.classList.toggle('is-visible', card.dataset.key === key);
      });
      let anyXsell = false;
      this.xsellCards.forEach((card) => {
        const forList = (card.dataset.crossFor || '').split(',').map((s) => s.trim());
        const visible = forList.includes(key);
        card.classList.toggle('is-visible', visible);
        if (visible) anyXsell = true;
      });
      if (this.xsellWrap) this.xsellWrap.style.display = anyXsell ? '' : 'none';
      this.show(this.steps.indexOf(resultStep));
    }

    previewXsell(card) {
      const resultStep = this.steps.find((s) => s.dataset.stepType === 'result');
      if (!resultStep) return;
      if (!this.resultCards.some((c) => c.classList.contains('is-visible')) && this.resultCards[0]) {
        this.resultCards[0].classList.add('is-visible');
      }
      card.classList.add('is-visible');
      if (this.xsellWrap) this.xsellWrap.style.display = '';
      this.show(this.steps.indexOf(resultStep));
    }

    restoreFromUrl() {
      if (DESIGN_MODE) return;
      // permette di riaprire/condividere un risultato: ?quiz_result=m3b
      try {
        let saved = null;
        try {
          const url = new URL(window.location.href);
          saved = url.searchParams.get('quiz_result');
        } catch (e) {
          /* ignora */
        }
        if (!saved) {
          // ritorno dal captcha di Shopify: recupera il risultato in sospeso
          try {
            const pending = JSON.parse(sessionStorage.getItem('cq_pending') || 'null');
            if (pending && pending.winner && Date.now() - pending.ts < 3600000) {
              saved = pending.winner;
            }
          } catch (e) {
            /* ignora */
          }
        }
        if (saved && this.resultCards.some((c) => c.dataset.key === saved)) {
          try {
            sessionStorage.removeItem('cq_pending');
          } catch (e) {
            /* ignora */
          }
          this.resultCards.forEach((card) => {
            card.classList.toggle('is-visible', card.dataset.key === saved);
          });
          let anyXsell = false;
          this.xsellCards.forEach((card) => {
            const forList = (card.dataset.crossFor || '').split(',').map((s) => s.trim());
            const visible = forList.includes(saved);
            card.classList.toggle('is-visible', visible);
            if (visible) anyXsell = true;
          });
          if (this.xsellWrap) this.xsellWrap.style.display = anyXsell ? '' : 'none';
          this.current = this.steps.findIndex((s) => s.dataset.stepType === 'result');
        }
      } catch (e) {
        /* ignora */
      }
    }

    restart() {
      this.answers = {};
      this.emailSubmitted = false;
      this.root.querySelectorAll('.cq-opt[aria-checked="true"]').forEach((o) => {
        o.setAttribute('aria-checked', 'false');
      });
      this.resultCards.forEach((c) => c.classList.remove('is-visible'));
      try {
        sessionStorage.removeItem('cq_pending');
      } catch (e) {
        /* ignora */
      }
      if (!DESIGN_MODE) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('quiz_result');
          window.history.replaceState({}, '', url.toString());
        } catch (e) {
          /* ignora */
        }
      }
      this.show(0);
      this.track('quiz_restarted');
    }

    track(event, payload) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: event }, payload || {}));
    }
  }

  function init(scope) {
    (scope || document).querySelectorAll('[data-product-quiz]').forEach((el) => {
      if (!el.__cqInstance) el.__cqInstance = new ProductQuiz(el);
    });
  }

  init();

  if (DESIGN_MODE) {
    // ricrea il quiz quando l'editor tema ricarica la sezione
    document.addEventListener('shopify:section:load', (e) => init(e.target));
    // selezionando un blocco risultato/cross-sell nell'editor, mostra la sua anteprima
    document.addEventListener('shopify:block:select', (e) => {
      const root = e.target.closest('[data-product-quiz]');
      if (!root || !root.__cqInstance) return;
      const resultCard = e.target.closest('.cq__result-card');
      if (resultCard) {
        root.__cqInstance.previewResult(resultCard.dataset.key);
        return;
      }
      const xsellCard = e.target.closest('.cq__xsell-card');
      if (xsellCard) {
        root.__cqInstance.previewXsell(xsellCard);
        return;
      }
      // blocchi Domanda/Risposta: porta l'anteprima sullo step corrispondente
      const step = e.target.closest('.cq-step');
      if (step) {
        const idx = root.__cqInstance.steps.indexOf(step);
        if (idx >= 0) root.__cqInstance.show(idx);
      }
    });
  }
})();