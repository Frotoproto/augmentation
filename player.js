/*
 * player.js — custom video player for Augmentation Films.
 *
 * Owns: play/pause/seek/mute/fullscreen, keyboard, single-active registry,
 * localStorage["aug:mute"], IntersectionObserver-driven autoload upgrade/downgrade,
 * reduced-motion short-circuits.
 *
 * Communicates with timeline.js via window.AugPlayerBus (CustomEvent bus).
 *
 * Contract: see README.md "Player contract" section.
 */
(function () {
    'use strict';

    // ---------- Bus ----------
    if (!window.AugPlayerBus) {
        window.AugPlayerBus = new EventTarget();
    }
    const bus = window.AugPlayerBus;
    const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

    // ---------- Utilities ----------
    const reducedMotion = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const formatTime = (seconds) => {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return m + ':' + (s < 10 ? '0' + s : s);
    };

    const safeStorageGet = (key) => {
        try { return window.localStorage.getItem(key); } catch (_) { return null; }
    };
    const safeStorageSet = (key, value) => {
        try { window.localStorage.setItem(key, value); } catch (_) { /* ignore */ }
    };

    // ---------- Single-active registry ----------
    const activeInstances = new Set();

    class Player {
        constructor(root) {
            this.root = root;
            this.id = root.dataset.playerId;
            this.video = root.querySelector('.player__video');
            this.bigPlay = root.querySelector('.player__big-play');
            this.chrome = root.querySelector('[data-player-chrome]');
            this.btnPlay = root.querySelector('.player__play');
            this.btnMute = root.querySelector('.player__mute');
            this.btnFs = root.querySelector('.player__fs');
            this.scrubber = root.querySelector('[data-player-scrubber]');
            this.fill = root.querySelector('[data-player-fill]');
            this.buffer = root.querySelector('[data-player-buffer]');
            this.thumb = root.querySelector('[data-player-thumb]');
            this.tooltip = root.querySelector('[data-player-tooltip]');
            this.timeCurrent = root.querySelector('[data-player-time="current"]');
            this.timeDuration = root.querySelector('[data-player-time="duration"]');

            this.duration = 0;
            this.isScrubbing = false;
            this.lastTimeUpdate = 0;
            this.fsHideTimer = null;
            this.isFullscreen = false;
            this.muted = safeStorageGet('aug:mute') === 'true';

            this.bind();
            this.applyMuteIcon();
            this.video.muted = this.muted;
            this.setupAutoload();
        }

        bind() {
            // Toggle actions (big play + chrome play button + clicking the video)
            this.bigPlay.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
            this.btnPlay.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
            this.video.addEventListener('click', () => this.toggle());

            // Mute
            this.btnMute.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMute(); });

            // Fullscreen
            this.btnFs.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFullscreen(); });
            document.addEventListener('fullscreenchange', () => {
                this.isFullscreen = document.fullscreenElement === this.root;
                emit('player:fullscreen', { id: this.id, isFullscreen: this.isFullscreen });
                if (!this.isFullscreen) {
                    this.chrome.hidden = false;
                    if (this.fsHideTimer) { clearTimeout(this.fsHideTimer); this.fsHideTimer = null; }
                }
            });

            // Scrubber — pointer events for drag, click for seek, keyboard for ±5s
            this.scrubber.addEventListener('pointerdown', (e) => this.onScrubStart(e));
            this.scrubber.addEventListener('keydown', (e) => this.onScrubKey(e));

            // Video events
            this.video.addEventListener('loadedmetadata', () => {
                this.duration = this.video.duration || 0;
                this.timeDuration.textContent = formatTime(this.duration);
                emit('player:ready', { id: this.id, duration: this.duration });
            });
            this.video.addEventListener('play', () => {
                this.onPlayStart();
                emit('player:play', { id: this.id });
                emit('timeline:active', { id: this.id });
            });
            this.video.addEventListener('pause', () => {
                this.bigPlay.hidden = false;
                this.btnPlay.classList.remove('is-playing');
                emit('player:pause', { id: this.id, currentTime: this.video.currentTime });
            });
            this.video.addEventListener('ended', () => {
                this.bigPlay.hidden = false;
                this.btnPlay.classList.remove('is-playing');
                emit('player:ended', { id: this.id });
            });
            this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
            this.video.addEventListener('progress', () => this.onProgress());
            this.video.addEventListener('volumechange', () => {
                this.muted = this.video.muted;
                this.applyMuteIcon();
                emit('player:volumechange', { id: this.id, muted: this.muted, volume: this.video.volume });
            });

            // Hover preview on scrubber
            this.scrubber.addEventListener('pointermove', (e) => this.onScrubHover(e));
            this.scrubber.addEventListener('pointerleave', () => {
                this.tooltip.hidden = true;
            });

            // Spacebar on player root toggles play/pause
            this.root.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    this.toggle();
                } else if (e.key === 'm' || e.key === 'M') {
                    e.preventDefault();
                    this.toggleMute();
                } else if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    this.toggleFullscreen();
                }
            });

            // Reveal chrome on hover
            this.root.addEventListener('mouseenter', () => { this.chrome.hidden = false; });
            this.root.addEventListener('mousemove', () => {
                this.chrome.hidden = false;
                if (this.isFullscreen) {
                    if (this.fsHideTimer) clearTimeout(this.fsHideTimer);
                    this.fsHideTimer = setTimeout(() => {
                        if (this.isFullscreen) this.chrome.hidden = true;
                    }, 2000);
                }
            });
            this.root.addEventListener('mouseleave', () => {
                if (!this.isFullscreen) {
                    if (this.video.paused) this.chrome.hidden = true;
                }
            });
        }

        setupAutoload() {
            if (!('IntersectionObserver' in window)) return;
            const io = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        this.video.preload = 'auto';
                        emit('timeline:viewport', { id: this.id, isNear: true });
                    } else {
                        this.video.preload = 'metadata';
                        emit('timeline:viewport', { id: this.id, isNear: false });
                    }
                }
            }, { rootMargin: '200% 0px 200% 0px' });
            io.observe(this.root);
        }

        toggle() {
            if (this.video.paused) this.play();
            else this.pause();
        }

        play() {
            // Pause any other active player first
            for (const other of activeInstances) {
                if (other !== this && !other.video.paused) other.pause();
            }
            activeInstances.add(this);
            const p = this.video.play();
            if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ });
        }

        pause() {
            this.video.pause();
            activeInstances.delete(this);
        }

        toggleMute() {
            this.video.muted = !this.video.muted;
            this.muted = this.video.muted;
            this.applyMuteIcon();
            safeStorageSet('aug:mute', this.muted ? 'true' : 'false');
        }

        applyMuteIcon() {
            this.btnMute.classList.toggle('is-muted', this.muted);
            this.btnMute.setAttribute('aria-label', this.muted ? 'Unmute' : 'Mute');
            this.btnMute.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
        }

        updateBigPlayLabel() {
            const playing = !this.video.paused;
            this.bigPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }

        toggleFullscreen() {
            if (!document.fullscreenElement) {
                const req = this.root.requestFullscreen ||
                    this.root.webkitRequestFullscreen ||
                    this.root.mozRequestFullScreen ||
                    this.root.msRequestFullscreen;
                if (req) req.call(this.root).catch(() => { /* user denied */ });
            } else {
                const exit = document.exitFullscreen ||
                    document.webkitExitFullscreen ||
                    document.mozCancelFullScreen ||
                    document.msExitFullscreen;
                if (exit) exit.call(document);
            }
        }

        onPlayStart() {
            this.bigPlay.hidden = true;
            this.chrome.hidden = false;
            this.btnPlay.classList.add('is-playing');
        }

        onTimeUpdate() {
            const now = performance.now();
            if (now - this.lastTimeUpdate < 33) return; // ~30Hz cap
            this.lastTimeUpdate = now;

            const t = this.video.currentTime || 0;
            const d = this.duration || this.video.duration || 0;
            const pct = d > 0 ? (t / d) * 100 : 0;
            this.fill.style.width = pct + '%';
            this.thumb.style.left = pct + '%';
            this.timeCurrent.textContent = formatTime(t);
            this.scrubber.setAttribute('aria-valuenow', String(Math.round(pct)));

            emit('player:timeupdate', { id: this.id, currentTime: t, duration: d });
        }

        onProgress() {
            try {
                const buffered = this.video.buffered;
                const d = this.duration || this.video.duration || 0;
                if (buffered.length > 0 && d > 0) {
                    const end = buffered.end(buffered.length - 1);
                    this.buffer.style.width = ((end / d) * 100) + '%';
                }
                emit('player:progress', { id: this.id, buffered });
            } catch (_) { /* ignore */ }
        }

        onScrubStart(e) {
            e.preventDefault();
            this.isScrubbing = true;
            this.scrubber.setPointerCapture(e.pointerId);
            this.scrubber.addEventListener('pointermove', this._scrubMove = (ev) => this.onScrubMove(ev));
            this.scrubber.addEventListener('pointerup', this._scrubEnd = (ev) => this.onScrubEnd(ev));
            this.scrubber.addEventListener('pointercancel', this._scrubEnd);
            emit('player:scrub', { id: this.id, from: this.video.currentTime });
            this.seekFromEvent(e);
        }

        onScrubMove(e) {
            if (!this.isScrubbing) return;
            this.seekFromEvent(e);
        }

        onScrubEnd(e) {
            if (!this.isScrubbing) return;
            this.isScrubbing = false;
            try { this.scrubber.releasePointerCapture(e.pointerId); } catch (_) {}
            this.scrubber.removeEventListener('pointermove', this._scrubMove);
            this.scrubber.removeEventListener('pointerup', this._scrubEnd);
            emit('player:scrub', { id: this.id, to: this.video.currentTime });
        }

        seekFromEvent(e) {
            const rect = this.scrubber.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
            const pct = rect.width > 0 ? x / rect.width : 0;
            const d = this.duration || this.video.duration || 0;
            if (d > 0) {
                this.video.currentTime = pct * d;
                this.fill.style.width = (pct * 100) + '%';
                this.thumb.style.left = (pct * 100) + '%';
                this.timeCurrent.textContent = formatTime(this.video.currentTime);
            }
        }

        onScrubHover(e) {
            if (this.isScrubbing) return;
            const rect = this.scrubber.getBoundingClientRect();
            const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
            const pct = rect.width > 0 ? x / rect.width : 0;
            const d = this.duration || this.video.duration || 0;
            this.tooltip.hidden = false;
            this.tooltip.textContent = formatTime(pct * d);
            this.tooltip.style.left = (pct * 100) + '%';
        }

        onScrubKey(e) {
            const d = this.duration || this.video.duration || 0;
            if (!d) return;
            const step = 5;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.video.currentTime = Math.max(0, this.video.currentTime - step);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.video.currentTime = Math.min(d, this.video.currentTime + step);
            } else if (e.key === 'Home') {
                e.preventDefault();
                this.video.currentTime = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                this.video.currentTime = d;
            }
        }
    }

    // ---------- Init ----------
    function init() {
        const roots = document.querySelectorAll('[data-player]');
        const players = [];
        roots.forEach((root) => {
            try {
                players.push(new Player(root));
            } catch (err) {
                // Don't let one bad player break the rest
                console.warn('[player] init failed for', root.dataset.playerId, err);
            }
        });

        // Expose for debugging / timeline coordination
        window.AugPlayers = players;

        // React to timeline marker clicks — play that video
        bus.addEventListener('timeline:marker-click', (e) => {
            const id = e.detail && e.detail.id;
            const target = players.find((p) => p.id === id);
            if (target) target.play();
        });

        // Reduced-motion: skip the cursor lerp / parallax hooks are CSS-driven.
        // JS-side: nothing to do here, but keep the hook for future tuning.
        if (reducedMotion()) {
            document.documentElement.classList.add('reduced-motion');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
