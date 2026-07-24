/* Perché dormire comodi — narrazione scroll-driven.
   GSAP + ScrollTrigger pilotano le scene; three.js disegna il cielo
   (notte tempestosa → alba → sereno) su un canvas fisso dietro ai contenuti. */

const root = document.querySelector('[data-pdc]');
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Stato condiviso del cielo: GSAP lo anima, il renderer lo legge a ogni frame.
const sky = { alpha: 0, dawn: 0 };

if (root) {
  if (prefersReduced || typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    root.classList.add('pdc--static');
  } else {
    init();
  }
}

function q(sel, ctx = root) {
  return ctx.querySelector(sel);
}

function qa(sel, ctx = root) {
  return [...ctx.querySelectorAll(sel)];
}

function init() {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  gsap.defaults({ ease: 'power2.out' });

  const backdrop = q('[data-pdc-backdrop]');
  const setTheme = (name) => {
    backdrop.classList.remove('is-cream', 'is-night', 'is-sky');
    backdrop.classList.add('is-' + name);
  };

  const scene = (name) => q(`[data-pdc-scene="${name}"]`);
  const pinOf = (name) => q(`[data-pdc-scene="${name}"] [data-pdc-pin]`);

  /* ── Scena 1 · Hero ── */
  gsap.from('[data-pdc-hero-item]', {
    y: 36,
    opacity: 0,
    duration: 1,
    stagger: 0.14,
    delay: 0.2,
  });

  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: scene('hero'),
        start: 'top top',
        end: '+=130%',
        pin: pinOf('hero'),
        scrub: 0.6,
        onLeave: () => setTheme('night'),
        onEnterBack: () => setTheme('cream'),
      },
    })
    .to('[data-pdc-cue]', { opacity: 0, duration: 0.12 }, 0)
    .to('[data-pdc-zzz]', { yPercent: -120, opacity: 0, duration: 0.5 }, 0.15)
    .to('[data-pdc-hero-inner]', { yPercent: -16, opacity: 0, duration: 0.5 }, 0.3)
    .to(sky, { alpha: 1, duration: 0.4 }, 0.55);

  /* ── Scena 2 · Gimmick ── */
  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: scene('gimmick'),
        start: 'top top',
        end: '+=230%',
        pin: pinOf('gimmick'),
        scrub: 0.6,
      },
    })
    .from('[data-pdc-gimmick-title]', { opacity: 0, y: 70, duration: 0.16, ease: 'power2.out' }, 0)
    .from('[data-pdc-rings]', { opacity: 0, scale: 0.55, duration: 0.24, ease: 'power1.out' }, 0.02)
    .from('[data-pdc-disclaimer]', { opacity: 0, duration: 0.1 }, 0.2)
    .to({}, { duration: 0.18 }) // pausa di lettura
    .to('[data-pdc-rings]', { scale: 5, opacity: 0, duration: 0.42, ease: 'power1.in' }, 0.5)
    .to('[data-pdc-gimmick-title]', { opacity: 0, y: -50, duration: 0.22 }, 0.72)
    .to('[data-pdc-disclaimer]', { opacity: 0, duration: 0.15 }, 0.75);

  /* ── Scena 3 · Marquee ── */
  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: scene('marquee'),
        start: 'top top',
        end: '+=190%',
        pin: pinOf('marquee'),
        scrub: 0.6,
      },
    })
    .from('.pdc-marquee--top', { xPercent: -14, opacity: 0, duration: 0.2 }, 0)
    .from('.pdc-marquee--bottom', { xPercent: 14, opacity: 0, duration: 0.2 }, 0.03)
    .from('[data-pdc-marquee-title]', { opacity: 0, y: 60, duration: 0.2, ease: 'power2.out' }, 0.08)
    .from('[data-pdc-marquee-note]', { opacity: 0, duration: 0.12 }, 0.24)
    .to({}, { duration: 0.3 })
    .to('.pdc-marquee__center', { opacity: 0, y: -40, duration: 0.18 }, 0.76)
    .to('[data-pdc-marquee-row]', { opacity: 0, duration: 0.18 }, 0.79);

  /* ── Scena 4 · Tempesta → alba ── */
  const stormClouds = qa('[data-pdc-storm-cloud]');
  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: scene('storm'),
        start: 'top top',
        end: '+=290%',
        pin: pinOf('storm'),
        scrub: 0.7,
        onLeave: () => setTheme('sky'),
        onEnterBack: () => setTheme('night'),
      },
    })
    .from('[data-pdc-storm-a]', { opacity: 0, y: 70, duration: 0.14, ease: 'power2.out' }, 0)
    .to({}, { duration: 0.14 })
    .to('[data-pdc-storm-a]', { opacity: 0, y: -60, duration: 0.13 }, 0.3)
    .to(sky, { dawn: 1, duration: 0.38, ease: 'power1.inOut' }, 0.36)
    .to(
      stormClouds,
      {
        yPercent: (i) => (i % 2 ? -160 : 160),
        xPercent: (i) => (i < 2 ? -35 : 35),
        opacity: 0,
        duration: 0.4,
      },
      0.36
    )
    .from('[data-pdc-storm-b]', { opacity: 0, scale: 0.94, duration: 0.2, ease: 'power2.out' }, 0.56)
    .to('.pdc-storm__title--big', { color: '#464646', duration: 0.24 }, 0.52)
    .to({}, { duration: 0.16 }); // il cielo resta aperto un attimo

  /* ── Scena 5 · Filosofia (flusso normale, reveal calmi) ── */
  const revealTargets = qa('[data-pdc-reveal]');
  gsap.set(revealTargets, { opacity: 0, y: 50 });
  revealTargets.forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 80%',
      once: true,
      onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }),
    });
  });

  gsap.set('[data-pdc-card]', { opacity: 0, y: 56 });
  ScrollTrigger.batch('[data-pdc-card]', {
    start: 'top 85%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, { opacity: 1, y: 0, stagger: 0.12, duration: 0.8, ease: 'power3.out', overwrite: true }),
  });

  /* ── Scena 6 · Confronto: il cielo sfuma nella crema ── */
  gsap.to(sky, {
    alpha: 0,
    ease: 'none',
    scrollTrigger: {
      trigger: scene('confronto'),
      start: 'top 55%',
      end: 'top 5%',
      scrub: true,
      onEnter: () => setTheme('cream'),
      onLeaveBack: () => setTheme('sky'),
    },
  });

  gsap.set('[data-pdc-row]', { opacity: 0, x: -26 });
  gsap.to('[data-pdc-row]', {
    opacity: 1,
    x: 0,
    stagger: 0.1,
    duration: 0.7,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.pdc-table',
      start: 'top 78%',
    },
  });

  /* ── Scena 7 · Chiusa ── */
  gsap
    .timeline({
      defaults: { ease: 'power2.out' },
      scrollTrigger: {
        trigger: scene('chiusa'),
        start: 'top top',
        end: '+=150%',
        pin: pinOf('chiusa'),
        scrub: 0.6,
      },
    })
    .from('[data-pdc-halo]', { opacity: 0, scale: 0.6, duration: 0.32, ease: 'none' }, 0)
    .from('[data-pdc-chiusa-item]', { opacity: 0, y: 64, stagger: 0.09, duration: 0.3 }, 0.04)
    .from('.pdc-chiusa__clouds .pdc-cloud', { yPercent: 180, stagger: 0.06, duration: 0.34, ease: 'none' }, 0.08)
    .to({}, { duration: 0.5 }); // resta in scena: è la chiusa

  // I font cambiano le altezze: ricalcola i trigger quando sono pronti.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
  window.addEventListener('load', () => ScrollTrigger.refresh());

  initSky();
}

