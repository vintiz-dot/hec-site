import{c as d,a as s,i as o,U as c,w as l}from"./shared-Bn5_1BJB.js";import{g as m,m as p}from"./data-GPvoNnpN.js";async function u(){const a=d();s(a),o(t=>{s(t),i(t)});let n;try{n=await m()}catch{document.getElementById("studentGrid").innerHTML="<p class='text-ink-soft'>Journals are being prepared…</p>";return}window.__students=n.students,i(a)}function i(a){const n=document.getElementById("studentGrid");n.innerHTML="",(window.__students||[]).forEach((t,r)=>{const e=document.createElement("a");e.className="student-card reveal",e.style.transitionDelay=`${r%3*80}ms`,e.href=`./student.html?s=${encodeURIComponent(t.slug)}`,e.innerHTML=`
      <img loading="lazy" decoding="async" alt="" />
      <div class="veil"></div>
      <div class="absolute bottom-0 inset-x-0 p-6 text-white">
        <p class="font-display text-2xl"></p>
        <p class="text-[0.65rem] tracking-[0.25em] uppercase opacity-80 mt-1"></p>
      </div>`,e.querySelector("img").src=p(t.thumb),e.querySelector(".font-display").textContent=t.name,e.querySelector("p:last-child").textContent=`${t.class?t.class+" · ":""}${c[a].open}`,n.appendChild(e)}),l()}u();
