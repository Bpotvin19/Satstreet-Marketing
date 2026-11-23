// Cursor trail for the client terminal: a soft trail of blue smoke behind the page content, adapted from
// benterminal.netlify.app and toned down (shorter, thinner, fainter). Desktop mouse only; off for reduced
// motion and when the visitor turns Motion off in the Theme menu (html[data-motion="off"]). Sleeps when the mouse is still.
(function () {
  var landingClouds = false;
  // Clouds on the landing sky also run on touch screens (they drift on their own); the trail elsewhere is mouse-only.
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches || (!landingClouds && !matchMedia('(pointer:fine)').matches)) return;
  var cv = document.createElement('canvas');
  cv.className = 'ss-trail'; cv.setAttribute('aria-hidden', 'true');
  // On the landing page the canvas lives inside the landing section, between the sky and the foreground cut-out
  var landingEl = landingClouds && document.querySelector('.landing');
  if (landingEl) landingEl.prepend(cv); else document.body.prepend(cv);
  var gl = cv.getContext('webgl2', { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) { cv.remove(); return; }
  gl.getExtension('OES_texture_float_linear');

  var C = { SIM: 112, DYE: 512, DENSITY: 2.6, VELOCITY: 0.6, PRESSURE: 0.8, ITER: 16, CURL: 10, RADIUS: 0.11, FORCE: 2400 };
  // Clouds: slow, lingering, broad, barely swirling, carried by a light wind.
  if (landingClouds) C = { SIM: 112, DYE: 512, DENSITY: 0.07, VELOCITY: 0.9, PRESSURE: 0.8, ITER: 16, CURL: 4, RADIUS: 0.9, FORCE: 1500 };
  var WIND = [0.006, 0.0006]; // gentle drift to the right, in screen fractions per second
  var PAL = (landingClouds
    ? ['#dce8f1', '#bdd6ec', '#edf2f5', '#91b9df', '#d6e5f1', '#b5cde5', '#e4edf4']
    : ['#0e3b85', '#1f6fff', '#6cc2ff', '#c2e6ff', '#3d6cf0', '#123f99', '#3fd6ff']).map(function (h) {
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  });

  var VS = '#version 300 es\nprecision highp float;in vec2 aPosition;out vec2 vUv,vL,vR,vT,vB;uniform vec2 texelSize;void main(){vUv=aPosition*.5+.5;vL=vUv-vec2(texelSize.x,0.);vR=vUv+vec2(texelSize.x,0.);vT=vUv+vec2(0.,texelSize.y);vB=vUv-vec2(0.,texelSize.y);gl_Position=vec4(aPosition,0.,1.);}';
  var H = '#version 300 es\nprecision highp float;precision highp sampler2D;in vec2 vUv,vL,vR,vT,vB;out vec4 o;';
  var FS = {
    splat: 'uniform sampler2D uTarget;uniform float aspectRatio,radius;uniform vec3 color;uniform vec2 point;void main(){vec2 p=vUv-point;p.x*=aspectRatio;o=vec4(texture(uTarget,vUv).xyz+exp(-dot(p,p)/radius)*color,1.);}',
    advect: 'uniform sampler2D uVelocity,uSource;uniform vec2 texelSize,wind;uniform float dt,dissipation;void main(){vec2 c=vUv-dt*(texture(uVelocity,vUv).xy*texelSize+wind);o=texture(uSource,c)/(1.+dissipation*dt);}',
    divergence: 'uniform sampler2D uVelocity;void main(){float L=texture(uVelocity,vL).x,R=texture(uVelocity,vR).x,T=texture(uVelocity,vT).y,B=texture(uVelocity,vB).y;vec2 C=texture(uVelocity,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;o=vec4(.5*(R-L+T-B),0.,0.,1.);}',
    curl: 'uniform sampler2D uVelocity;void main(){float L=texture(uVelocity,vL).y,R=texture(uVelocity,vR).y,T=texture(uVelocity,vT).x,B=texture(uVelocity,vB).x;o=vec4(.5*(R-L-T+B),0.,0.,1.);}',
    vorticity: 'uniform sampler2D uVelocity,uCurl;uniform float curl,dt;void main(){float L=texture(uCurl,vL).x,R=texture(uCurl,vR).x,T=texture(uCurl,vT).x,B=texture(uCurl,vB).x,C=texture(uCurl,vUv).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+.0001;f*=curl*C;f.y*=-1.;vec2 v=texture(uVelocity,vUv).xy+f*dt;o=vec4(clamp(v,-1000.,1000.),0.,1.);}',
    pressure: 'uniform sampler2D uPressure,uDivergence;void main(){float L=texture(uPressure,vL).x,R=texture(uPressure,vR).x,T=texture(uPressure,vT).x,B=texture(uPressure,vB).x,d=texture(uDivergence,vUv).x;o=vec4((L+R+B+T-d)*.25,0.,0.,1.);}',
    gradient: 'uniform sampler2D uPressure,uVelocity;void main(){float L=texture(uPressure,vL).x,R=texture(uPressure,vR).x,T=texture(uPressure,vT).x,B=texture(uPressure,vB).x;vec2 v=texture(uVelocity,vUv).xy-vec2(R-L,T-B);o=vec4(v,0.,1.);}',
    clear: 'uniform sampler2D uTexture;uniform float value;void main(){o=value*texture(uTexture,vUv);}',
    display: 'uniform sampler2D uTexture;void main(){vec3 c=texture(uTexture,vUv).rgb;float a=clamp(max(c.r,max(c.g,c.b)),0.,1.);o=vec4(min(c,vec3(a)),a);}',
    // Cloud shading: density becomes billowy coverage (noise-eroded edges), lit from the moon at the upper left,
    // darker cooler undersides, hazier toward the horizon. Output is premultiplied for normal alpha blending.
    clouds: 'uniform sampler2D uTexture;uniform float time,aspect;uniform vec2 texelSize;'
      + 'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}'
      + 'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}'
      + 'float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<5;k++){v+=a*n(p);p=p*2.03+vec2(7.1,3.7);a*=.5;}return v;}'
      + 'float D(vec2 u){return texture(uTexture,u).r;}'
      + 'void main(){vec2 q=vec2(vUv.x*aspect,vUv.y);float d=D(vUv);'
      + 'vec2 w=q+.06*vec2(fbm(q*3.+time*.01),fbm(q*3.+4.2));float detail=fbm(w*6.+vec2(time*.012,0.));detail=detail*.8+fbm(w*15.-vec2(time*.02,0.))*.35;'
      + 'float cov=smoothstep(.04,.7,d*(.2+1.25*detail));if(cov<.002){o=vec4(0.);return;}'
      + 'vec2 sun=vec2(-.7,.75)*texelSize*22.;float s=D(vUv+sun)+.5*D(vUv+2.*sun);'
      + 'float lit=clamp(1.-(s-d*1.25)*1.1,0.,1.);float edge=1.-smoothstep(.05,.5,d);'
      + 'vec3 shade=vec3(.40,.47,.60),top=vec3(.80,.86,.95),rimc=vec3(.93,.96,1.);'
      + 'vec3 col=mix(shade,top,lit*(.75+.5*detail));col=mix(col,rimc,edge*lit*.25);'
      + 'float haze=mix(.55,1.,smoothstep(.15,.6,vUv.y));col=mix(vec3(.25,.33,.5),col,haze);'
      + 'float a=cov*.5*haze;o=vec4(col*a,a);}'
  };

  function shader(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var vs = shader(gl.VERTEX_SHADER, VS), P = {};
  for (var k in FS) {
    var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, H + FS[k]));
    gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { cv.remove(); return; }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    P[k] = { p: p, u: u };
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);

  function use(name) { var x = P[name]; gl.useProgram(x.p); return x.u; }
  function blit(t) {
    if (t) { gl.viewport(0, 0, t.w, t.h); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
  function fbo(w, h, ifmt, fmt) {
    gl.activeTexture(gl.TEXTURE0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, gl.HALF_FLOAT, null);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: tex, fbo: f, w: w, h: h, tx: 1 / w, ty: 1 / h, attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; } };
  }
  function dbl(w, h, ifmt, fmt) {
    var a = fbo(w, h, ifmt, fmt), b = fbo(w, h, ifmt, fmt);
    return { w: w, h: h, tx: 1 / w, ty: 1 / h, get read() { return a; }, get write() { return b; }, swap: function () { var t = a; a = b; b = t; } };
  }
  function res(r) {
    var ar = gl.drawingBufferWidth / gl.drawingBufferHeight; if (ar < 1) ar = 1 / ar;
    var mn = Math.round(r), mx = Math.round(r * ar);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? [mx, mn] : [mn, mx];
  }
  var vel, dye, div, curl, pres;
  function drop(x) { if (!x) return; [x.read || x, x.write].forEach(function (t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }); }
  function init() {
    [vel, dye, div, curl, pres].forEach(drop);
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    var s = res(C.SIM), d = res(C.DYE);
    vel = dbl(s[0], s[1], gl.RG16F, gl.RG); dye = dbl(d[0], d[1], gl.RGBA16F, gl.RGBA);
    div = fbo(s[0], s[1], gl.R16F, gl.RED); curl = fbo(s[0], s[1], gl.R16F, gl.RED); pres = dbl(s[0], s[1], gl.R16F, gl.RED);
  }
  init();
  var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(init, 150); });

  function splat(x, y, dx, dy, col) {
    var ar = cv.width / cv.height, u = use('splat');
    gl.uniform1i(u.uTarget, vel.read.attach(0)); gl.uniform1f(u.aspectRatio, ar);
    gl.uniform2f(u.point, x, y); gl.uniform3f(u.color, dx, dy, 0);
    gl.uniform1f(u.radius, (C.RADIUS / 100) * (ar > 1 ? ar : 1)); blit(vel.write); vel.swap();
    gl.uniform1i(u.uTarget, dye.read.attach(0)); gl.uniform3f(u.color, col[0], col[1], col[2]); blit(dye.write); dye.swap();
  }
  function colour(t) {
    if (landingClouds) return [.013, .013, .013]; // density only; the cloud shader does the colour
    var f = (t / 1400) % PAL.length, i = Math.floor(f), a = PAL[i], b = PAL[(i + 1) % PAL.length], m = f - i, k = 0.08;
    return [(a[0] + (b[0] - a[0]) * m) * k, (a[1] + (b[1] - a[1]) * m) * k, (a[2] + (b[2] - a[2]) * m) * k];
  }

  function step(dt) {
    var u;
    u = use('curl'); gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0)); blit(curl);
    u = use('vorticity'); gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0)); gl.uniform1i(u.uCurl, curl.attach(1));
    gl.uniform1f(u.curl, C.CURL); gl.uniform1f(u.dt, dt); blit(vel.write); vel.swap();
    u = use('divergence'); gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0)); blit(div);
    u = use('clear'); gl.uniform1i(u.uTexture, pres.read.attach(0)); gl.uniform1f(u.value, C.PRESSURE); blit(pres.write); pres.swap();
    u = use('pressure'); gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uDivergence, div.attach(0));
    for (var i = 0; i < C.ITER; i++) { gl.uniform1i(u.uPressure, pres.read.attach(1)); blit(pres.write); pres.swap(); }
    u = use('gradient'); gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uPressure, pres.read.attach(0)); gl.uniform1i(u.uVelocity, vel.read.attach(1)); blit(vel.write); vel.swap();
    u = use('advect'); gl.uniform2f(u.texelSize, vel.tx, vel.ty); var v = vel.read.attach(0);
    gl.uniform2f(u.wind, 0, 0); gl.uniform1i(u.uVelocity, v); gl.uniform1i(u.uSource, v); gl.uniform1f(u.dt, dt); gl.uniform1f(u.dissipation, C.VELOCITY); blit(vel.write); vel.swap();
    if (landingClouds) gl.uniform2f(u.wind, WIND[0], WIND[1]);
    gl.uniform1i(u.uVelocity, vel.read.attach(0)); gl.uniform1i(u.uSource, dye.read.attach(1)); gl.uniform1f(u.dissipation, C.DENSITY); blit(dye.write); dye.swap();
    if (landingClouds) { u = use('clouds'); gl.uniform1i(u.uTexture, dye.read.attach(0)); gl.uniform1f(u.time, performance.now() / 1000); gl.uniform1f(u.aspect, cv.width / cv.height); gl.uniform2f(u.texelSize, dye.tx, dye.ty); gl.clearColor(0, 0, 0, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT); blit(null); }
    else { u = use('display'); gl.uniform1i(u.uTexture, dye.read.attach(0)); blit(null); }
  }

  var px = null, py = null, moved = false, mx = 0, my = 0, last = 0, lastMove = 0, raf = 0;
  addEventListener('pointermove', function (e) {
    if (document.documentElement.getAttribute('data-motion') === 'off') return;
    if (e.pointerType && e.pointerType !== 'mouse' && !(landingClouds && e.buttons)) return;
    if (e.target && e.target.closest && e.target.closest('.chain-stage,.candle-stage')) return; // keep games clear
    mx = e.clientX; my = e.clientY; moved = true; lastMove = performance.now();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }, { passive: true });
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.0166); last = now;
    if (moved) {
      var x = mx / innerWidth, y = 1 - my / innerHeight;
      if (px !== null) {
        var dx = (x - px) * C.FORCE, dy = (y - py) * C.FORCE;
        if (dx || dy) { var col = colour(now); if (landingClouds) { var sp = Math.min(1, Math.hypot(x - px, y - py) * 40); col = [col[0] * (.5 + sp), col[1] * (.5 + sp), col[2] * (.5 + sp)]; } splat(x, y, dx * (cv.width / cv.height), dy, col); }
      }
      px = x; py = y; moved = false;
    }
    step(dt);
    if (landingClouds) ambient(now);
    // Sleep once the mouse has been still long enough for the smoke to fade (the landing sky keeps drifting)
    if (document.hidden || (!landingClouds && now - lastMove > 5000)) { raf = 0; px = null; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener('mouseleave', function () { px = null; });
  // Ambient sky: every few seconds a soft cloud bank forms somewhere in the sky and drifts with the wind.
  var nextPuff = 0, seeded = false;
  function puff(x, y, r, amt) {
    var save = C.RADIUS; C.RADIUS = r; splat(x, y, (WIND[0] * 60) * (cv.width / cv.height), 0, [amt, amt, amt]); C.RADIUS = save;
  }
  function skyTop() { // the sky is the part of the screen above the landscape horizon
    var l = document.querySelector('.landing-landscape'); if (!l) return .5; var b = l.getBoundingClientRect();
    return Math.max(.08, Math.min(.9, 1 - (b.top + b.height * .42) / innerHeight));
  }
  function ambient(now) {
    if (!seeded) { seeded = true; for (var i = 0; i < 7; i++) { var hy = skyTop(); puff(Math.random(), hy + Math.random() * (1 - hy) * .8, 1.2 + Math.random() * 1.6, .11 + Math.random() * .09); } nextPuff = now + 1500; }
    if (now < nextPuff) return; nextPuff = now + 2600 + Math.random() * 2600;
    var hy2 = skyTop(); puff(-0.02 + Math.random() * .35, hy2 + .03 + Math.random() * (1 - hy2) * .75, 1.2 + Math.random() * 1.8, .1 + Math.random() * .09);
  }
  if (landingClouds) {
    addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { mx = e.clientX; my = e.clientY; px = null; moved = true; lastMove = performance.now(); } }, { passive: true });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } });
    last = performance.now(); raf = requestAnimationFrame(frame);
  }
})();
