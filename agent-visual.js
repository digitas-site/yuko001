"use strict";
(() => {
  const canvas = $("agent-orb");
  const context = canvas.getContext("2d");
  const stage = $("agent-stage");
  const toggle = $("motion-toggle");
  if (!context) {
    toggle.hidden = true;
    return;
  }

  const turn = Math.PI * 2;
  const palettes = {
    idle:[86,220,255],
    starting:[130,229,255],
    listening:[146,255,243],
    processing:[220,187,255],
    success:[166,255,208],
    error:[255,193,167]
  };
  let seed = 3129;
  function random() {
    seed = (Math.imul(1664525,seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const particles = Array.from({length:620},() => {
    const latitude = Math.asin(random()*2-1);
    return {
      angle:random()*turn,
      height:Math.sin(latitude),
      radial:Math.cos(latitude),
      radius:71+random()*36,
      size:.45+random()*1.5,
      pulse:random()*turn
    };
  });
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let preference;
  let visible = false;
  let frame = 0;
  let previousTime;
  let time = 0;
  let speed = 1;
  const paused = () => preference ?? media.matches;
  const color = (rgb,alpha) => "rgba("+rgb.join(",")+","+alpha+")";

  function ring(radius,width,segments,coverage,angle,rgb,alpha) {
    context.beginPath();
    for (let index=0;index<segments;index++) {
      const start = angle + index*turn/segments;
      context.moveTo(radius*Math.cos(start),radius*Math.sin(start));
      context.arc(0,0,radius,start,start+turn/segments*coverage);
    }
    context.lineWidth = width;
    context.strokeStyle = color(rgb,alpha);
    context.stroke();
  }

  function paint() {
    const rgb = palettes[stage.dataset.phase] ?? palettes.idle;
    context.clearRect(0,0,canvas.width,canvas.height);
    context.save();
    context.translate(260,260);
    ring(247,4,108,.23,-time*.045,rgb,.23);
    ring(224,1,7,.64,time*.105,rgb,.56);
    ring(198,4,14,.62,-time*.2,rgb,.74);
    ring(190,1,1,1,0,rgb,.22);
    ring(172,1,88,.36,time*.09,rgb,.35);

    context.beginPath();
    for (let index=0;index<68;index++) {
      const angle = index*turn/68+time*.07;
      const inner = index%4===0 ? 135 : 142;
      context.moveTo(Math.cos(angle)*inner,Math.sin(angle)*inner);
      context.lineTo(Math.cos(angle)*153,Math.sin(angle)*153);
    }
    context.lineWidth = 1.65;
    context.strokeStyle = color(rgb,.58);
    context.stroke();

    const pulse = (Math.sin(time*1.7)+1)/2;
    const halo = context.createRadialGradient(0,0,1,0,0,116+pulse*9);
    halo.addColorStop(0,color(rgb,.95));
    halo.addColorStop(.10,color(rgb,.84));
    halo.addColorStop(.29,color(rgb,.34));
    halo.addColorStop(.61,color(rgb,.10));
    halo.addColorStop(1,color(rgb,0));
    context.fillStyle = halo;
    context.fillRect(-130,-130,260,260);

    for (const particle of particles) {
      const angle = particle.angle+time*.36;
      const depth = Math.sin(angle)*particle.radial;
      const perspective = 1+depth*.13;
      const x = Math.cos(angle)*particle.radial*particle.radius*perspective;
      const y = (particle.height*.92+depth*.28)*particle.radius*perspective;
      const intensity = (Math.sin(time*2.5+particle.pulse)+1)/2;
      context.fillStyle = color(rgb,.16+intensity*.46+Math.max(0,depth)*.29);
      context.beginPath();
      context.arc(x,y,particle.size*perspective,0,turn);
      context.fill();
    }

    const core = context.createRadialGradient(0,0,0,0,0,29+pulse*9);
    core.addColorStop(0,"rgba(245,255,255,.98)");
    core.addColorStop(.25,color(rgb,.85));
    core.addColorStop(1,color(rgb,0));
    context.fillStyle = core;
    context.fillRect(-40,-40,80,80);
    context.restore();
  }

  function animate(now) {
    const target = {listening:2.1,processing:3.2,success:1.45}[stage.dataset.phase] ?? 1;
    speed += (target-speed)*.07;
    if (previousTime !== undefined) time += Math.min(now-previousTime,48)/1000*speed;
    previousTime = now;
    paint();
    frame = requestAnimationFrame(animate);
  }

  function syncAnimation() {
    stage.dataset.paused = String(paused());
    toggle.textContent = paused() ? "動きを再開" : "動きを停止";
    const shouldAnimate = visible && !paused() && !document.hidden;
    if (shouldAnimate && !frame) {
      previousTime = undefined;
      frame = requestAnimationFrame(animate);
    } else if (!shouldAnimate) {
      cancelAnimationFrame(frame);
      frame = 0;
      if (visible) paint();
    }
  }

  toggle.onclick = () => {
    preference = !paused();
    syncAnimation();
  };
  media.addEventListener("change",syncAnimation);
  document.addEventListener("visibilitychange",syncAnimation);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncAnimation();
  }).observe(canvas);
  new MutationObserver(() => { if (visible && !frame) paint(); }).observe(stage,{attributes:true,attributeFilter:["data-phase"]});
  syncAnimation();
})();