/* ── Cielo three.js: quad fullscreen con shader fbm ── */
async function initSky() {
  const canvas = q('[data-pdc-sky]');

  try {
    const THREE = await import(root.dataset.threeUrl);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene3 = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uTime: { value: 0 },
      uDawn: { value: 0 },
      uScroll: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        uniform float uTime;
        uniform float uDawn;
        uniform float uScroll;
        uniform vec2 uRes;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = p * 2.03 + vec2(17.3, 9.1);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / uRes;
          float aspect = uRes.x / uRes.y;
          vec2 p = vec2(uv.x * aspect, uv.y + uScroll * 0.10);
          float d = clamp(uDawn, 0.0, 1.0);

          // Gradiente del cielo: notte → giorno (azzurro Concomodo)
          vec3 nightTop = vec3(0.086, 0.098, 0.118);
          vec3 nightBot = vec3(0.161, 0.184, 0.212);
          vec3 dayTop = vec3(0.557, 0.702, 0.769);
          vec3 dayBot = vec3(0.878, 0.898, 0.894);
          vec3 col = mix(mix(nightBot, nightTop, uv.y), mix(dayBot, dayTop, uv.y), d);

          // Stelle (solo di notte), con leggero scintillio
          vec2 sp = floor(p * 140.0);
          float star = step(0.9974, hash(sp));
          float tw = 0.5 + 0.5 * sin(uTime * 2.2 + hash(sp.yx) * 40.0);
          col += star * tw * (1.0 - d) * 0.5 * smoothstep(0.3, 0.8, uv.y);

          // Sole che sorge con l'alba
          vec2 sunP = vec2(0.5 * aspect, 0.30);
          float sd = distance(vec2(p.x, uv.y), sunP);
          col += d * vec3(0.98, 0.95, 0.86) * exp(-sd * sd * 10.0) * 0.38;
          col += d * vec3(0.96, 0.90, 0.78) * exp(-sd * sd * 2.2) * 0.11;

          // Nuvole fbm: coverage pesante in tempesta, soffici di giorno
          float t = uTime * 0.012;
          vec2 cp = p * vec2(1.6, 2.6) + vec2(t * 2.0, -uScroll * 0.22);
          float q1 = fbm(cp);
          float f = fbm(cp * 1.9 + q1 * 1.4 + vec2(t * 1.2, 0.0));
          float cover = mix(0.60, 0.46, d);
          float cl = smoothstep(cover - 0.18, cover + 0.24, f);
          float hi = fbm(cp * 1.9 + q1 * 1.4 + vec2(t * 1.2, 0.18));
          vec3 cNight = mix(vec3(0.078, 0.090, 0.106), vec3(0.20, 0.224, 0.255), smoothstep(0.0, 1.0, hi));
          vec3 cDay = mix(vec3(0.82, 0.83, 0.83), vec3(0.985, 0.975, 0.95), smoothstep(0.0, 1.0, hi));
          cDay += d * vec3(0.05, 0.035, 0.01) * exp(-sd * sd * 3.0);
          col = mix(col, mix(cNight, cDay, d), cl * 0.92);

          // Vignetta morbida + grana leggera
          col *= 1.0 - 0.16 * distance(uv, vec2(0.5, 0.55));
          col += (hash(gl_FragCoord.xy + fract(uTime) * vec2(13.7, 7.1)) - 0.5) * 0.02;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    scene3.add(quad);

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      uniforms.uRes.value.copy(size);
    };
    resize();
    window.addEventListener('resize', resize);

    let rafId = 0;
    let lastAlpha = -1;

    const loop = (time) => {
      rafId = requestAnimationFrame(loop);

      if (sky.alpha !== lastAlpha) {
        canvas.style.opacity = sky.alpha.toFixed(3);
        lastAlpha = sky.alpha;
      }
      if (sky.alpha < 0.005) return; // niente da mostrare: salta il render

      uniforms.uTime.value = time * 0.001;
      uniforms.uDawn.value = sky.dawn;
      uniforms.uScroll.value = (window.scrollY || 0) / window.innerHeight;
      renderer.render(scene3, camera);
    };

    const start = () => {
      if (!rafId) rafId = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
    };

    document.addEventListener('visibilitychange', () => {
      document.hidden ? stop() : start();
    });

    start();
  } catch (error) {
    // WebGL non disponibile: il fondale CSS racconta comunque la storia.
    root.classList.add('pdc--nosky');
  }
}
