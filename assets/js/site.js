/*
 * ТехАренда — калькулятор и форма заявки на чистом JavaScript (без фреймворков).
 * Повторяет поведение React-компонента Calculator.tsx оригинала. Цена здесь — только для показа:
 * сервер пересчитывает её сам и браузеру не доверяет.
 */
(function () {
  'use strict';
  var dataEl = document.getElementById('ta-data');
  if (!dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var C = D.content;
  var K = C.calculator;
  var CUR = K.currency;
  var NB = ' ';
  var COMMENT_MAX = 1000;
  var STATUS = { available: 'Свободна', check: 'Уточнить наличие', unavailable: 'Временно недоступна' };
  var LABELS = { serviceId: 'техника', address: 'адрес', date: 'дата', time: 'время', hours: 'часы', workType: 'тип работ', delivery: 'доставка', zoneId: 'зона доставки', comment: 'комментарий', name: 'имя', phone: 'телефон', consent: 'согласие' };
  var ORDER = ['serviceId', 'address', 'date', 'time', 'hours', 'workType', 'delivery', 'zoneId', 'comment', 'name', 'phone', 'consent'];
  var ICONS = {
    send: 'M21 3L3 10.5l7 2.5 2.5 7L21 3zM10 13l4-4',
    chat: 'M4 5h16v11H9l-5 4z',
    copy: 'M9 9h11v11H9zM5 15V4h11',
    check: 'M5 12l4 4 10-10'
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- форматирование (как в PHP) ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]; });
  }
  function fmtNumber(n) {
    var s = String(Math.round(Math.abs(n)));
    var out = '';
    while (s.length > 3) { out = NB + s.slice(-3) + out; s = s.slice(0, -3); }
    return (n < 0 ? '-' : '') + s + out;
  }
  function money(n) { return fmtNumber(n) + NB + CUR; }
  function range(lo, hi) { return lo === hi ? money(lo) : fmtNumber(lo) + '–' + fmtNumber(hi) + NB + CUR; }
  function plural(n, f) { var a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return f[2]; if (b > 1 && b < 5) return f[1]; if (b === 1) return f[0]; return f[2]; }
  function hoursText(n) { n = Math.round(n); return n + NB + plural(n, ['час', 'часа', 'часов']); }
  function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? m[3] + '.' + m[2] + '.' + m[1] : iso; }
  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[name] + '"></path></svg>';
  }
  function todayIso() {
    var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ---------- расчёт (порт pricing.ts) ----------
  var cents = function (x) { return Math.round(x * 100) / 100; };
  function findService(id) { for (var i = 0; i < C.services.length; i++) if (C.services[i].id === id) return C.services[i]; return null; }
  function minShiftOf(s) { return s.minShiftHours != null ? s.minShiftHours : K.minShiftHours; }
  function extrasFor(id) { return K.extras.filter(function (x) { return !x.appliesTo.length || x.appliesTo.indexOf(id) >= 0; }); }
  function estimateRange(total) {
    var step = K.roundTo;
    var lo = Math.floor(cents(total * (1 - K.lowerPercent / 100)) / step) * step;
    var hi = Math.ceil(cents(total * (1 + K.upperPercent / 100)) / step) * step;
    lo = Math.max(0, lo);
    return { low: lo, high: Math.max(lo, hi) };
  }
  function calculate(inp) {
    var s = findService(inp.serviceId);
    if (!s || s.status === 'unavailable') return null;
    var h = inp.hours;
    if (!isFinite(h) || h <= 0) return null;
    var ms = minShiftOf(s), bill = Math.max(h, ms), rent = cents(s.price * bill);
    var delivery = { kind: 'none' };
    if (inp.needDelivery) {
      var z = null;
      K.zones.forEach(function (x) { if (x.id === inp.zoneId) z = x; });
      if (!z) delivery = { kind: 'no-zone' };
      else if (z.price === null) delivery = { kind: 'unknown', zoneName: z.name };
      else delivery = { kind: 'priced', zoneName: z.name, amount: z.price };
    }
    var extras = extrasFor(s.id).filter(function (x) { return inp.extraIds.indexOf(x.id) >= 0; }).map(function (x) {
      return { extra: x, amount: x.price === null ? null : cents(x.unit === 'hour' ? x.price * bill : x.price) };
    });
    var known = cents(rent + (delivery.kind === 'priced' ? delivery.amount : 0) + extras.reduce(function (a, l) { return a + (l.amount || 0); }, 0));
    var unknown = delivery.kind === 'unknown' || delivery.kind === 'no-zone' || extras.some(function (l) { return l.amount === null; });
    var r = estimateRange(known);
    return { service: s, requestedHours: h, minShiftHours: ms, billableHours: bill, minShiftApplied: h < ms, rent: rent, delivery: delivery, extras: extras, knownTotal: known, hasUnknown: unknown, low: r.low, high: r.high };
  }

  // ---------- валидация (порт validation.ts; сервер проверяет то же самое) ----------
  function normalizePhone(input) {
    var t = input.trim();
    if (/[^\d\s()+\-.]/.test(t)) return null;
    var d = t.replace(/\D/g, ''), intl = t.charAt(0) === '+';
    if (!intl && d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    if (!intl && d.length === 10) d = '7' + d;
    if (d.length === 11 && d.charAt(0) === '7') return '+7 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9, 11);
    if (intl && d.length >= 10 && d.length <= 15) return '+' + d;
    return null;
  }
  var parseHours = function (h) { return Number(String(h).replace(',', '.')); };
  function validate(f) {
    var e = {}, s = findService(f.serviceId);
    if (!s) e.serviceId = 'Выберите технику';
    else if (s.status === 'unavailable') e.serviceId = 'Эта техника временно недоступна — выберите другую';
    if (f.address.trim().length < 5) e.address = 'Укажите адрес объекта (город, улица, ориентир)';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || isNaN(Date.parse(f.date))) e.date = 'Выберите дату';
    else if (f.date < todayIso()) e.date = 'Дата не может быть в прошлом';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) e.time = 'Укажите время начала';
    var h = parseHours(f.hours);
    if (String(f.hours).trim() === '' || !isFinite(h)) e.hours = 'Укажите количество часов';
    else if (Math.floor(h) !== h || h < 1) e.hours = 'Целое число часов, от 1';
    else if (h > K.maxHours) e.hours = 'Не больше ' + K.maxHours + ' часов в одной заявке';
    if (!f.workType || K.workTypes.indexOf(f.workType) < 0) e.workType = 'Выберите тип работ';
    if (!f.delivery) e.delivery = 'Укажите, нужна ли доставка';
    else if (f.delivery === 'yes' && K.zones.length && !K.zones.some(function (z) { return z.id === f.zoneId; })) e.zoneId = 'Выберите зону доставки';
    if (f.comment.length > COMMENT_MAX) e.comment = 'Не больше ' + COMMENT_MAX + ' символов';
    if (f.name.trim().length < 2) e.name = 'Как к вам обращаться?';
    if (!f.phone.trim()) e.phone = 'Укажите телефон для связи';
    else if (!normalizePhone(f.phone)) e.phone = 'Проверьте номер: например, +7 900 123-45-67';
    if (!f.consent) e.consent = 'Нужно согласие на обработку персональных данных';
    return e;
  }

  // ---------- состояние ----------
  var firstAvail = C.services.filter(function (s) { return s.status !== 'unavailable'; })[0];
  var f = {
    serviceId: firstAvail ? firstAvail.id : '', address: '', date: '', time: '09:00', hours: String(K.minShiftHours), workType: '',
    delivery: '', zoneId: '', extraIds: [], comment: '', name: '', phone: '', consent: false, website: ''
  };
  var showErrors = false, serverErrors = {}, outcome = 'idle', sending = false;
  var submissionId = newId();
  function newId() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  var form = $('#lead-form'), summary = $('#summary'), main = $('#summary-main');
  var el = {
    address: $('#f-address'), date: $('#f-date'), time: $('#f-time'), hours: $('#f-hours'), workType: $('#f-work'),
    zoneId: $('#f-zone'), comment: $('#f-comment'), name: $('#f-name'), phone: $('#f-phone'), consent: $('#f-consent'), website: $('#f-website')
  };
  if (el.date) el.date.min = todayIso();

  function currentEstimate() {
    var h = parseHours(f.hours);
    return Number.isInteger(h) && h >= 1 && h <= K.maxHours
      ? calculate({ serviceId: f.serviceId, hours: h, needDelivery: f.delivery === 'yes', zoneId: f.zoneId, extraIds: f.extraIds })
      : null;
  }

  function imgHtml(url, cls) {
    return '<figure class="img ' + cls + '">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async">' : '<div class="img__empty" role="img" aria-label=""><span>Фото не выбрано</span></div>') + '</figure>';
  }

  function summaryHtml(e) {
    if (!e) return '<p class="summary__empty">Выберите доступную технику и укажите целое количество часов — расчёт появится здесь.</p>';
    var s = e.service, d = e.delivery;
    var h = '<div class="summary__body" data-testid="summary"><div class="summary__machine">' + imgHtml(s.imageUrl, 'summary__thumb') +
      '<div><b>' + esc(s.name) + '</b><span class="status status--' + s.status + '"><i aria-hidden="true"></i>' + STATUS[s.status] + '</span></div></div><dl class="lines">';
    h += '<div><dt>Аренда<small>' + money(s.price) + ' × ' + hoursText(e.billableHours) + '</small></dt><dd data-testid="rent">' + money(e.rent) + '</dd></div>';
    if (e.minShiftApplied) h += '<p class="lines__note" data-testid="minshift-note">Указано ' + hoursText(e.requestedHours) + ' — применена минимальная смена ' + hoursText(e.minShiftHours) + '.</p>';
    h += '<div><dt>Доставка' + (d.kind === 'priced' || d.kind === 'unknown' ? '<small>' + esc(d.zoneName) + '</small>' : '') + '</dt><dd data-testid="delivery">';
    if (d.kind === 'priced') h += money(d.amount);
    else if (d.kind === 'unknown') h += '<span class="tbd">Уточним стоимость доставки</span>';
    else if (d.kind === 'no-zone') h += '<span class="tbd">Выберите зону</span>';
    else h += f.delivery === 'no' ? 'Не нужна' : '<span class="muted">—</span>';
    h += '</dd></div>';
    e.extras.forEach(function (l) {
      h += '<div><dt>' + esc(l.extra.name) + (l.extra.unit === 'hour' && l.extra.price !== null ? '<small>' + money(l.extra.price) + ' × ' + hoursText(e.billableHours) + '</small>' : '') +
        '</dt><dd>' + (l.amount === null ? '<span class="tbd">Уточним</span>' : money(l.amount)) + '</dd></div>';
    });
    h += '</dl><div class="total"><span>Итого предварительно</span><b data-testid="range">' + range(e.low, e.high) + '</b>' +
      (e.hasUnknown ? '<small>+ позиции, стоимость которых уточнит менеджер</small>' : '') + '</div><p class="disclaimer">' + esc(K.disclaimer) + '</p>';
    if (s.status === 'check') h += '<p class="alert alert--warn">Наличие этой техники уточнит менеджер после заявки.</p>';
    return h + '</div>';
  }

  function renderExtras() {
    var box = $('#extras');
    if (!box) return;
    var s = findService(f.serviceId);
    var list = s ? extrasFor(s.id) : [];
    box.innerHTML = list.map(function (x) {
      return '<label class="check"><input type="checkbox" value="' + esc(x.id) + '"' + (f.extraIds.indexOf(x.id) >= 0 ? ' checked' : '') + '><span>' + esc(x.name) + ' <span class="muted">' +
        (x.price === null ? '— стоимость уточним' : '— ' + money(x.price) + (x.unit === 'hour' ? '/час' : ' за заказ')) + '</span></span></label>';
    }).join('');
  }

  function allErrors() {
    var e = validate(f);
    Object.keys(serverErrors).forEach(function (k) { if (serverErrors[k]) e[k] = serverErrors[k]; });
    return e;
  }

  function renderErrors() {
    var errs = showErrors ? allErrors() : {};
    $$('[data-error]').forEach(function (n) {
      var k = n.getAttribute('data-error');
      n.textContent = errs[k] || '';
      n.hidden = !errs[k];
    });
    ['address', 'date', 'time', 'hours', 'workType', 'zoneId', 'comment', 'name', 'phone'].forEach(function (k) {
      if (el[k]) { if (errs[k]) el[k].setAttribute('aria-invalid', 'true'); else el[k].removeAttribute('aria-invalid'); }
    });
    var consentLabel = el.consent && el.consent.closest('.consent');
    if (consentLabel) consentLabel.classList.toggle('has-error', !!errs.consent);
    var keys = ORDER.filter(function (k) { return errs[k]; });
    var box = $('#form-errors');
    if (box) { box.hidden = !keys.length; box.textContent = keys.length ? 'Заполните: ' + keys.map(function (k) { return LABELS[k]; }).join(', ') + '.' : ''; }
    return keys;
  }

  function render() {
    var s = findService(f.serviceId);
    $$('.pick').forEach(function (p) {
      var inp = $('input', p);
      var on = inp.value === f.serviceId;
      p.classList.toggle('is-on', on);
      inp.checked = on;
    });
    $$('.seg__opt').forEach(function (o) { var v = $('input', o).value; o.classList.toggle('is-on', f.delivery === v); $('input', o).checked = f.delivery === v; });
    var zf = $('#zone-field');
    if (zf) zf.hidden = f.delivery !== 'yes';
    $$('.chip[data-hours]').forEach(function (c) { c.classList.toggle('is-on', c.getAttribute('data-hours') === f.hours); });
    var ms = s ? minShiftOf(s) : K.minShiftHours;
    var hint = $('#shift-hint');
    if (hint) hint.textContent = 'Минимальная смена — ' + hoursText(ms) + '. Если работы меньше, оплачивается ' + hoursText(ms) + '.';
    var cnt = $('#comment-counter');
    if (cnt) { cnt.textContent = f.comment.length + '/' + COMMENT_MAX; cnt.classList.toggle('is-over', f.comment.length > COMMENT_MAX); }
    if (outcome === 'sent') return;
    var est = currentEstimate();
    var live = $('#summary-live');
    if (live) live.innerHTML = summaryHtml(est);
    var mr = $('#mobile-range');
    if (mr) mr.textContent = est ? range(est.low, est.high) + (est.hasUnknown ? ' +' : '') : '—';
    updateBar();
    renderErrors();
  }

  function set(k, v) {
    f[k] = v;
    if (k === 'serviceId') {
      var allowed = extrasFor(v).map(function (x) { return x.id; });
      f.extraIds = f.extraIds.filter(function (id) { return allowed.indexOf(id) >= 0; });
      renderExtras();
    }
    if (k === 'delivery' && v === 'no') { f.zoneId = ''; if (el.zoneId) el.zoneId.value = ''; }
    delete serverErrors[k];
    if (outcome === 'manual' || outcome === 'demo') setOutcome('idle');
    notice('');
    render();
  }

  // ---------- события формы ----------
  [['address', 'input'], ['date', 'input'], ['time', 'input'], ['hours', 'input'], ['workType', 'change'], ['zoneId', 'change'], ['comment', 'input'], ['name', 'input'], ['phone', 'input'], ['website', 'input']].forEach(function (p) {
    var n = el[p[0]];
    if (n) n.addEventListener(p[1], function () { set(p[0], n.value); });
  });
  if (el.date) el.date.addEventListener('change', function () { set('date', el.date.value); });
  if (el.consent) el.consent.addEventListener('change', function () { set('consent', el.consent.checked); });
  $$('.pick input').forEach(function (i) { i.addEventListener('change', function () { set('serviceId', i.value); }); });
  $$('.seg__opt input').forEach(function (i) { i.addEventListener('change', function () { set('delivery', i.value); }); });
  $$('[data-hours-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = Number(b.getAttribute('data-hours-step'));
      var v = d < 0 ? Math.max(1, (Number(f.hours) || 1) - 1) : Math.min(K.maxHours, (Number(f.hours) || 0) + 1);
      el.hours.value = String(v);
      set('hours', String(v));
    });
  });
  $$('.chip[data-hours]').forEach(function (b) { b.addEventListener('click', function () { el.hours.value = b.getAttribute('data-hours'); set('hours', b.getAttribute('data-hours')); }); });
  var extrasBox = $('#extras');
  if (extrasBox) extrasBox.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || t.type !== 'checkbox') return;
    set('extraIds', t.checked ? f.extraIds.concat([t.value]) : f.extraIds.filter(function (id) { return id !== t.value; }));
  });
  form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(); });

  // Кнопки «Оставить заявку» в карточках: техника подставляется в калькулятор
  $$('[data-order]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (outcome === 'sent') resetForm();
      set('serviceId', b.getAttribute('data-order'));
      setOutcome('idle');
      var picker = $('.picker');
      picker.classList.add('is-flash');
      setTimeout(function () { picker.classList.remove('is-flash'); }, 1400);
      document.getElementById('calc').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  function focusFirst(keys) {
    var n = keys[0] && document.querySelector('[data-field="' + keys[0] + '"]');
    if (!n) return;
    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); }
  }

  function notice(t) {
    var n = $('#form-notice');
    if (!n) return;
    n.hidden = !t;
    n.textContent = t || '';
  }

  // ---------- текст заявки (для ручной отправки, если сервер недоступен) ----------
  function leadText(e) {
    var d = e.delivery, dl = 'Не нужна', dc = '—';
    if (d.kind === 'priced') { dl = 'Нужна — ' + d.zoneName; dc = money(d.amount); }
    else if (d.kind === 'unknown') { dl = 'Нужна — ' + d.zoneName; dc = 'уточнить'; }
    else if (d.kind === 'no-zone') { dl = 'Нужна — зона не выбрана'; dc = 'уточнить'; }
    var lines = ['НОВАЯ ЗАЯВКА НА АРЕНДУ', '', 'Техника: ' + e.service.name + ' (' + money(e.service.price) + '/час)', 'Адрес: ' + f.address.trim(), 'Дата: ' + fmtDate(f.date), 'Время: ' + f.time,
      'Количество часов: ' + (e.minShiftApplied ? e.requestedHours + ' (минимальная смена ' + e.minShiftHours + ' ч — к оплате ' + e.billableHours + ' ч)' : e.requestedHours),
      'Тип работ: ' + f.workType, 'Доставка: ' + dl];
    if (e.extras.length) lines.push('Доп. услуги: ' + e.extras.map(function (l) { return l.extra.name + ' — ' + (l.amount === null ? 'уточнить' : money(l.amount)); }).join('; '));
    lines.push('Стоимость аренды: ' + money(e.rent), 'Стоимость доставки: ' + dc, 'Предварительный диапазон: ' + range(e.low, e.high) + (e.hasUnknown ? ' + позиции «уточнить»' : ''),
      'Имя: ' + f.name.trim(), 'Телефон: ' + (normalizePhone(f.phone) || f.phone.trim()), 'Комментарий: ' + (f.comment.trim() || '—'));
    return lines.join('\n').replace(/ /g, ' ');
  }

  function copyText(t) {
    try {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    } catch (e) { /* запасной способ */ }
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function setOutcome(o, payload) {
    outcome = o;
    summary.classList.toggle('summary--static', o === 'manual' || o === 'demo');
    var slot = $('#request-panel-slot');
    if (o !== 'manual' && o !== 'demo' && slot) slot.innerHTML = '';
    if (o === 'manual') slot.innerHTML = manualHtml(payload);
    if (o === 'demo') slot.innerHTML = demoHtml(payload);
    if (o === 'sent') showSuccess(payload);
    var btn = $('#submit-btn');
    if (btn) {
      btn.disabled = o === 'sending';
      btn.innerHTML = o === 'sending' ? '<span class="spinner" aria-hidden="true"></span> Отправляем…' : icon('send', 20) + ' Отправить заявку';
    }
  }

  function demoHtml(p) {
    return '<div class="request" data-testid="request-panel"><div class="alert alert--info" role="status"><b>Демонстрационный режим: отправка заявки отключена.</b> ' +
      'Расчёт выше — демонстрационный. В рабочей версии сайта заявка сохраняется в базе и приходит диспетчеру в Telegram и ВКонтакте.</div>' +
      '<textarea class="request__text" readonly rows="10" aria-label="Пример текста заявки">' + esc(p.message) + '</textarea></div>';
  }

  function manualHtml(p) {
    var tg = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/.test(C.company.telegramUsername) ? C.company.telegramUsername : '';
    var vk = /^[\w.]{2,64}$/.test(C.company.vkCommunity) ? C.company.vkCommunity : '';
    var phone = C.company.phone;
    var h = '<div class="request" data-testid="request-panel"><div class="alert alert--warn" role="status"><b>Не получилось отправить заявку.</b> Она ещё не отправлена — отправьте её сами одним из способов ниже' + (phone ? ' или позвоните ' + esc(phone) : '') + '.</div><div class="request__actions">';
    if (tg) h += '<a class="btn btn--primary" href="https://t.me/' + esc(tg) + '?text=' + encodeURIComponent(p.message) + '" target="_blank" rel="noopener noreferrer">' + icon('send', 18) + ' Отправить в Telegram</a>';
    if (vk) h += '<a class="btn btn--primary" href="https://vk.me/' + esc(vk) + '" target="_blank" rel="noopener noreferrer" data-copy-msg>' + icon('chat', 18) + ' Открыть чат ВКонтакте</a>';
    h += '<button type="button" class="btn btn--ghost" data-copy-msg>' + icon('copy', 18) + ' Скопировать текст</button></div>';
    if (vk) h += '<p class="hint">Во ВКонтакте текст не подставляется сам — вставьте его в чат (он уже скопирован).</p>';
    h += '<p class="hint" role="status" id="copy-note" hidden></p><textarea class="request__text" readonly rows="10" aria-label="Текст заявки">' + esc(p.message) + '</textarea></div>';
    return h;
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-copy-msg]');
    if (!t) return;
    var ta = $('.request__text');
    copyText(ta ? ta.value : '').then(function (ok) {
      var n = $('#copy-note');
      if (n && t.tagName === 'BUTTON') { n.hidden = false; n.textContent = ok ? 'Текст заявки скопирован' : 'Не получилось — выделите текст вручную'; }
    });
  });

  function showSuccess(r) {
    var ch = r.notified || {}, where = [];
    if (ch.telegram === 'sent') where.push('Telegram');
    if (ch.vk === 'sent') where.push('ВКонтакте');
    var phone = normalizePhone(f.phone) || f.phone;
    var title, body;
    if (where.length) {
      title = 'Заявка №' + esc(r.number) + ' отправлена';
      body = 'Диспетчер «' + esc(C.brand.name) + '» получил её в ' + where.join(' и ') + '. Мы перезвоним на номер <b>' + esc(phone) + '</b>, чтобы подтвердить время и стоимость.';
    } else {
      title = 'Заявка №' + esc(r.number) + ' принята';
      body = 'Мы сохранили заявку — менеджер «' + esc(C.brand.name) + '» увидит её в списке заявок и перезвонит на номер <b>' + esc(phone) + '</b>, чтобы подтвердить время и стоимость.';
    }
    main.innerHTML = '<div class="success" data-testid="success" role="status"><div class="success__icon">' + icon('check', 34) + '</div><h3>' + title + '</h3><p>' + body + '</p>' +
      (C.company.phone ? '<p class="muted">Срочно? Позвоните: <a href="tel:' + esc(C.company.phone.replace(/[^\d+]/g, '')) + '">' + esc(C.company.phone) + '</a></p>' : '') +
      '<button type="button" class="btn btn--ghost btn--block" id="again">Оформить ещё одну заявку</button></div>';
    $('#again').addEventListener('click', resetForm);
    $('#mobile-bar').classList.remove('is-visible');
  }

  var mainTemplate = main.innerHTML;
  function resetForm() {
    var keep = f.serviceId;
    f = { serviceId: keep, address: '', date: '', time: '09:00', hours: String(K.minShiftHours), workType: '', delivery: '', zoneId: '', extraIds: [], comment: '', name: '', phone: '', consent: false, website: '' };
    form.reset();
    el.time.value = '09:00';
    el.hours.value = f.hours;
    showErrors = false;
    serverErrors = {};
    submissionId = newId();
    main.innerHTML = mainTemplate;
    bindSummary();
    outcome = 'idle';
    summary.classList.remove('summary--static');
    renderExtras();
    render();
  }

  function bindSummary() {
    $('#submit-btn').addEventListener('click', submit);
  }

  function submit() {
    if (sending) return;
    showErrors = true;
    var keys = renderErrors();
    var est = currentEstimate();
    if (keys.length || !est) return focusFirst(keys);
    var message = leadText(est);
    if (D.mode === 'demo') return setOutcome('demo', { message: message });

    sending = true;
    setOutcome('sending');
    var body = {
      serviceId: f.serviceId, address: f.address, date: f.date, time: f.time, hours: f.hours, workType: f.workType, delivery: f.delivery, zoneId: f.zoneId,
      extraIds: f.extraIds, comment: f.comment, name: f.name, phone: f.phone, consent: f.consent, website: f.website, submissionId: submissionId, formToken: D.formToken
    };
    var status = 0;
    fetch(D.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { status = r.status; return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        sending = false;
        if (status === 200 && j.ok) {
          setOutcome('sent', j);
          if (window.matchMedia('(max-width: 1080px)').matches) setTimeout(function () { summary.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
          return;
        }
        setOutcome('idle');
        if (status === 422 && j.fieldErrors) { serverErrors = j.fieldErrors; var k = renderErrors(); focusFirst(k); return; }
        if (status === 429 || status === 403) { notice(j.error || 'Не удалось отправить. Обновите страницу и попробуйте снова.'); return; }
        copyText(message);
        setOutcome('manual', { message: message });
      })
      .catch(function () {
        sending = false;
        copyText(message);
        setOutcome('manual', { message: message });
      });
  }

  // ---------- плашка с ценой внизу экрана на телефоне ----------
  var inSection = false, asideVisible = false;
  function updateBar() {
    var bar = $('#mobile-bar');
    if (!bar) return;
    var vis = inSection && !asideVisible && outcome !== 'sent' && !!currentEstimate();
    bar.classList.toggle('is-visible', vis);
    bar.setAttribute('aria-hidden', vis ? 'false' : 'true');
    $('#mobile-to-summary').tabIndex = vis ? 0 : -1;
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { inSection = en[0].isIntersecting; updateBar(); }).observe(document.getElementById('calc'));
    new IntersectionObserver(function (en) { asideVisible = en[0].isIntersecting; updateBar(); }).observe(summary);
  }
  $('#mobile-to-summary').addEventListener('click', function () { summary.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  bindSummary();
  renderExtras();
  render();
})();
