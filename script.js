(function(){

  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  document.addEventListener('selectstart', function(e){ e.preventDefault(); });
  document.addEventListener('dragstart', function(e){ e.preventDefault(); });
  document.addEventListener('gesturestart', function(e){ e.preventDefault(); });

  document.addEventListener('keydown', function(e){
    var k = e.key;
    var blockCombo = (e.ctrlKey || e.metaKey) && ['u','s','c'].indexOf(k.toLowerCase()) !== -1;
    var blockDevtools = k === 'F12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I','J','C','i','j','c'].indexOf(k) !== -1);
    if (blockCombo || blockDevtools){
      e.preventDefault();
    }
  });

  var ctx = null;
  var masterGain = null;
  var masterCompressor = null;
  var clickGain = null;
  var noiseBuffer = null;

  function ensureAudio(){
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterCompressor = ctx.createDynamicsCompressor();
    masterCompressor.threshold.value = -10;
    masterCompressor.ratio.value = 4;
    masterCompressor.connect(ctx.destination);

    masterGain = ctx.createGain();
    masterGain.gain.value = parseInt(volumeSlider.value, 10) / 100;
    masterGain.connect(masterCompressor);

    clickGain = ctx.createGain();
    clickGain.gain.value = 0.5;
    clickGain.connect(ctx.destination);

    var len = Math.floor(ctx.sampleRate * 0.05);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < len; i++){
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
  }

  function playClick(){
    if (!ctx) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    filter.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
    src.connect(filter);
    filter.connect(g);
    g.connect(clickGain);
    src.start();
    src.stop(ctx.currentTime + 0.05);
  }

  function makeChain(gainTarget, filterFreq, filterQ){
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq || 2000;
    filter.Q.value = filterQ || 2.2;
    var gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(gainTarget, ctx.currentTime + 0.06);
    filter.connect(gainNode);
    gainNode.connect(masterGain);
    return { filter: filter, gainNode: gainNode };
  }

  function fadeOutAndStop(gainNode, oscillators, delay){
    var t = ctx.currentTime + (delay || 0);
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(gainNode.gain.value, t);
    gainNode.gain.linearRampToValueAtTime(0.0001, t + 0.15);
    oscillators.forEach(function(o){
      try { o.stop(t + 0.2); } catch(e){}
    });
  }

  function createSweep(opts){
    var osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.value = opts.low;
    var chain = makeChain(opts.gain, opts.filterFreq, opts.filterQ);
    osc.connect(chain.filter);
    osc.start();

    function cycle(){
      var now = ctx.currentTime;
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(opts.high, now + opts.half);
      osc.frequency.linearRampToValueAtTime(opts.low, now + opts.half * 2);
    }
    cycle();
    var intervalId = setInterval(cycle, opts.half * 2 * 1000);

    return {
      stop: function(){
        clearInterval(intervalId);
        fadeOutAndStop(chain.gainNode, [osc]);
      }
    };
  }

  function createDualSweep(opts){
    var a = createSweep({ low: opts.low, high: opts.high, half: opts.halfA, type: opts.type, gain: opts.gain * 0.65, filterFreq: opts.filterFreq, filterQ: opts.filterQ });
    var b = createSweep({ low: opts.low + 40, high: opts.high + 40, half: opts.halfB, type: opts.type, gain: opts.gain * 0.65, filterFreq: opts.filterFreq, filterQ: opts.filterQ });
    return {
      stop: function(){ a.stop(); b.stop(); }
    };
  }

  function createHiLo(opts){
    var osc = ctx.createOscillator();
    osc.type = opts.type || 'square';
    osc.frequency.value = opts.freqA;
    var chain = makeChain(opts.gain, opts.filterFreq, opts.filterQ);
    osc.connect(chain.filter);
    osc.start();

    var flag = true;
    function tick(){
      var target = flag ? opts.freqA : opts.freqB;
      osc.frequency.setTargetAtTime(target, ctx.currentTime, 0.01);
      flag = !flag;
    }
    tick();
    var intervalId = setInterval(tick, opts.step * 1000);

    return {
      stop: function(){
        clearInterval(intervalId);
        fadeOutAndStop(chain.gainNode, [osc]);
      }
    };
  }

  function createAirhorn(opts){
    var osc1 = ctx.createOscillator();
    osc1.type = opts.type || 'sawtooth';
    osc1.frequency.value = opts.f1;
    var osc2 = ctx.createOscillator();
    osc2.type = opts.type || 'sawtooth';
    osc2.frequency.value = opts.f2;

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = opts.lowpass || 1500;

    var gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(opts.gain, ctx.currentTime + 0.04);

    var lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = opts.gain * 0.08;
    lfo.connect(lfoGain);
    lfoGain.connect(gainNode.gain);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(masterGain);

    osc1.start();
    osc2.start();
    lfo.start();

    return {
      stop: function(){
        fadeOutAndStop(gainNode, [osc1, osc2, lfo]);
      }
    };
  }

  function createMechanicalSiren(opts){
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = opts.start;

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;

    var gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(opts.gain, ctx.currentTime + 0.3);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(masterGain);
    osc.start();

    var spinUpTime = opts.spinUp || 3;
    osc.frequency.setValueAtTime(opts.start, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(opts.low, ctx.currentTime + spinUpTime);

    var intervalId = null;
    var spinUpTimeout = setTimeout(function(){
      function cycle(){
        var now = ctx.currentTime;
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.linearRampToValueAtTime(opts.high, now + opts.half);
        osc.frequency.linearRampToValueAtTime(opts.low, now + opts.half * 2);
      }
      cycle();
      intervalId = setInterval(cycle, opts.half * 2 * 1000);
    }, spinUpTime * 1000);

    return {
      stop: function(){
        clearTimeout(spinUpTimeout);
        if (intervalId) clearInterval(intervalId);
        var now = ctx.currentTime;
        var spinDown = opts.spinDown || 2;
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(osc.frequency.value, now);
        osc.frequency.linearRampToValueAtTime(opts.start, now + spinDown);
        gainNode.gain.cancelScheduledValues(now + spinDown);
        gainNode.gain.setValueAtTime(opts.gain, now + spinDown - 0.2);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + spinDown + 0.2);
        try { osc.stop(now + spinDown + 0.3); } catch(e){}
      }
    };
  }

  var FACTORIES = {
    'pol-wail': function(){ return createSweep({ low:650, high:1350, half:2.0, type:'sine', gain:0.55, filterFreq:1900, filterQ:3.5 }); },
    'pol-yelp': function(){ return createSweep({ low:650, high:1350, half:0.32, type:'sine', gain:0.55, filterFreq:1900, filterQ:3.5 }); },
    'pol-priority': function(){ return createDualSweep({ low:800, high:1600, halfA:0.24, halfB:0.31, type:'triangle', gain:0.55, filterFreq:2000, filterQ:3 }); },
    'pol-hilo': function(){ return createHiLo({ freqA:620, freqB:900, step:0.5, type:'square', gain:0.4, filterFreq:1700, filterQ:4 }); },
    'pol-airhorn': function(){ return createAirhorn({ f1:370, f2:311, gain:0.5, lowpass:1300 }); },

    'fire-q2b': function(){ return createMechanicalSiren({ start:90, low:300, high:540, half:3, spinUp:3, spinDown:2.2, gain:0.55 }); },
    'fire-wail': function(){ return createSweep({ low:500, high:1100, half:2.4, type:'triangle', gain:0.55, filterFreq:1600, filterQ:3 }); },
    'fire-airhorn': function(){ return createAirhorn({ f1:233, f2:196, gain:0.55, lowpass:1100 }); },

    'ems-wail': function(){ return createSweep({ low:600, high:1300, half:1.8, type:'sine', gain:0.55, filterFreq:1900, filterQ:3.5 }); },
    'ems-yelp': function(){ return createSweep({ low:600, high:1300, half:0.3, type:'sine', gain:0.55, filterFreq:1900, filterQ:3.5 }); },
    'ems-howler': function(){ return createSweep({ low:900, high:1700, half:0.18, type:'triangle', gain:0.5, filterFreq:2300, filterQ:5 }); },
    'ems-hilo': function(){ return createHiLo({ freqA:700, freqB:1000, step:0.42, type:'square', gain:0.4, filterFreq:1800, filterQ:4 }); },

    'multi-convoy': function(){
      var a = createSweep({ low:650, high:1350, half:2.0, type:'sine', gain:0.35, filterFreq:1900, filterQ:3.5 });
      var b = createMechanicalSiren({ start:90, low:300, high:540, half:3, spinUp:2, spinDown:2, gain:0.35 });
      var c = createSweep({ low:600, high:1300, half:0.3, type:'sine', gain:0.35, filterFreq:1900, filterQ:3.5 });
      return { stop: function(){ a.stop(); b.stop(); c.stop(); } };
    },
    'multi-code3': function(){
      var a = createAirhorn({ f1:370, f2:311, gain:0.4, lowpass:1300 });
      var b = createHiLo({ freqA:620, freqB:900, step:0.5, type:'square', gain:0.35, filterFreq:1700, filterQ:4 });
      return { stop: function(){ a.stop(); b.stop(); } };
    }
  };

  function getDepts(key){
    if (key === 'multi-convoy') return ['police', 'fire', 'ems'];
    if (key === 'multi-code3') return ['police', 'fire'];
    if (key.indexOf('pol-') === 0) return ['police'];
    if (key.indexOf('fire-') === 0) return ['fire'];
    if (key.indexOf('ems-') === 0) return ['ems'];
    return [];
  }

  var activeSounds = {};
  var deptCounts = { police: 0, fire: 0, ems: 0 };

  var lightbar = document.getElementById('lightbar');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var activeCountEl = document.getElementById('activeCount');
  var volumeSlider = document.getElementById('volume');
  var volumeValue = document.getElementById('volumeValue');
  var stopAllBtn = document.getElementById('stopAll');
  var clockEl = document.getElementById('clock');

  lightbar.classList.add('idle');

  function refreshLightbar(){
    ['police', 'fire', 'ems'].forEach(function(d){
      lightbar.classList.toggle(d, deptCounts[d] > 0);
    });
    var anyActive = deptCounts.police > 0 || deptCounts.fire > 0 || deptCounts.ems > 0;
    lightbar.classList.toggle('idle', !anyActive);
    statusDot.classList.toggle('live', anyActive);
    var n = Object.keys(activeSounds).length;
    activeCountEl.textContent = String(n);
    statusText.textContent = anyActive ? ('EN SERVICIO — ' + n + ' UNIDAD' + (n === 1 ? '' : 'ES')) : 'SISTEMA EN ESPERA';
  }

  function setButtonActive(btn, isActive){
    btn.classList.toggle('active', isActive);
  }

  function toggleSound(btn){
    var key = btn.getAttribute('data-sound');
    var factory = FACTORIES[key];
    if (!factory) return;

    if (activeSounds[key]){
      activeSounds[key].stop();
      delete activeSounds[key];
      setButtonActive(btn, false);
      getDepts(key).forEach(function(d){ deptCounts[d] = Math.max(0, deptCounts[d] - 1); });
      refreshLightbar();
      return;
    }

    ensureAudio();
    var controller = factory();
    activeSounds[key] = controller;
    setButtonActive(btn, true);
    getDepts(key).forEach(function(d){ deptCounts[d] += 1; });
    refreshLightbar();
  }

  function stopAll(){
    Object.keys(activeSounds).forEach(function(key){
      activeSounds[key].stop();
      delete activeSounds[key];
    });
    deptCounts = { police: 0, fire: 0, ems: 0 };
    document.querySelectorAll('.siren-btn.active').forEach(function(btn){
      setButtonActive(btn, false);
    });
    refreshLightbar();
  }

  document.querySelectorAll('.siren-btn').forEach(function(btn){
    btn.addEventListener('pointerdown', function(){
      ensureAudio();
      playClick();
    });
    btn.addEventListener('click', function(){
      toggleSound(btn);
    });
    btn.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  });

  stopAllBtn.addEventListener('pointerdown', function(){
    ensureAudio();
    playClick();
  });
  stopAllBtn.addEventListener('click', stopAll);

  volumeSlider.addEventListener('input', function(){
    var v = parseInt(volumeSlider.value, 10);
    volumeValue.textContent = v + '%';
    if (masterGain){
      masterGain.gain.setTargetAtTime(v / 100, ctx.currentTime, 0.05);
    }
  });

  function updateClock(){
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = hh + ':' + mm + ':' + ss;
  }
  updateClock();
  setInterval(updateClock, 1000);

})();
