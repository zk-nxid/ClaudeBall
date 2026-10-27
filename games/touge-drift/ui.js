/* Touge Drift - UI screens (DOM overlays on top of the canvas). Event delegation on data-act attributes; every string
 * inserted into markup comes from the game's own data or numbers (nothing user-typed), and is escaped anyway. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const V = TD.Vehicles, Progress = TD.Progress, Save = TD.Save;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Math.round(n).toLocaleString('en-US');
  const fmtT = t => { if (t == null) return '--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const MEDAL = ['No medal', 'Bronze', 'Silver', 'Gold'], MCLS = ['none', 'bronze', 'silver', 'gold'];
  const MODES = { time: ['Time Attack', 'Race the clock to the finish line. Your best run becomes your ghost.'], drift: ['Drift Attack', 'Score points for controlled drifts all the way down. Crashes cost you.'], rival: ['Rival Battle', 'Race AI drivers down the mountain. Same physics, real finishing order.'] };

  function create(api) {
    const app = api.app, root = document.getElementById('ui');
    const U = { name: null, data: null, stack: [], garage: { carId: null, tab: 'upgrades' }, free: { mode: 'time', course: 'pine-ridge', rivals: 2 }, career: { region: 1 }, toastT: 0 };
    const save = () => app.save;
    const Audio = TD.Audio;

    function crHTML() { return '<div class="credits" title="Credits">' + num(save().credits) + ' <small>CR</small></div>'; }
    function top(title, back, extra) { return '<header class="top">' + (back === false ? '<span></span>' : '<button class="btn small" data-act="back">&larr; Back</button>') + '<h2>' + esc(title) + '</h2>' + (extra || crHTML()) + '</header>'; }
    function medalPips(m) { return '<span class="pips m' + m + '" aria-label="' + MEDAL[m] + '"><i></i><i></i><i></i></span>'; }
    const carName = id => (V.carById(id) || {}).name || id;

    /* ---------- navigation ---------- */
    function show(name, data, push) {
      if (push && U.name) U.stack.push({ name: U.name, data: U.data });
      if (name == null) { root.hidden = true; root.innerHTML = ''; U.name = null; app.screen = 'race'; return; }
      U.name = name; U.data = data; app.screen = name; root.hidden = false;
      (SCREENS[name] || SCREENS.title)(data);
      const f = root.querySelector('[data-focus], .btn.primary, .btn'); if (f && name !== 'garage') f.focus({ preventScroll: true });
    }
    function back() {
      Audio.play.back(); const prev = U.stack.pop();
      if (prev) { show(prev.name, prev.data); return; }
      if (U.name === 'pause') { api.resume(); return; }
      show('title');
    }
    function render(html, cls) { root.innerHTML = '<div class="screen s-' + (cls || 'x') + '">' + html + '</div>'; }

    function toast(text) { let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); } t.textContent = text; t.classList.add('on'); clearTimeout(U.toastT); U.toastT = setTimeout(() => t.classList.remove('on'), 3200); }
    function confirmBox(title, text, ok) {
      return new Promise(res => { const d = document.createElement('div'); d.className = 'modal'; d.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="row"><button class="btn" data-m="0">Cancel</button><button class="btn primary" data-m="1">' + esc(ok || 'OK') + '</button></div></div>';
        d.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { d.remove(); res(b.dataset.m === '1'); } }); document.body.append(d); d.querySelector('[data-m="0"]').focus(); });
    }

    /* ---------- screens ---------- */
    const SCREENS = {
      title() {
        const s = save(), car = V.carById(s.selected), stars = Progress.EVENTS().reduce((n, e) => n + ((s.career.events[e.id] || {}).medal || 0), 0);
        render('<div class="logo"><span class="kicker">ARCADE &middot; RACING</span><h1>TOUGE<br>DRIFT</h1><p>Master the mountain.</p></div>' +
          '<nav class="menu" aria-label="Main menu"><button class="btn primary" data-act="career">Career</button><button class="btn" data-act="free">Free Play</button><button class="btn" data-act="garage">Garage</button><button class="btn" data-act="records">Records</button><button class="btn" data-act="settings">Settings</button>' +
          '<a class="btn ghost" id="lib-link" href="../../index.html" data-act="library">&larr; Back to Library</a></nav>' +
          '<footer class="foot"><span>' + num(s.credits) + ' CR</span><span>' + esc(car.name) + '</span><span>' + stars + ' / 72 &#9733;</span></footer>', 'title');
      },
      career() {
        const s = save(); let h = top('Career', true);
        h += '<div class="body"><p class="lead">Six mountains, four events each. Earn medals to open the next road and the cars that wait there.</p><div class="regions">';
        TD.Tracks.COURSES.forEach((c, i) => { const r = i + 1, open = Progress.regionUnlocked(s, r), st = Progress.stars(s, r), need = Progress.STARS_TO_UNLOCK;
          const prev = i ? TD.Tracks.COURSES[i - 1].name : '';
          h += '<button class="region' + (open ? '' : ' locked') + '" ' + (open ? 'data-act="region" data-i="' + r + '"' : 'disabled') + '><span class="no">0' + r + '</span><span class="nm">' + esc(c.name) + '</span><span class="tag">' + esc(c.tag) + '</span>' +
            '<span class="stars">' + (open ? st + ' / 12 &#9733;' : 'Locked &middot; earn ' + need + ' &#9733; in ' + esc(prev)) + '</span><span class="len">' + (Progress.track(c.id).raceLength / 1000).toFixed(1) + ' km</span></button>'; });
        render(h + '</div></div>', 'career');
      },
      region(r) {
        r = r || U.career.region; U.career.region = r; const s = save(), c = TD.Tracks.COURSES[r - 1];
        let h = top(c.name, true) + '<div class="body"><p class="lead">' + esc(c.tag) + ' &middot; ' + (Progress.track(c.id).raceLength / 1000).toFixed(1) + ' km &middot; ' + Progress.stars(s, r) + ' / 12 &#9733;</p><div class="events">';
        Progress.EVENTS().filter(e => e.region === r).forEach(ev => {
          const st = s.career.events[ev.id] || { medal: 0 }; const th = ev.mode === 'time' ? Progress.thresholds(ev.course, 'time') : ev.mode === 'drift' ? Progress.thresholds(ev.course, 'drift') : null;
          const target = ev.mode === 'time' ? 'Gold ' + fmtT(th[3]) + ' &middot; Silver ' + fmtT(th[2]) + ' &middot; Bronze ' + fmtT(th[1]) : ev.mode === 'drift' ? 'Gold ' + num(th[3]) + ' &middot; Silver ' + num(th[2]) + ' &middot; Bronze ' + num(th[1]) : 'Finish 1st for gold, 2nd silver' + (ev.rivals > 1 ? ', 3rd bronze' : '');
          h += '<div class="event"><div class="ico ' + ev.mode + '"></div><div class="txt"><b>' + esc(ev.title) + '</b><span>' + esc(ev.blurb) + '</span><small>' + target + '</small></div><div class="side">' + medalPips(st.medal) + '<small>up to ' + num(Math.round(ev.base * 2.4)) + ' CR</small><button class="btn small primary" data-act="event" data-id="' + ev.id + '">Start</button></div></div>';
        });
        render(h + '</div></div>', 'region');
      },
      free() {
        const s = save(), F = U.free; let h = top('Free Play', true) + '<div class="body"><div class="tabs">';
        for (const m of Object.keys(MODES)) h += '<button class="tab' + (F.mode === m ? ' on' : '') + '" data-act="fmode" data-m="' + m + '">' + MODES[m][0] + '</button>';
        h += '</div><p class="lead">' + MODES[F.mode][1] + ' Practice runs pay a small amount of credits.</p><div class="courses">';
        TD.Tracks.COURSES.forEach((c, i) => { const open = Progress.courseUnlocked(s, c.id), rec = (s.records[c.id] || {});
          h += '<button class="course' + (F.course === c.id ? ' on' : '') + (open ? '' : ' locked') + '" ' + (open ? 'data-act="fcourse" data-id="' + c.id + '"' : 'disabled') + '><b>' + esc(c.name) + '</b><span>' + esc(c.tag) + '</span><small>' + (open ? (F.mode === 'drift' ? (rec.drift ? 'Best ' + num(rec.drift.value) : 'No score yet') : (rec.time ? 'Best ' + fmtT(rec.time.value) : 'No time yet')) : 'Locked') + '</small></button>'; });
        h += '</div>';
        if (F.mode === 'rival') h += '<div class="inline"><label>Rivals</label>' + [1, 2, 3].map(n => '<button class="tab' + (F.rivals === n ? ' on' : '') + '" data-act="frivals" data-n="' + n + '">' + n + '</button>').join('') + '</div>';
        h += '<div class="actions"><button class="btn primary" data-act="fgo" data-focus>Continue</button></div></div>';
        render(h, 'free');
      },
      prerace(run) {
        const s = save(), c = TD.Tracks.COURSES.find(x => x.id === run.courseId), car = V.carById(s.selected), an = V.analyze(car, s.owned[s.selected]);
        const ghost = run.mode !== 'drift' ? Save.loadGhost(run.courseId) : null, th = run.mode === 'time' ? Progress.thresholds(run.courseId, 'time') : run.mode === 'drift' ? Progress.thresholds(run.courseId, 'drift') : null;
        let h = top(MODES[run.mode][0], true) + '<div class="body prerace"><div class="card"><span class="kicker">' + esc(c.tag.toUpperCase()) + '</span><h3>' + esc(c.name) + '</h3><p>' + (Progress.track(c.id).raceLength / 1000).toFixed(1) + ' km &middot; ' + Progress.track(c.id).driftZones.length + ' drift zones &middot; ' + (Progress.track(c.id).checkpoints.length - 1) + ' checkpoints</p>';
        if (th) h += '<div class="targets">' + [3, 2, 1].map(m => '<div class="t ' + MCLS[m] + '"><b>' + MEDAL[m] + '</b><span>' + (run.mode === 'time' ? '&le; ' + fmtT(th[m]) : '&ge; ' + num(th[m])) + '</span></div>').join('') + '</div>';
        else h += '<div class="targets">' + (run.rivals || []).map(r => '<div class="t"><b>' + esc(r.name) + '</b><span>' + esc(carName(r.carId)) + ' &middot; skill ' + Math.round(r.skill * 100) + '</span></div>').join('') + '</div>';
        h += '</div><div class="card"><span class="kicker">YOUR CAR</span><h3>' + esc(car.name) + '</h3><p>' + esc(car.cls) + ' &middot; ' + an.hp + ' hp &middot; ' + an.kg + ' kg &middot; ' + car.drive + '</p><button class="btn small" data-act="garage-from">Change car / tune</button>' +
          (ghost ? '<label class="chk"><input type="checkbox" data-act="ghost"' + (run.ghost !== false ? ' checked' : '') + '> Race my ghost (' + fmtT(ghost.time) + ')</label>' : '') +
          '<p class="note">Assist: ' + api.ASSIST_NAMES[app.settings.assist] + ' &middot; Camera: ' + api.CAMERAS[app.settings.camera] + ' (C to change)</p></div></div><div class="actions"><button class="btn primary" data-act="go" data-focus>Start</button></div>';
        render(h, 'prerace');
      },
      garage() { renderGarage(); },
      records() {
        const s = save(); let h = top('Records', true) + '<div class="body"><table class="rec"><thead><tr><th>Course</th><th>Best time</th><th>Car</th><th>Best drift</th><th>Car</th></tr></thead><tbody>';
        TD.Tracks.COURSES.forEach(c => { const r = s.records[c.id] || {}; h += '<tr><td>' + esc(c.name) + '</td><td>' + (r.time ? fmtT(r.time.value) : '--') + '</td><td>' + (r.time ? esc(carName(r.time.carId)) : '') + '</td><td>' + (r.drift ? num(r.drift.value) : '--') + '</td><td>' + (r.drift ? esc(carName(r.drift.carId)) : '') + '</td></tr>'; });
        const st = s.stats; h += '</tbody></table><div class="stats"><div><b>' + st.runs + '</b><span>runs</span></div><div><b>' + st.finishes + '</b><span>finishes</span></div><div><b>' + st.wins + '</b><span>rival wins</span></div><div><b>' + num(st.driftPoints) + '</b><span>drift points</span></div><div><b>' + num(st.bestDriftChain) + '</b><span>best chain</span></div><div><b>' + (st.metres / 1000).toFixed(1) + ' km</b><span>raced</span></div><div><b>' + num(st.creditsEarned) + '</b><span>credits earned</span></div></div></div>';
        render(h, 'records');
      },
      settings() { renderSettings(); },
      results(d) { renderResults(d); },
      pause() {
        render('<div class="panel"><h2>Paused</h2><button class="btn primary" data-act="resume" data-focus>Resume</button><button class="btn" data-act="restart">Restart</button><button class="btn" data-act="cam">Camera: ' + api.CAMERAS[app.settings.camera] + '</button><button class="btn" data-act="mute">Sound: ' + (app.settings.muted ? 'Off' : 'On') + '</button><button class="btn" data-act="settings-pause">Settings</button>' +
          '<button class="btn" data-act="library">&larr; Back to Library</button><button class="btn danger" data-act="quit">Quit to menu</button></div>', 'pause');
      },
    };

    /* ---------- garage ---------- */
    const STAT_ROWS = [
      ['Power', a => a.hp + ' hp', 'rPower', a => a.hp, 1], ['Weight', a => a.kg + ' kg', 'rWeight', a => a.kg, -1], ['Top speed', a => a.topKmh + ' km/h', 'rTop', a => a.topKmh, 1],
      ['0-100 km/h', a => a.t100.toFixed(1) + ' s', 'rAccel', a => a.t100, -1], ['Braking 100-0', a => a.stop + ' m', null, a => a.stop, -1], ['Grip', a => a.grip.toFixed(2) + ' g', 'rGrip', a => a.grip, 1],
      ['Handling', a => a.skidKmh + ' km/h skidpad', 'rHandling', a => a.skidKmh, 1], ['Drift stability', a => a.rDrift + ' / 100', 'rDrift', a => a.rDrift, 1],
    ];
    function statsHTML(a, p) {
      return '<div class="stats-list">' + STAT_ROWS.map(r => { const v = r[3](a), pv = p ? r[3](p) : v, d = pv - v, good = d * r[4] > 0.0001, bad = d * r[4] < -0.0001;
        const dText = p && Math.abs(d) > 0.0001 ? '<em class="' + (good ? 'up' : 'down') + '">' + (d > 0 ? '+' : '') + (Math.abs(d) < 10 && r[0] !== 'Weight' ? d.toFixed(r[0] === 'Grip' ? 2 : 1) : Math.round(d)) + '</em>' : '';
        const rating = r[2] ? a[r[2]] : Math.round(100 * Math.max(0.04, Math.min(1, (52 - a.stop) / 24))), prating = p ? (r[2] ? p[r[2]] : Math.round(100 * Math.max(0.04, Math.min(1, (52 - p.stop) / 24)))) : rating;
        return '<div class="stat"><span class="k">' + r[0] + '</span><span class="bar"><i style="width:' + Math.min(rating, prating) + '%"></i>' + (prating > rating ? '<i class="plus" style="left:' + rating + '%;width:' + (prating - rating) + '%"></i>' : prating < rating ? '<i class="minus" style="left:' + prating + '%;width:' + (rating - prating) + '%"></i>' : '') + '</span><span class="v">' + r[1](a) + dText + '</span></div>'; }).join('') + '</div>';
    }
    function delta(a, b) { const parts = []; const d = (k, f, unit, inv) => { const x = b[k] - a[k]; if (Math.abs(x) >= (k === 't100' ? 0.05 : k === 'grip' ? 0.005 : 0.5)) parts.push('<em class="' + ((x < 0) === !!inv ? 'up' : 'down') + '">' + (x > 0 ? '+' : '') + (k === 't100' ? x.toFixed(1) : k === 'grip' ? x.toFixed(2) : Math.round(x)) + unit + '</em>'); }; d('hp', 0, ' hp'); d('kg', 0, ' kg', true); d('t100', 0, ' s 0-100', true); d('stop', 0, ' m braking', true); d('grip', 0, ' g grip'); d('topKmh', 0, ' km/h top'); d('rDrift', 0, ' drift stab.'); return parts.join(' ') || '<em>no change</em>'; }

    function renderGarage() {
      const s = save(), G = U.garage; if (!G.carId || !V.carById(G.carId)) G.carId = s.selected;
      const car = V.carById(G.carId), owned = s.owned[car.id], build = owned || V.defaultBuild(), an = V.analyze(car, build);
      let list = '<div class="carlist" role="listbox" aria-label="Cars">';
      V.CARS.forEach(c => { const own = !!s.owned[c.id], open = Progress.carUnlocked(s, c);
        list += '<button class="carrow' + (c.id === car.id ? ' on' : '') + '" role="option" aria-selected="' + (c.id === car.id) + '" data-act="gcar" data-id="' + c.id + '"><b>' + esc(c.name) + '</b><span>' + esc(c.cls) + ' &middot; ' + c.drive + '</span><small>' + (s.selected === c.id ? 'DRIVING' : own ? 'OWNED' : open ? num(c.price) + ' CR' : 'LOCKED') + '</small></button>'; });
      list += '</div>';
      let mid = '<div class="preview"><canvas id="gcar" width="640" height="260" aria-label="' + esc(car.name) + ' side view"></canvas><div class="pname"><h3>' + esc(car.name) + '</h3><span>' + esc(car.cls) + ' &middot; ' + car.drive + '</span></div><p class="blurb">' + esc(car.blurb) + '</p></div>';
      let right;
      if (!owned) {
        const open = Progress.carUnlocked(s, car), can = open && s.credits >= car.price, why = !open ? 'Unlock ' + TD.Tracks.COURSES[car.unlock.region - 1].name + ' in Career first.' : s.credits < car.price ? 'You need ' + num(car.price - s.credits) + ' more credits.' : '';
        right = '<div class="panel2"><h4>Stock specification</h4>' + statsHTML(an) + '<button class="btn primary" data-act="buycar" data-id="' + car.id + '"' + (can ? '' : ' disabled') + '>Buy for ' + num(car.price) + ' CR</button>' + (why ? '<p class="note">' + why + '</p>' : '') + '</div>';
      } else {
        const tabs = ['upgrades', 'tuning', 'style'].map(t => '<button class="tab' + (G.tab === t ? ' on' : '') + '" data-act="gtab" data-t="' + t + '">' + { upgrades: 'Upgrades', tuning: 'Tuning', style: 'Style' }[t] + '</button>').join('');
        let body = '';
        const upg = (kind, label, hint) => { const st = build[kind], next = st + 1, names = V.STAGE_NAMES[kind]; let row = '<div class="upg"><div><b>' + label + '</b><small>' + names[st] + (hint ? ' &middot; ' + hint : '') + '</small></div>';
          if (st >= 3) row += '<span class="maxed">MAX</span>'; else { const cost = V.upgradeCost(car, kind, next), pv = V.analyze(car, Object.assign({}, build, { [kind]: next })); row += '<div class="buy"><small>' + names[next] + ': ' + delta(an, pv) + '</small><button class="btn small primary" data-act="buyup" data-k="' + kind + '" data-n="' + next + '"' + (s.credits >= cost ? '' : ' disabled') + '>' + num(cost) + ' CR</button></div>'; }
          return row + '</div>'; };
        if (G.tab === 'upgrades') {
          body += upg('engine', 'Engine', 'power & top speed') + upg('susp', 'Suspension', 'sharper tyre response') + upg('weight', 'Weight reduction', 'mass');
          body += '<div class="upg col"><div><b>Tyres</b><small>' + V.COMPOUNDS[build.tires].name + ' fitted</small></div><div class="compounds">' + V.COMPOUNDS.map((c, i) => { const have = i <= 1 || (build.tiresOwned || []).includes(i), cost = have ? 0 : V.upgradeCost(car, 'tires', i), pv = V.analyze(car, Object.assign({}, build, { tires: i }));
            return '<button class="comp' + (build.tires === i ? ' on' : '') + '" data-act="tire" data-n="' + i + '"' + (build.tires !== i && !have && s.credits < cost ? ' disabled' : '') + '><b>' + c.name + '</b><small>' + esc(c.blurb) + '</small><span>' + (build.tires === i ? 'FITTED' : have ? 'FIT (owned)' : num(cost) + ' CR') + '</span>' + (build.tires === i ? '' : '<small>' + delta(an, pv) + '</small>') + '</button>'; }).join('') + '</div></div>';
        } else if (G.tab === 'tuning') {
          if (!build.diffKit) { const cost = V.upgradeCost(car, 'diffKit'); body += '<div class="upg col"><div><b>Limited-slip differential</b><small>Adds an adjustable lock. More lock holds a power slide longer and gives more rear traction under throttle (AWD: sends more torque rearward).</small></div><button class="btn primary" data-act="buyup" data-k="diffKit" data-n="1"' + (s.credits >= cost ? '' : ' disabled') + '>Install kit &middot; ' + num(cost) + ' CR</button></div>'; }
          else body += '<div class="upg col"><div><b>Differential lock</b><small>' + Math.round(build.diffLock * 100) + '%  (open &larr; &rarr; locked)</small></div><input type="range" min="0" max="100" value="' + Math.round(build.diffLock * 100) + '" data-act="diff" aria-label="Differential lock"></div>';
          body += '<p class="note">Base differential: ' + Math.round(car.diff * 100) + '% lock. Tuning changes how the car behaves on the road, not just the numbers.</p>';
        } else {
          body += '<div class="upg col"><div><b>Paint</b></div><div class="swatches">' + V.PAINTS.map((c, i) => '<button class="sw' + (build.paint === i ? ' on' : '') + '" style="background:' + c + '" data-act="paint" data-n="' + i + '" aria-label="Paint ' + (i + 1) + '"></button>').join('') + '</div></div>';
          body += '<div class="upg col"><div><b>Wheels</b></div><div class="seg">' + V.WHEELS.map((w, i) => '<button class="tab' + (build.wheel === i ? ' on' : '') + '" data-act="wheel" data-n="' + i + '">' + w.name + '</button>').join('') + '</div><div class="swatches">' + V.WHEEL_COLORS.map((c, i) => '<button class="sw' + (build.wheelColor === i ? ' on' : '') + '" style="background:' + c + '" data-act="wcolor" data-n="' + i + '" aria-label="Wheel colour ' + (i + 1) + '"></button>').join('') + '</div></div>';
        }
        right = '<div class="panel2"><div class="tabs">' + tabs + '</div>' + body + '<h4>Performance</h4>' + statsHTML(an) + (s.selected === car.id ? '' : '<button class="btn primary" data-act="select" data-id="' + car.id + '">Drive this car</button>') + '</div>';
      }
      render(top('Garage', true) + '<div class="body garage">' + list + '<div class="mid">' + mid + '</div>' + right + '</div>', 'garage');
      drawGarageCar(car, build);
    }
    function drawGarageCar(car, build) {
      const cv = document.getElementById('gcar'); if (!cv) return; const g = cv.getContext('2d'), dpr = Math.min(globalThis.devicePixelRatio || 1, 2), w = cv.clientWidth || 640, h = cv.clientHeight || 260;
      cv.width = w * dpr; cv.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#15161c'); bg.addColorStop(1, '#0a0b0e'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(242,165,58,0.07)'; g.fillRect(0, h * 0.76, w, h * 0.24); g.strokeStyle = 'rgba(242,165,58,0.35)'; g.beginPath(); g.moveTo(0, h * 0.76); g.lineTo(w, h * 0.76); g.stroke();
      const px = Math.min(w / (car.len + 1.4), h / 2.6); g.save(); g.translate(w / 2, h * 0.76); TD.Render.drawCarSide(g, car, V.paintOf(build), V.WHEELS[build.wheel].id, V.WHEEL_COLORS[build.wheelColor], px); g.restore();
    }

    /* ---------- settings ---------- */
    function renderSettings() {
      const st = app.settings, rm = app.reducedMotion;
      const sel = (act, opts, cur) => '<select data-act="' + act + '">' + opts.map((o, i) => '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
      render(top('Settings', true, '<span></span>') + '<div class="body settings"><div class="grp"><h4>Audio</h4>' +
        '<div class="setrow"><label for="s-vol">Volume</label><input id="s-vol" type="range" min="0" max="100" value="' + Math.round(st.volume * 100) + '" data-act="vol"><output>' + Math.round(st.volume * 100) + '%</output></div>' +
        '<div class="setrow"><label>Sound</label><button class="btn small" data-act="mute">' + (st.muted ? 'Muted' : 'On') + '</button></div>' + (app.startMuted ? '<p class="note">Muted at start by your Library preference. Press Sound to turn it on.</p>' : '') + '</div>' +
        '<div class="grp"><h4>Driving</h4><div class="setrow"><label>Driving assist</label>' + sel('assist', api.ASSIST_NAMES, st.assist) + '</div><p class="note">Countersteer and throttle help while the car is sliding. Off = raw physics (hard on a keyboard).</p>' +
        '<div class="setrow"><label>Camera</label>' + sel('camera', api.CAMERAS, st.camera) + '</div><div class="setrow"><label for="s-zoom">Zoom</label><input id="s-zoom" type="range" min="60" max="180" value="' + Math.round(st.zoom * 100) + '" data-act="zoom"><output>' + Math.round(st.zoom * 100) + '%</output></div>' +
        '<div class="setrow"><label>Speed units</label>' + sel('units', ['km/h', 'mph'], st.units === 'mph' ? 1 : 0) + '</div></div>' +
        '<div class="grp"><h4>Effects</h4><div class="setrow"><label>Particles &amp; detail</label>' + sel('particles', ['High', 'Low'], st.particles === 'low' ? 1 : 0) + '</div><div class="setrow"><label>Camera shake</label><button class="btn small" data-act="shake"' + (rm ? ' disabled' : '') + '>' + (st.shake && !rm ? 'On' : 'Off') + '</button></div>' + (rm ? '<p class="note">Reduced motion is on (Library setting or your system), so shake and heavy effects are off.</p>' : '') + '</div>' +
        '<div class="grp"><h4>Save data</h4><p class="note">Stored in this browser (' + (TD.Store.ok ? 'local storage' : 'memory only: storage is blocked, progress will not survive closing the page') + '). Export a copy now and then, especially when playing from local files.</p><div class="btnrow"><button class="btn small" data-act="export">Export save</button><button class="btn small" data-act="import">Import save&hellip;</button><button class="btn small danger" data-act="reset">Reset all progress</button></div><input type="file" id="imp" accept="application/json,.json" hidden></div>' +
        '<div class="grp"><h4>Controls</h4><div class="keys">' + [['W / &uarr;', 'Accelerate'], ['S / &darr;', 'Brake / reverse'], ['A D / &larr; &rarr;', 'Steer'], ['Space', 'Handbrake'], ['Shift', 'Clutch kick'], ['R', 'Reset (+5 s)'], ['C', 'Change camera'], ['+ / -', 'Zoom'], ['M', 'Mute'], ['Esc', 'Pause']].map(k => '<kbd>' + k[0] + '</kbd><span>' + k[1] + '</span>').join('') + '</div></div></div>', 'settings');
    }

    /* ---------- results ---------- */
    function renderResults(d) {
      const res = d.res, out = d.out, run = d.run, tg = d.target, s = save(), c = TD.Tracks.COURSES.find(x => x.id === run.courseId);
      const dnf = !res.finished, mname = dnf ? 'DID NOT FINISH' : out.medal ? MEDAL[out.medal].toUpperCase() : 'FINISHED';
      let main = '';
      if (run.mode === 'drift') main = '<div class="big">' + num(res.driftScore) + '</div><span>drift points &middot; best chain ' + num(res.bestDrift) + ' &middot; max angle ' + Math.round(res.maxAngle * 57.3) + '&deg;</span>';
      else main = '<div class="big">' + (res.time != null ? fmtT(res.time) : '--') + '</div><span>' + (run.mode === 'rival' ? 'finished ' + res.place + ' of ' + res.field : 'time') + (res.penalty ? ' &middot; includes +' + res.penalty + ' s resets' : '') + '</span>';
      let tgt = ''; if (tg.kind !== 'rival') tgt = '<div class="targets">' + [3, 2, 1].map(m => '<div class="t ' + MCLS[m] + (out.medal === m ? ' hit' : '') + '"><b>' + MEDAL[m] + '</b><span>' + (tg.kind === 'time' ? '&le; ' + fmtT(tg.t[m]) : '&ge; ' + num(tg.t[m])) + '</span></div>').join('') + '</div>';
      else tgt = '<div class="targets">' + res.rivals.map(r => '<div class="t' + (r.human ? ' hit' : '') + '"><b>' + r.place + '. ' + esc(r.name) + '</b><span>' + (r.finished ? fmtT(r.time) : 'racing') + '</span></div>').join('') + '</div>';
      let extra = ''; if (out.newRecord.length) extra += '<p class="rec-new">NEW RECORD &middot; ' + out.newRecord.map(x => x === 'drift' ? 'best drift score' : 'best time').join(' + ') + '</p>';
      out.unlocks.forEach(u => { extra += '<p class="unlock">UNLOCKED &middot; ' + (u.type === 'region' ? 'Region: ' : 'Car available: ') + esc(u.name) + '</p>'; });
      const nextEv = run.eventId ? Progress.EVENTS()[Progress.EVENTS().findIndex(e => e.id === run.eventId) + 1] : null;
      render('<div class="res"><div class="medal ' + MCLS[dnf ? 0 : out.medal] + '"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42"/><path d="M50 22l8 17 19 2-14 13 4 19-17-10-17 10 4-19-14-13 19-2z"/></svg></div><h2>' + mname + '</h2><p class="where">' + esc(c.name) + ' &middot; ' + MODES[run.mode][0] + (run.eventId ? ' &middot; Career' : ' &middot; Free Play') + '</p>' + main + tgt + extra +
        '<div class="reward">' + (out.reward ? '+' + num(out.reward) + ' CR' : 'No reward') + '<small>' + num(s.credits) + ' CR total</small></div><div class="actions"><button class="btn primary" data-act="again" data-focus>Retry</button>' +
        (nextEv && out.medal ? '<button class="btn" data-act="nextev" data-id="' + nextEv.id + '">Next event</button>' : '') + '<button class="btn" data-act="garage-from">Garage</button><button class="btn" data-act="done">' + (run.eventId ? 'Back to events' : 'Menu') + '</button></div></div>', 'results');
    }

    /* ---------- actions ---------- */
    function startFree() { const F = U.free, c = TD.Tracks.COURSES.findIndex(x => x.id === F.course) + 1; const run = { mode: F.mode, courseId: F.course, eventId: null, rivals: F.mode === 'rival' ? Progress.rivalsFor({ region: c, boss: F.rivals > 1 }, F.rivals) : [] }; show('prerace', run, true); }
    function startEvent(id) { const ev = Progress.eventById(id); const run = { mode: ev.mode, courseId: ev.course, eventId: ev.id, rivals: ev.mode === 'rival' ? Progress.rivalsFor(ev) : [] }; show('prerace', run, true); }
    function refresh() { show(U.name, U.data); }
    async function doImport(file) {
      let obj; try { obj = JSON.parse(await file.text()); } catch (e) { toast('That file is not valid JSON.'); return; }
      if (!obj || obj.format !== 'touge-drift-save') { toast('That is not a Touge Drift save file.'); return; }
      if (!(await confirmBox('Import save?', 'This replaces your current progress with the file. A backup copy of the current save is kept in this browser.', 'Import'))) return;
      const r = api.importSave(obj); toast(r.ok ? 'Imported ' + r.count + ' items.' : r.error); Audio.play[r.ok ? 'buy' : 'deny'](); if (r.ok) { api.startDemo('pine-ridge'); show('title'); U.stack = []; } else refresh();
    }
    function download() {
      const data = api.exportSave(), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = 'touge-drift-save-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Save exported.');
    }

    const ACT = {
      back, career() { Audio.play.click(); show('career', null, true); }, free() { Audio.play.click(); show('free', null, true); }, garage() { Audio.play.click(); U.garage.carId = save().selected; show('garage', null, true); },
      records() { Audio.play.click(); show('records', null, true); }, settings() { Audio.play.click(); show('settings', null, true); }, 'settings-pause'() { Audio.play.click(); show('settings', null, true); },
      region(el) { Audio.play.click(); show('region', +el.dataset.i, true); }, event(el) { Audio.play.click(); startEvent(el.dataset.id); },
      fmode(el) { U.free.mode = el.dataset.m; Audio.play.click(); refresh(); }, fcourse(el) { U.free.course = el.dataset.id; Audio.play.click(); refresh(); }, frivals(el) { U.free.rivals = +el.dataset.n; Audio.play.click(); refresh(); }, fgo: startFree,
      go() { Audio.play.click(); U.stack = []; api.startRun(U.data); }, ghost(el) { U.data.ghost = el.checked; },
      'garage-from'() { Audio.play.click(); U.garage.carId = save().selected; show('garage', null, true); },
      gcar(el) { U.garage.carId = el.dataset.id; Audio.play.click(); refresh(); }, gtab(el) { U.garage.tab = el.dataset.t; Audio.play.click(); refresh(); },
      buycar(el) { const r = Progress.buyCar(save(), el.dataset.id); if (r.ok) { Audio.play.buy(); api.saveNow(); toast('Bought ' + carName(el.dataset.id) + '.'); } else { Audio.play.deny(); toast(r.error); } refresh(); },
      select(el) { Progress.select(save(), el.dataset.id); api.saveNow(); Audio.play.click(); toast(carName(el.dataset.id) + ' selected.'); refresh(); },
      buyup(el) { const r = Progress.buyUpgrade(save(), U.garage.carId, el.dataset.k, +el.dataset.n); if (r.ok) { Audio.play.buy(); api.saveNow(); } else { Audio.play.deny(); toast(r.error); } refresh(); },
      tire(el) { const r = Progress.buyUpgrade(save(), U.garage.carId, 'tires', +el.dataset.n); if (r.ok) { r.cost ? Audio.play.buy() : Audio.play.click(); api.saveNow(); } else { Audio.play.deny(); toast(r.error); } refresh(); },
      paint(el) { Progress.setCosmetic(save(), U.garage.carId, 'paint', +el.dataset.n); api.saveNow(); Audio.play.click(); refresh(); }, wheel(el) { Progress.setCosmetic(save(), U.garage.carId, 'wheel', +el.dataset.n); api.saveNow(); Audio.play.click(); refresh(); }, wcolor(el) { Progress.setCosmetic(save(), U.garage.carId, 'wheelColor', +el.dataset.n); api.saveNow(); Audio.play.click(); refresh(); },
      resume() { api.resume(); }, restart() { api.restartRun(); }, mute() { api.setMuted(!app.settings.muted); Audio.play.click(); refresh(); }, cam() { app.settings.camera = (app.settings.camera + 1) % 3; api.applySettings(); refresh(); },
      async quit() { if (await confirmBox('Quit to menu?', 'This run will not be saved.', 'Quit')) { U.stack = []; api.leaveRun('title'); } },
      again() { Audio.play.click(); api.restartRun(); },
      nextev(el) { Audio.play.click(); const ev = Progress.eventById(el.dataset.id); U.stack = []; api.leaveRun('career'); show('region', ev.region, true); startEvent(ev.id); },
      done() { Audio.play.click(); const r = U.data && U.data.run; U.stack = []; if (r && r.eventId) { api.leaveRun('career'); show('region', Progress.eventById(r.eventId).region, true); } else api.leaveRun('title'); },
      export: download, import() { document.getElementById('imp').click(); },
      async reset() { if (await confirmBox('Reset all progress?', 'Credits, cars, upgrades, medals, records and ghosts are erased from this browser. Export a save first if you might want it back.', 'Erase everything')) { api.resetSave(); Audio.play.deny(); toast('Progress reset.'); refresh(); } },
      shake() { app.settings.shake = !app.settings.shake; api.applySettings(); refresh(); },
    };
    root.addEventListener('click', e => {
      const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const act = el.dataset.act;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
      if (act === 'library') {                                                       // the anchor on the title screen navigates itself; in a run (or from a button) ask first
        if (el.tagName === 'A' && !api.inRace()) { Audio.play.click(); return; }
        e.preventDefault(); if (!api.inRace()) { app.leaving = true; location.href = '../../index.html'; return; }
        confirmBox('Back to the Library?', 'Your current run will be lost.', 'Leave').then(ok => { if (ok) { app.leaving = true; location.href = '../../index.html'; } }); return; }
      if (ACT[act]) { api.unlockAudio(); ACT[act](el, e); }
    });
    root.addEventListener('input', e => {
      const el = e.target.closest('[data-act]'); if (!el) return; const v = +el.value, a = el.dataset.act;
      if (a === 'vol') { app.settings.volume = v / 100; api.applySettings(); el.nextElementSibling.textContent = v + '%'; }
      else if (a === 'zoom') { app.settings.zoom = v / 100; api.applySettings(); el.nextElementSibling.textContent = v + '%'; }
      else if (a === 'diff') { Progress.setDiff(save(), U.garage.carId, v / 100); el.parentElement.querySelector('small').innerHTML = v + '%  (open &larr; &rarr; locked)'; }
    });
    root.addEventListener('change', e => {
      const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act;
      if (a === 'assist') { app.settings.assist = +el.value; api.applySettings(); } else if (a === 'camera') { app.settings.camera = +el.value; api.applySettings(); }
      else if (a === 'units') { app.settings.units = +el.value ? 'mph' : 'kmh'; api.applySettings(); } else if (a === 'particles') { app.settings.particles = +el.value ? 'low' : 'high'; api.applySettings(); }
      else if (a === 'ghost') { U.data.ghost = el.checked; } else if (a === 'diff') { api.saveNow(); refresh(); }
      else if (e.target.id === 'imp' && e.target.files[0]) { doImport(e.target.files[0]); e.target.value = ''; }
    });
    root.addEventListener('change', e => { if (e.target.id === 'imp' && e.target.files[0]) { doImport(e.target.files[0]); e.target.value = ''; } });

    U.show = show; U.toast = toast;
    U.key = function (e) {
      if (e.code === 'Escape' || e.code === 'Backspace') { if (U.name && U.name !== 'title' && U.name !== 'results') { e.preventDefault(); back(); } }
    };
    return U;
  }
  TD.UI = { create };
})();
