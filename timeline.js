/*
 * timeline.js — interactive timeline spine for Augmentation Films.
 *
 * Builds one marker per [data-timeline-item], positions them along the spine
 * using getBoundingClientRect, click-to-scroll-into-view with smooth eased
 * scroll, marker pulse synced to the active video, and a thin progress fill
 * on the spine that mirrors playback of the active clip.
 *
 * Communicates with player.js via window.AugPlayerBus.
 *
 * Contract: see README.md "Player contract" section.
 */
(function () {
    'use strict';

    if (!window.AugPlayerBus) {
        window.AugPlayerBus = new EventTarget();
    }
    const bus = window.AugPlayerBus;
    const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

    const reducedMotion = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const smoothScrollBehavior = () => reducedMotion() ? 'auto' : 'smooth';

    class Timeline {
        constructor(root) {
            this.root = root;
            this.spine = root.querySelector('[data-timeline]');
            this.fill = root.querySelector('[data-timeline-fill]');
            this.items = Array.from(root.querySelectorAll('[data-timeline-item]'));
            this.markers = [];
            this.activeId = null;
            this.lastActiveWrite = 0;
            this.lastTimeUpdate = 0;
            this.latestProgress = { id: null, currentTime: 0, duration: 0 };

            this.buildMarkers();
            this.bind();
            this.observeActive();
            this.subscribe();
            this.measure();

            // Re-measure after fonts load (marker positions depend on card height)
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => this.measure());
            }

            // Debounced resize
            let resizeTimer = null;
            window.addEventListener('resize', () => {
                if (resizeTimer) clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => this.measure(), 150);
            });
        }

        buildMarkers() {
            this.items.forEach((item) => {
                const id = item.id;
                const titleEl = item.querySelector('.title');
                const label = titleEl ? titleEl.textContent.trim() : id;

                const marker = document.createElement('button');
                marker.type = 'button';
                marker.className = 'timeline-marker';
                marker.dataset.timelineMarker = id;
                marker.setAttribute('aria-label', 'Jump to ' + label);

                const dot = document.createElement('span');
                dot.className = 'timeline-marker__dot';
                marker.appendChild(dot);

                const labelEl = document.createElement('span');
                labelEl.className = 'timeline-marker__label';
                labelEl.textContent = label;
                marker.appendChild(labelEl);

                const playGlyph = document.createElement('span');
                playGlyph.className = 'timeline-marker__play';
                playGlyph.setAttribute('aria-hidden', 'true');
                playGlyph.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
                marker.appendChild(playGlyph);

                marker.addEventListener('click', () => this.onMarkerClick(id, item));

                this.spine.appendChild(marker);
                this.markers.push({ id, el: marker, item });
            });
        }

        bind() {
            // Scroll-driven nav class (kept from original behavior)
            window.addEventListener('scroll', () => {
                document.body.classList.toggle('scrolled', window.scrollY > 0);
            }, { passive: true });
        }

        observeActive() {
            if (!('IntersectionObserver' in window)) return;
            const io = new IntersectionObserver((entries) => {
                // Pick the entry whose center is closest to viewport center
                let best = null;
                let bestDist = Infinity;
                const vh = window.innerHeight || document.documentElement.clientHeight;
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const rect = entry.boundingClientRect;
                    const center = rect.top + rect.height / 2;
                    const dist = Math.abs(center - vh / 2);
                    if (dist < bestDist) { bestDist = dist; best = entry; }
                }
                if (best) {
                    const id = best.target.id;
                    // Only write if no player has been playing in the last 1.5s
                    if (performance.now() - this.lastActiveWrite > 1500) {
                        this.setActive(id, 'viewport');
                    }
                }
            }, { rootMargin: '-40% 0% -40% 0%', threshold: [0, 0.25, 0.5, 0.75, 1] });
            this.items.forEach((item) => io.observe(item));
        }

        subscribe() {
            // player:play wins over IntersectionObserver
            bus.addEventListener('player:play', (e) => {
                const id = e.detail && e.detail.id;
                if (id) {
                    this.lastActiveWrite = performance.now();
                    this.setActive(id, 'play');
                }
            });

            // player:timeupdate feeds the spine progress fill
            bus.addEventListener('player:timeupdate', (e) => {
                const d = e.detail || {};
                this.latestProgress = { id: d.id, currentTime: d.currentTime, duration: d.duration };
            });

            // player:pause / ended: clear the spine fill
            bus.addEventListener('player:pause', () => {
                // Keep the marker active but stop the fill animation
            });
            bus.addEventListener('player:ended', () => {
                this.latestProgress = { id: null, currentTime: 0, duration: 0 };
                this.updateFill();
            });
        }

        setActive(id, source) {
            if (this.activeId === id) return;
            this.activeId = id;
            this.markers.forEach((m) => {
                m.el.classList.toggle('is-active', m.id === id);
            });
            this.items.forEach((item) => {
                item.classList.toggle('is-active', item.id === id);
            });
            emit('timeline:active', { id, source });
        }

        onMarkerClick(id, item) {
            // Smooth scroll the card into view
            const behavior = smoothScrollBehavior();
            try {
                item.scrollIntoView({ behavior, block: 'center' });
            } catch (_) {
                item.scrollIntoView();
            }
            // Pulse the marker
            const marker = this.markers.find((m) => m.id === id);
            if (marker) {
                marker.el.classList.remove('is-pulse');
                // Force reflow so the animation restarts
                void marker.el.offsetWidth;
                marker.el.classList.add('is-pulse');
            }
            // Pulse the card
            item.classList.remove('is-pulse');
            void item.offsetWidth;
            item.classList.add('is-pulse');

            emit('timeline:marker-click', { id });
        }

        measure() {
            // Position each marker along the spine using the card's vertical center
            const spineRect = this.spine.getBoundingClientRect();
            const rootRect = this.root.getBoundingClientRect();
            if (spineRect.height === 0) return;

            this.markers.forEach(({ id, el, item }) => {
                const itemRect = item.getBoundingClientRect();
                const center = (itemRect.top + itemRect.height / 2) - rootRect.top;
                const pct = Math.min(Math.max(center / rootRect.height, 0), 1);
                el.style.top = (pct * 100) + '%';
            });

            this.updateFill();
        }

        updateFill() {
            if (!this.fill) return;
            const id = this.latestProgress.id;
            if (!id || id !== this.activeId) {
                this.fill.style.height = '0%';
                return;
            }
            const { currentTime, duration } = this.latestProgress;
            if (!duration || duration <= 0) {
                this.fill.style.height = '0%';
                return;
            }
            const pct = Math.min(Math.max(currentTime / duration, 0), 1);
            this.fill.style.height = (pct * 100) + '%';
        }
    }

    function init() {
        const root = document.querySelector('[data-timeline-root]');
        if (!root) return;
        try {
            window.AugTimeline = new Timeline(root);
        } catch (err) {
            console.warn('[timeline] init failed', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
