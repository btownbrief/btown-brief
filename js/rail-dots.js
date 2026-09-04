(function () {
  'use strict';

  var instances = new WeakMap();
  /* Past this many dots they stop reading as pages and start reading as a
     dotted line; the mapping stays proportional to the scroll. */
  var MAX_DOTS = 7;

  function attach(scroller, opts) {
    if (!scroller) return null;
    if (instances.has(scroller)) {
      instances.get(scroller).sync();
      return instances.get(scroller);
    }

    opts = opts || {};
    scroller.classList.add('rail-dots-scroller');
    var wrap = document.createElement('div');
    wrap.className = 'rail-dots-wrap';
    scroller.parentNode.insertBefore(wrap, scroller);
    wrap.appendChild(scroller);
    var dots = document.createElement('div');
    dots.className = 'rail-dots';
    dots.setAttribute('aria-hidden', 'true');
    wrap.appendChild(dots);

    function maxScroll() {
      return Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    }

    function mark() {
      var count = dots.childElementCount;
      var max = maxScroll();
      var active = max && count > 1
        ? Math.round((scroller.scrollLeft / max) * (count - 1)) : 0;
      for (var i = 0; i < count; i++) {
        dots.children[i].classList.toggle('is-active', i === active);
      }
    }

    function sync() {
      var width = scroller.clientWidth;
      var max = maxScroll();
      var screenfuls = width && max > 1 ? Math.ceil(scroller.scrollWidth / width) : 0;
      var count = Math.min(scroller.children.length, screenfuls, MAX_DOTS);
      dots.hidden = count < 2;
      if (dots.childElementCount !== count) {
        dots.innerHTML = '';
        for (var i = 0; i < count; i++) (function (index) {
          var button = document.createElement('button');
          button.type = 'button';
          button.tabIndex = -1;
          button.setAttribute('aria-label', (opts.label || 'Carousel') + ' page ' + (index + 1) + ' of ' + count);
          button.addEventListener('click', function () {
            var end = maxScroll();
            scroller.scrollTo({ left: count > 1 ? end * index / (count - 1) : 0, behavior: 'smooth' });
          });
          dots.appendChild(button);
        })(i);
      }
      mark();
    }

    var frame = 0;
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    }
    scroller.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', schedule);
    var observer = new MutationObserver(schedule);
    observer.observe(scroller, { childList: true, subtree: true });
    var resizeObserver = window.ResizeObserver ? new ResizeObserver(schedule) : null;
    if (resizeObserver) resizeObserver.observe(scroller);

    var api = { sync: sync };
    instances.set(scroller, api);
    sync();
    return api;
  }

  window.BtownRailDots = { attach: attach };
})();
