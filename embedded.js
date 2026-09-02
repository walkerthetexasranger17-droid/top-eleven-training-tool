
// Real standalone storage — this app no longer runs inside Claude's artifact
// sandbox, so window.storage (which only exists there) is replaced here with
// a drop-in shim over real browser localStorage, matching the exact same
// method signatures. Every save/load/delete/session-persist function below
// was written against that interface and needs zero changes to work here.
window.storage = {
  async get(key, shared){
    const v = localStorage.getItem('te:'+key);
    if(v === null) return null;
    return {key, value: v, shared: !!shared};
  },
  async set(key, value, shared){
    localStorage.setItem('te:'+key, value);
    return {key, value, shared: !!shared};
  },
  async delete(key, shared){
    localStorage.removeItem('te:'+key);
    return {key, deleted: true, shared: !!shared};
  },
  async list(prefix, shared){
    const keys = [];
    for(let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      if(k && k.indexOf('te:') === 0){
        const bare = k.slice(3);
        if(!prefix || bare.indexOf(prefix) === 0) keys.push(bare);
      }
    }
    return {keys, prefix, shared: !!shared};
  }
};

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update();
        // Re-check for a new version whenever the app is reopened/foregrounded,
        // not just on a fresh page load — this is what was causing it to look
        // stuck on the old version until you manually pulled-to-refresh.
        document.addEventListener('visibilitychange', () => {
          if(document.visibilityState === 'visible') reg.update();
        });
      })
      .catch(err => console.warn('SW registration failed', err));
  });
}

const OUTFIELD_SKILLS = ["Tackling","Marking","Positioning","Heading","Bravery","Passing","Dribbling","Crossing","Shooting","Finishing","Fitness","Strength","Aggression","Speed","Creativity"];
const GK_SKILLS = ["Reflexes","Agility","Anticipation","Rushing Out","Communication","Throwing","Kicking","Punching","Aerial Reach","Concentration"];
// GKs also show a Physical block in-game (Fitness, Strength, Aggression, Speed,
// Creativity) — these are display/scan-capture only, not part of GK_SKILLS, so
// they don't affect drill/grey-skill logic (POSITION_WHITE.GK stays as the 10
// GK-specific attributes the real GK drills actually train).
const GK_PHYSICAL_DISPLAY = ["Fitness","Strength","Aggression","Speed","Creativity"];
const GROUPS_OUTFIELD = {
  "Defence": ["Tackling","Marking","Positioning","Heading","Bravery"],
  "Attack": ["Passing","Dribbling","Crossing","Shooting","Finishing"],
  "Physical": ["Fitness","Strength","Aggression","Speed","Creativity"]
};
const GROUPS_GK = { "Goalkeeping": GK_SKILLS, "Physical": GK_PHYSICAL_DISPLAY };
const DEFAULTS_OUTFIELD = {Tackling:0,Marking:0,Positioning:0,Heading:0,Bravery:0,Passing:0,Dribbling:0,Crossing:0,Shooting:0,Finishing:0,Fitness:0,Strength:0,Aggression:0,Speed:0,Creativity:0};
const DEFAULTS_GK = {Reflexes:0,Agility:0,Anticipation:0,"Rushing Out":0,Communication:0,Throwing:0,Kicking:0,Punching:0,"Aerial Reach":0,Concentration:0,Fitness:0,Strength:0,Aggression:0,Speed:0,Creativity:0};

// GK's own Fitness is white (confirmed against the actual bold/dim styling on a
// real GK's in-game card) — Strength/Aggression/Speed/Creativity are not, so they
// stay in GK_PHYSICAL_DISPLAY only, purely for reference, not counted as
// white/grey against any drill.
const GK_APPLICABLE_POOL = GK_SKILLS.concat(["Fitness"]);

const POSITION_WHITE = {
  GK: GK_APPLICABLE_POOL,
  DR: ["Tackling","Marking","Positioning","Bravery","Crossing","Fitness","Aggression","Speed"],
  DL: ["Tackling","Marking","Positioning","Bravery","Crossing","Fitness","Aggression","Speed"],
  DC: ["Tackling","Marking","Positioning","Heading","Bravery","Fitness","Strength","Aggression"],
  DMR: ["Tackling","Marking","Positioning","Bravery","Passing","Crossing","Strength","Aggression"],
  DML: ["Tackling","Marking","Positioning","Bravery","Passing","Crossing","Strength","Aggression"],
  DMC: ["Tackling","Marking","Positioning","Heading","Bravery","Passing","Fitness","Strength","Aggression","Creativity"],
  MR: ["Positioning","Passing","Dribbling","Crossing","Fitness","Speed","Creativity"],
  ML: ["Positioning","Passing","Dribbling","Crossing","Fitness","Speed","Creativity"],
  MC: ["Tackling","Marking","Positioning","Bravery","Passing","Dribbling","Shooting","Fitness","Speed","Creativity"],
  AMR: ["Passing","Dribbling","Crossing","Shooting","Finishing","Fitness","Speed","Creativity"],
  AML: ["Passing","Dribbling","Crossing","Shooting","Finishing","Fitness","Speed","Creativity"],
  AMC: ["Heading","Passing","Dribbling","Shooting","Finishing","Fitness","Speed","Creativity"],
  ST: ["Positioning","Heading","Passing","Dribbling","Shooting","Finishing","Strength","Speed","Creativity"]
};

// Master drill list — transcribed directly from your in-game drill cards.
// This is the single source of truth. Clean drills per position are computed
// from this, not hardcoded, so nothing can be suggested that isn't really in the game.
const MASTER_DRILLS = [
  {name:"Slalom Dribble", skills:["Dribbling","Speed","Fitness","Passing"], diff:"Hard", cat:"Attack"},
  {name:"Wing Play", skills:["Punching","Heading","Crossing","Finishing","Shooting"], diff:"Hard", cat:"Attack"},
  {name:"Fast Counter-Attacks", skills:["Communication","Creativity","Passing","Crossing","Finishing"], diff:"Very Hard", cat:"Attack"},
  {name:"Warm-Up", skills:["Aggression","Fitness","Heading","Reflexes"], diff:"Very Easy", cat:"Physical"},
  {name:"Stretch", skills:["Strength","Speed","Agility","Fitness"], diff:"Easy", cat:"Physical"},
  {name:"Carioca With Ladders", skills:["Speed","Aggression","Agility","Concentration"], diff:"Easy", cat:"Physical"},
  {name:"Long Run", skills:["Fitness","Speed","Concentration"], diff:"Medium", cat:"Physical"},
  {name:"Contact Play", skills:["Dribbling","Aggression","Marking","Strength","Bravery"], diff:"Medium", cat:"Possession"},
  {name:"Passes Before Shot", skills:["Anticipation","Creativity","Passing","Positioning","Finishing"], diff:"Hard", cat:"Possession"},
  {name:"Stay In Lane", skills:["Speed","Positioning","Fitness","Aerial Reach"], diff:"Medium", cat:"Possession"},
  {name:"Video Analysis", skills:["Bravery","Positioning","Communication","Creativity"], diff:"Very Easy", cat:"Defence"},
  {name:"Use Your Head", skills:["Creativity","Positioning","Heading","Passing"], diff:"Easy", cat:"Defence"},
  {name:"Hold The Line", skills:["Concentration","Positioning","Marking","Communication"], diff:"Medium", cat:"Defence"},
  {name:"Stop The Attacker", skills:["Dribbling","Marking","Tackling","Strength","Bravery"], diff:"Medium", cat:"Defence"},
  {name:"Defending Crosses", skills:["Heading","Marking","Aerial Reach","Crossing","Bravery"], diff:"Medium", cat:"Defence"},
  {name:"Press The Play", skills:["Aggression","Marking","Tackling","Positioning","Bravery"], diff:"Hard", cat:"Defence"},
  {name:"Goalkeeper Training", skills:["Agility","Kicking","Aerial Reach","Throwing","Reflexes"], diff:"Hard", cat:"Defence"},
  {name:"Ball Control", skills:["Dribbling","Concentration","Heading","Creativity"], diff:"Very Easy", cat:"Possession"},
  {name:"Piggy In The Middle", skills:["Aggression","Fitness","Tackling","Passing","Positioning"], diff:"Easy", cat:"Possession"},
  {name:"First Touch Play", skills:["Dribbling","Throwing","Fitness","Passing"], diff:"Easy", cat:"Possession"},
  {name:"Rapid Side Switch", skills:["Creativity","Crossing","Speed","Communication","Passing","Positioning"], diff:"Medium", cat:"Possession"},
  {name:"1-on-1 Finishing", skills:["Anticipation","Tackling","Rushing Out","Finishing","Dribbling"], diff:"Easy", cat:"Attack"},
  {name:"Pass, Go and Shoot!", skills:["Speed","Anticipation","Shooting","Passing"], diff:"Easy", cat:"Attack"},
  {name:"Set-Piece Delivery", skills:["Heading","Marking","Crossing","Rushing Out","Shooting"], diff:"Medium", cat:"Attack"},
  {name:"Shooting Technique", skills:["Agility","Strength","Reflexes","Finishing","Shooting"], diff:"Medium", cat:"Attack"},
  {name:"Shuttle Runs", skills:["Strength","Speed","Bravery","Agility"], diff:"Hard", cat:"Physical"},
  {name:"Hurdle Jumps", skills:["Speed","Bravery","Aggression","Kicking"], diff:"Hard", cat:"Physical"},
  {name:"Gym", skills:["Strength","Throwing","Fitness","Kicking"], diff:"Very Hard", cat:"Physical"},
  {name:"Sprint", skills:["Dribbling","Speed","Fitness","Rushing Out"], diff:"Very Hard", cat:"Physical"},
];

const CATEGORY_COLORS = {
  "Attack": "#FF5A6E",
  "Defence": "#3ED98B",
  "Possession": "#FFD84A",
  "Physical": "#4AA8FF"
};

const SPECIAL_ABILITIES = {
  "Penalty Kick Stopper": {description:"Improves the goalkeeper's chance of stopping penalties."},
  "Defensive Wall": {description:"Helps block long-range shots and direct free kicks."},
  "Aerial Defender": {description:"Improves defensive performance in aerial duels and high balls."},
  "Dribbler": {description:"Improves the player's ability to beat opponents with the ball."},
  "Corner Specialist": {description:"Improves the precision and danger of corner kicks."},
  "Shadow Striker": {description:"Encourages dangerous late attacking runs into scoring areas."},
  "One-on-One Scorer": {description:"Improves effectiveness in one-on-one scoring situations."},
  "One-on-One Stopper": {description:"Improves goalkeeper performance in one-on-one situations."},
  "Playmaker": {description:"Improves passing influence and helps control the tempo of play."},
  "Free Kick Specialist": {description:"Improves the accuracy and danger of direct free kicks."},
  "Penalty Kick Specialist": {description:"Improves accuracy and effectiveness from the penalty spot."}
};

const PLAYSTYLES = {
  "Poacher": {description:"A striker focused on positioning, movement and finishing chances in the box."},
  "False Nine": {description:"Drops into deeper areas to link play and pull defenders out of position."},
  "Target Man": {description:"Uses strength and aerial ability to hold up the ball and bring teammates into play."},
  "Inside Forward": {description:"Starts wide and drives inside to shoot or create central chances."},
  "Winger": {description:"Stays wide to stretch the defence, carry the ball and deliver crosses."},
  "Enganche": {description:"A creative attacking hub who receives between the lines and dictates the final pass."},
  "False Winger": {description:"Starts wide but moves inside to create central overloads and passing lanes."},
  "Complete Forward": {description:"Combines finishing, link play, movement and physical contribution across the attack."},
  "Box-to-Box": {description:"Covers the pitch from defence to attack and contributes at both ends."},
  "Mezzala": {description:"Moves into the half-spaces to combine, create overloads and support attacks."},
  "Ball Winner": {description:"Presses, tackles and intercepts to regain possession for the team."},
  "Anchor Man": {description:"Holds a disciplined position in front of the defence and protects the centre."},
  "Playmaker": {description:"Takes responsibility for creative passing and controlling attacking tempo."},
  "Regista": {description:"Deep-lying playmaker who dictates rhythm and starts attacks from deep."},
  "Holding Midfielder": {description:"Prioritises defensive structure, positioning and safe possession in midfield."},
  "Wing Back": {description:"Provides width with overlapping runs while still contributing defensively."},
  "Box Commander": {description:"Leads the defensive line, organising positioning and commanding the box."},
  "Ball Playing DC": {description:"Combines defensive work with confident passing from the back."},
  "Stopper": {description:"Steps out aggressively to confront attackers and disrupt attacks early."},
  "Sweeper Keeper": {description:"Acts proactively behind the defence, sweeping through-balls and starting play."},
  "Full Back": {description:"Defends the flank, supports the build-up and provides width when required."},
  "No-Nonsense DC": {description:"Prioritises defensive safety, clearances and simple decisions under pressure."}
};

function normaliseAbilities(data){
  const known = Object.keys(SPECIAL_ABILITIES);
  const raw = Array.isArray(data?.specialAbilities) ? data.specialAbilities : (data?.specialAbility ? [data.specialAbility] : []);
  return raw.map(String).filter(a => known.includes(a)).slice(0,2);
}

function normalisePlaystyle(data){
  const raw = data?.playstyle || data?.playStyle || '';
  return Object.prototype.hasOwnProperty.call(PLAYSTYLES, raw) ? raw : '';
}

function normalisePosition(position){ return String(position||'').trim().toUpperCase(); }
function availablePlaystylesFor(){ return Object.entries(PLAYSTYLES); }

function renderPlaystylePicker(containerId, position, selected='', disabled=false){
  const el=document.getElementById(containerId); if(!el) return;
  const chosen=normalisePlaystyle({playstyle:selected});
  const available=availablePlaystylesFor();
  el.innerHTML=available.map(([name,p])=>{
    const checked=chosen===name;
    return `<label class="playstyle-option ${disabled?'disabled':''}"><input type="radio" name="${containerId}-playstyle" data-playstyle="${escapeHtml(name)}" ${checked?'checked':''} ${disabled?'disabled':''}><span><div class="playstyle-option-title">${escapeHtml(name)}</div><div class="playstyle-option-desc">${escapeHtml(p.description)}</div></span></label>`;
  }).join('');
  const countId=containerId==='addPlaystylePicker'?'addPlaystyleCount':null;
  const update=()=>{ if(countId){const chosenNow=el.querySelector('input[data-playstyle]:checked'); document.getElementById(countId).textContent=`${chosenNow?1:0} / 1`;} };
  el.querySelectorAll('input[data-playstyle]').forEach(box=>box.addEventListener('change',update)); update();
}

function getSelectedPlaystyle(containerId){ return document.querySelector(`#${containerId} input[data-playstyle]:checked`)?.getAttribute('data-playstyle') || ''; }
function renderPlaystyleChip(containerId, playstyle){ const el=document.getElementById(containerId); if(!el) return; const value=normalisePlaystyle({playstyle}); el.innerHTML=value?`<span class="playstyle-chip">${escapeHtml(value)}</span>`:'<div class="ability-empty">No playstyle assigned.</div>'; }

function renderAbilityPicker(containerId, position, selected=[], disabled=false){
  const el=document.getElementById(containerId); if(!el) return;
  const chosen=normaliseAbilities({specialAbilities:selected});
  const available=Object.entries(SPECIAL_ABILITIES);
  el.innerHTML=available.map(([name,a])=>{
    const checked=chosen.includes(name);
    return `<label class="ability-option ${disabled?'disabled':''}"><input type="checkbox" data-ability="${escapeHtml(name)}" ${checked?'checked':''} ${disabled?'disabled':''}><span><div class="ability-option-title">${escapeHtml(name)}</div><div class="ability-option-desc">${escapeHtml(a.description)}</div></span></label>`;
  }).join('');
  const update=()=>{
    const boxes=[...el.querySelectorAll('input[data-ability]')]; const checked=boxes.filter(x=>x.checked);
    if(checked.length>2){ checked[checked.length-1].checked=false; return; }
    boxes.forEach(x=>x.closest('.ability-option')?.classList.toggle('disabled', disabled || (checked.length>=2 && !x.checked)));
    const countId=containerId==='addAbilityPicker'?'addAbilityCount':null; if(countId) document.getElementById(countId).textContent=`${checked.length} / 2`;
  };
  el.querySelectorAll('input[data-ability]').forEach(box=>box.addEventListener('change',update)); update();
}
function getSelectedAbilities(containerId){ return [...document.querySelectorAll(`#${containerId} input[data-ability]:checked`)].map(x=>x.getAttribute('data-ability')).slice(0,2); }
function renderAbilityChips(containerId, abilities){ const el=document.getElementById(containerId); if(!el) return; const list=normaliseAbilities({specialAbilities:abilities}); el.innerHTML=list.length?list.map(a=>`<span class="ability-chip">${escapeHtml(a)}</span>`).join(''):'<div class="ability-empty">No special abilities assigned.</div>'; }

function roleColorOf(pos){
  if(pos === 'GK') return '#4AA8FF';
  if(['DL','DC','DR'].includes(pos)) return '#3ED98B';
  if(['DMC','DMR','DML','ML','MR','MC'].includes(pos)) return '#FFD84A';
  if(['AML','AMR','AMC','ST'].includes(pos)) return '#FF5A6E';
  return 'var(--ink-faint)';
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function isGK(pos){ return pos === 'GK'; }
function skillsFor(pos){ return isGK(pos) ? GK_APPLICABLE_POOL : OUTFIELD_SKILLS; }
function groupsFor(pos){ return isGK(pos) ? {"Goalkeeping":GK_SKILLS,"Defence":GROUPS_OUTFIELD.Defence,"Attack":GROUPS_OUTFIELD.Attack,"Physical":GROUPS_OUTFIELD.Physical} : GROUPS_OUTFIELD; }
function displaySkillsFor(pos){ return isGK(pos) ? GK_SKILLS.concat(OUTFIELD_SKILLS) : OUTFIELD_SKILLS; }
function defaultsFor(pos){ return isGK(pos) ? DEFAULTS_GK : DEFAULTS_OUTFIELD; }

// Splits a drill's skills into white / grey / not-applicable for a given position.
function fitDrill(drill, pos){
  const white = POSITION_WHITE[pos] || [];
  const pool = skillsFor(pos);
  const res = {white:[], grey:[], na:[]};
  drill.skills.forEach(s => {
    if(white.includes(s)) res.white.push(s);
    else if(pool.includes(s)) res.grey.push(s);
    else res.na.push(s);
  });
  return res;
}

function getMaxGrey(){
  const el = document.getElementById('maxGrey');
  return el ? (Number(el.value) || 0) : 0;
}

function cleanDrillsFor(pos){
  const maxGrey = getMaxGrey();
  return MASTER_DRILLS
    .map(d => ({...d, fit: fitDrill(d,pos)}))
    .filter(d => d.fit.white.length > 0 && d.fit.grey.length <= maxGrey);
}

function renderSkillGroups(){
  const wrap = document.getElementById('skillGroups');
  if(!wrap) return;
  if(!trainingPlayerKey){
    wrap.innerHTML='<div class="ability-empty">Select a player above to load their saved skills.</div>';
    return;
  }
  const white = POSITION_WHITE[currentPosition] || [];
  const groups = groupsFor(currentPosition);
  const defaults = defaultsFor(currentPosition);
  wrap.innerHTML = Object.entries(groups).map(([label, skills]) => `
    <div class="skill-group">
      <div class="skill-group-label">${label}</div>
      <div class="skill-grid">
        ${skills.map(s => {
          const isWhite = white.includes(s);
          const prev = document.getElementById(`skill-${s}`);
          const val = prev ? prev.value : defaults[s];
          return `<div class="skill-cell ${currentPosition ? (isWhite?'white':'grey') : ''}">
            <label>${s}</label>
            <input type="number" id="skill-${s}" value="${val}">
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function renderDrillList(){
  const list = document.getElementById('drillList');
  const note = document.getElementById('drillSourceNote');
  if(!currentPosition){
    list.innerHTML = `<div class="note warn">⚠️ <span>Pick a role above to see clean drills for it.</span></div>`;
    note.textContent = "";
    return;
  }
  const clean = cleanDrillsFor(currentPosition);
  const maxGrey = getMaxGrey();
  const label = maxGrey === 0 ? '0-grey (clean) drill' : `drill with ≤${maxGrey} grey skill${maxGrey===1?'':'s'}`;
  note.textContent = `${clean.length} ${label}${clean.length===1?'':'s'} found for ${currentPosition} out of ${MASTER_DRILLS.length} total in-game drills.`;
  if(clean.length === 0){
    list.innerHTML = `<div class="note warn">⚠️ <span>No drills found within that grey-skill limit for this role. Try raising "Max grey skills allowed" above.</span></div>`;
    return;
  }
  list.innerHTML = clean.map(d => {
    const on = !disabledDrills.has(d.name);
    const safeName = d.name.replace(/"/g,'&quot;');
    const catColor = CATEGORY_COLORS[d.cat] || 'var(--line)';
    return `
    <div class="drill" style="border-left:3px solid ${catColor};">
      <div class="drill-top">
        <div>
          <span class="drill-name">${d.name}</span>
          <div class="drill-diff"><span style="color:${catColor};">${d.cat}</span> · ${d.diff}</div>
        </div>
        <div class="drill-toggle ${on?'on':''}" data-drill-name="${safeName}"></div>
      </div>
      <div class="chip-row">
        ${d.fit.white.map(s => `<span class="chip">${s}</span>`).join('')}
        ${d.fit.grey.map(s => `<span class="chip grey-chip">${s} (grey)</span>`).join('')}
        ${d.fit.na.map(s => `<span class="chip na">${s}</span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

// Event delegation for drill toggles — they're recreated on every render,
// and inline onclick="" attributes don't fire under this page's CSP, so this
// listener is bound once on the container instead, not per-toggle.
document.getElementById('drillList').addEventListener('click', function(e){
  const toggle = e.target.closest('.drill-toggle');
  if(!toggle) return;
  const name = toggle.getAttribute('data-drill-name');
  if(!name) return;
  if(disabledDrills.has(name)) disabledDrills.delete(name);
  else disabledDrills.add(name);
  renderDrillList();
});

document.getElementById('posSelect').addEventListener('change', (e) => {
  currentPosition = normalisePosition(e.target.value);
  const currentStyle=getSelectedPlaystyle('addPlaystylePicker');
  const styleStillValid=availablePlaystylesFor(currentPosition).some(([name])=>name===currentStyle);
  renderAbilityPicker('addAbilityPicker', currentPosition, getSelectedAbilities('addAbilityPicker'), false);
  renderPlaystylePicker('addPlaystylePicker', currentPosition, styleStillValid?currentStyle:'', false);
  renderAddSkillPreview(addPlayerSkills,currentPosition);
  renderSkillGroups();
  renderDrillList();
});

document.getElementById('maxGrey').addEventListener('input', renderDrillList);

function getCurrentSkills(){
  const vals = {};
  skillsFor(currentPosition).forEach(s => {
    const el = document.getElementById(`skill-${s}`);
    if(el) vals[s] = Number(el.value) || 0;
  });
  return vals;
}

let sessionDone = [];

// Renders the "Your 6" sheet with tap-to-check-off support, so once you've built
// a session you can glance at the game, come back and tap off what's done, and
// never need to write anything down — the checked state is visual only here,
// persistSession() below is what makes it survive a reload.
function renderSheet(chosen, doneArr){
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = chosen.map((d,i) => {
    const catColor = CATEGORY_COLORS[d.cat] || 'var(--turf)';
    const isDone = !!doneArr[i];
    return `
    <div class="sheet-row ${isDone?'done':''}" style="border-left:3px solid ${catColor};" data-slot="${i}">
      <div class="sheet-num" style="border-color:${catColor};color:${catColor};">${isDone ? '✓' : i+1}</div>
      <div class="sheet-main">
        <div class="name">${d.name}${d.nearZero ? ' <span style="color:var(--amber);font-family:\'Space Mono\',monospace;font-size:10px;">⚠ minimal gain expected</span>' : ''}</div>
        <div class="skills"><span style="color:${catColor};">${d.cat}</span> · ${d.fit.white.join(' · ')}</div>
      </div>
      <div class="sheet-score">avg gap<br>${d.score.toFixed(0)}</div>
    </div>`;
  }).join('') || `<div class="empty">No clean drills enabled. Toggle at least one on above.</div>`;
}

document.getElementById('sheet').addEventListener('click', function(e){
  const row = e.target.closest('.sheet-row');
  if(!row) return;
  const slot = Number(row.getAttribute('data-slot'));
  if(Number.isNaN(slot)) return;
  sessionDone[slot] = !sessionDone[slot];
  row.classList.toggle('done', sessionDone[slot]);
  row.querySelector('.sheet-num').textContent = sessionDone[slot] ? '✓' : String(slot+1);
  const name = (document.getElementById('nameInput').value || '').trim();
  if(name && lastChosen) persistSession(lastChosen, sessionDone, name);
});

let lastChosen = null;

async function persistSession(chosen, doneArr, nameOverride){
  const name = nameOverride || (document.getElementById('nameInput').value || '').trim();
  if(!name) return; // nothing to key it under yet
  lastChosen = chosen;
  const slug = slugifyKey(name);
  const payload = {
    chosen: chosen.map(d => ({name:d.name, diff:d.diff, cat:d.cat, skills:d.fit.white, score:d.score, nearZero:d.nearZero})),
    done: doneArr,
    savedAt: new Date().toISOString()
  };
  try{ await window.storage.set(`session:${slug}`, JSON.stringify(payload), false); }
  catch(err){ console.warn('session persist failed', err); }
}

async function restoreSession(name){
  if(!name) return false;
  const slug = slugifyKey(name);
  try{
    const res = await window.storage.get(`session:${slug}`, false);
    if(!res) return false;
    const data = JSON.parse(res.value);
    const chosen = (data.chosen||[]).map(d => ({...d, fit:{white:d.skills}}));
    sessionDone = data.done || new Array(chosen.length).fill(false);
    lastChosen = chosen;
    document.getElementById('results').style.display = 'block';
    renderSheet(chosen, sessionDone);
    const nearZeroNote = document.getElementById('nearZeroNote');
    if(nearZeroNote) nearZeroNote.style.display = chosen.some(d=>d.nearZero) ? 'flex' : 'none';
    document.getElementById('bars').innerHTML = '';
    const note = document.createElement('div');
    note.className = 'note';
    note.innerHTML = '📌 <span>Restored your last built session for this player — still checking things off from before? Keep tapping. Building a fresh session below will replace this one.</span>';
    document.getElementById('bars').appendChild(note);
    return true;
  }catch(err){ console.warn('session restore failed', err); return false; }
}

function buildSession(){
  if(!currentPosition){
    const results = document.getElementById('results');
    results.style.display = 'block';
    document.getElementById('sheet').innerHTML = `<div class="empty">Select the player's role in Step 02 first.</div>`;
    document.getElementById('bars').innerHTML = '';
    return;
  }
  const current = getCurrentSkills();
  const ceiling = Number(document.getElementById('ceiling').value) || 140;
  const active = cleanDrillsFor(currentPosition).filter(d => !disabledDrills.has(d.name));

  // Difficulty matters in two ways, not just one:
  // 1) A harder drill gets prioritized over an easier one when the gap is similar
  //    (DIFFICULTY_WEIGHT), since it delivers more real XP per run.
  // 2) An easy drill genuinely stops being able to move a skill once it's not far
  //    below the wall anymore — it doesn't scale up to train a well-developed skill
  //    the way a harder drill can. DIFFICULTY_CEILING_FACTOR models that: each
  //    difficulty has its own effective ceiling (a fraction of the wall), and once
  //    a skill passes that, the drill is treated as having ~nothing left to give
  //    for that skill — which is exactly the "ran it 3 times, gained nothing"
  //    behavior being reported, instead of the tool pretending it still helps.
  const DIFFICULTY_WEIGHT = {"Very Easy":1, "Easy":1.6, "Medium":2.2, "Hard":2.8, "Very Hard":3.4};
  const DIFFICULTY_CEILING_FACTOR = {"Very Easy":0.65, "Easy":0.8, "Medium":0.95, "Hard":1.1, "Very Hard":1.3};

  // A real session is always 6 drill-slots, but a drill can repeat — it doesn't
  // need to be 6 different drills. So we greedily fill 6 slots one at a time,
  // re-scoring after each pick against a running projection: once a drill is
  // chosen, its skills' gap shrinks a bit, which lets a repeat naturally fall
  // out of favor in later slots (or stay picked again if it's still the best gap).
  const working = {...current};
  const chosen = [];

  function scoreOf(d, working){
    const factor = DIFFICULTY_CEILING_FACTOR[d.diff] || 1;
    const effCeiling = ceiling * factor;
    const deficits = d.fit.white.map(s => effCeiling - (working[s]||0));
    const avgDeficit = deficits.reduce((a,b)=>a+b,0) / deficits.length;
    const weight = DIFFICULTY_WEIGHT[d.diff] || 1;
    return { score: avgDeficit * weight, avgDeficit, effCeiling };
  }

  function applyPick(d, effCeiling){
    const weight = DIFFICULTY_WEIGHT[d.diff] || 1;
    d.fit.white.forEach(s => {
      const room = effCeiling - (working[s]||0);
      // Full-strength bump while there's real room under this difficulty's effective
      // ceiling; a token bump once past it, reflecting near-zero real gain.
      const bump = room > 0 ? Math.min(4 * weight, room + 4) : 1;
      working[s] = (working[s]||0) + bump;
    });
  }

  if(active.length > 0){
    // Every single slot — not just the first pass — goes to whichever white
    // skill is currently weakest: find the biggest remaining gap, find the
    // best-scoring active drill that actually trains it, pick it, then
    // re-check what's weakest for the next slot. This is what makes it correct
    // rather than just "each skill touched once": if a skill (like Heading or
    // Shooting) is still the weakest after its one drill, that same logic picks
    // it again next slot too — it doesn't get abandoned just because it was
    // covered once, and it isn't crowded out by a couple of drills that happen
    // to score well as a multi-skill average.
    const skillsList = POSITION_WHITE[currentPosition] || [];
    for(let slot = 0; slot < 6; slot++){
      let weakestSkill = null, maxDeficit = -Infinity;
      skillsList.forEach(s => {
        const deficit = ceiling - (working[s]||0);
        if(deficit > maxDeficit){ maxDeficit = deficit; weakestSkill = s; }
      });

      let best = null, bestScore = -Infinity, bestAvg = 0, bestEff = ceiling;
      active.forEach(d => {
        if(!d.fit.white.includes(weakestSkill)) return;
        const {score, avgDeficit, effCeiling} = scoreOf(d, working);
        if(score > bestScore){ bestScore = score; bestAvg = avgDeficit; best = d; bestEff = effCeiling; }
      });
      if(!best){
        // Nothing active touches the weakest skill at all — fall back to
        // whatever scores best overall so the slot isn't wasted.
        active.forEach(d => {
          const {score, avgDeficit, effCeiling} = scoreOf(d, working);
          if(score > bestScore){ bestScore = score; bestAvg = avgDeficit; best = d; bestEff = effCeiling; }
        });
      }
      if(!best) break;
      chosen.push({...best, score: bestAvg, nearZero: bestAvg <= 0});
      applyPick(best, bestEff);
    }
  }

  sessionDone = new Array(chosen.length).fill(false);
  renderSheet(chosen, sessionDone);
  persistSession(chosen, sessionDone);

  document.getElementById('results').style.display = 'block';

  const anyNearZero = chosen.some(d => d.nearZero);
  const nearZeroNote = document.getElementById('nearZeroNote');
  nearZeroNote.style.display = anyNearZero ? 'flex' : 'none';

  const white = POSITION_WHITE[currentPosition] || [];
  const projected = {}; white.forEach(s => projected[s] = working[s]!==undefined ? working[s] : (current[s]||0));

  const bars = document.getElementById('bars');
  bars.innerHTML = white.map(s => {
    const val = projected[s];
    const pct = Math.min(val/220*100, 100);
    const cls = val > 180 ? 'over' : (val > ceiling ? 'warn' : '');
    const markerPct = Math.min(ceiling/220*100,100);
    return `<div class="bar-row">
      <div class="bar-label">${s}</div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div><div class="marker" style="left:${markerPct}%"></div></div>
      <div class="bar-val">${Math.round(current[s]||0)} → ${Math.round(val)}</div>
    </div>`;
  }).join('');
}

// --- Persistence: artifact storage (not localStorage — that's blocked here) ---
// Storage keys can't contain whitespace, slashes, or quotes — player names usually
// have spaces, so we slugify for the key and keep the real name inside the payload.
function slugifyKey(name){
  return name.trim().toLowerCase().replace(/[\s/\\'"]+/g, '_').replace(/[^a-z0-9_\-]/g, '');
}

// Fetches every saved player and returns full records — the shared data
// source behind the Squad grid, the Dashboard stats, and the player picker.
const SQUAD_ORDER_KEY = 'squad:order';

async function getSquadOrder(){
  try{
    const r = await window.storage.get(SQUAD_ORDER_KEY, false);
    if(r && r.value){
      const parsed = JSON.parse(r.value);
      return Array.isArray(parsed) ? parsed : [];
    }
  }catch(_){}
  return [];
}

async function saveSquadOrder(order){
  try{ await window.storage.set(SQUAD_ORDER_KEY, JSON.stringify(order), false); }
  catch(_){ try{ await window.storage.set(SQUAD_ORDER_KEY, JSON.stringify(order)); }catch(err){ console.warn('Could not save squad order:', err); } }
}

async function getAllPlayers(){
  let res = null;
  try{ res = await window.storage.list('player:', false); }
  catch(err1){
    try{ res = await window.storage.list('player:'); }
    catch(err2){ console.warn('Storage list unavailable (likely just an empty store):', err2.message || err2); }
  }
  const keys = (res && res.keys) || [];
  const entries = await Promise.all(keys.map(async k => {
    try{
      const r = await window.storage.get(k, false);
      const data = r ? JSON.parse(r.value) : null;
      if(data){ data.specialAbilities=normaliseAbilities(data); data.specialAbility=''; }
      return data ? {...data, key: k} : null;
    }catch(_){ return null; }
  }));
  return entries.filter(Boolean);
}

function roleCategoryOf(pos){
  if(pos === 'GK') return 'Goalkeeper';
  if(['DR','DL','DC','DMR','DML','DMC'].includes(pos)) return 'Defence';
  if(['MR','ML','MC'].includes(pos)) return 'Midfield';
  if(['AMR','AML','AMC','ST'].includes(pos)) return 'Attack';
  return 'Unknown';
}

function roleColorOf(pos){
  if(pos === 'GK') return '#4AA8FF';
  if(['DL','DC','DR'].includes(pos)) return '#3ED98B';
  if(['DMC','DMR','DML','ML','MR','MC'].includes(pos)) return '#FFD84A';
  if(['AML','AMR','AMC','ST'].includes(pos)) return '#FF5A6E';
  return 'var(--ink-faint)';
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


const POSITION_ORDER = {GK:1,DL:2,DC:3,DR:4,DML:5,DMC:6,DMR:7,ML:8,MC:9,MR:10,AML:11,AMC:12,AMR:13,ST:14};
const ALL_POSITION_CODES = Object.keys(POSITION_ORDER);
function normaliseRoles(data){
  const raw=Array.isArray(data?.roles)?data.roles:(data?.position?[data.position]:[]);
  const roles=[]; raw.forEach(r=>{const p=normalisePosition(r); if(ALL_POSITION_CODES.includes(p)&&!roles.includes(p)) roles.push(p);});
  const primary=normalisePosition(data?.position); if(primary && ALL_POSITION_CODES.includes(primary) && !roles.includes(primary)) roles.unshift(primary);
  return roles.slice(0,3);
}
function playerRoles(player){ const roles=normaliseRoles(player); return roles.length?roles:[normalisePosition(player.position)]; }
function setCurrentRoles(roles, primary){
  currentRoles=[...new Set((roles||[]).map(normalisePosition).filter(r=>ALL_POSITION_CODES.includes(r)))].slice(0,3);
  if(primary){const p=normalisePosition(primary); if(currentRoles.includes(p)){currentRoles=[p,...currentRoles.filter(r=>r!==p)];}}
  currentPosition=currentRoles[0]||'';
  renderDetectedRoles();
}
function renderDetectedRoles(){
  const panel=document.getElementById('detectedRolesPanel'), list=document.getElementById('detectedRoleList'), count=document.getElementById('roleCountLabel');
  if(!panel||!list) return;
  if(!currentRoles.length){panel.style.display='none';list.innerHTML='';if(count)count.textContent='0 / 3';return;}
  panel.style.display='block'; if(count)count.textContent=`${currentRoles.length} / 3`;
  list.innerHTML=currentRoles.map(r=>`<button type="button" class="detected-role-btn ${r===currentPosition?'selected':''}" data-role-select="${r}">${r}${r===currentPosition?' · PRIMARY':''}</button>`).join('');
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-role-select]'); if(!b) return;
  const role=b.getAttribute('data-role-select');
  if(!currentRoles.includes(role)) return;
  currentRoles=[role,...currentRoles.filter(r=>r!==role)]; currentPosition=role;
  const pos=document.getElementById('posSelect'); if(pos)pos.value=role;
  renderDetectedRoles();
  renderAddSkillPreview(addPlayerSkills,currentPosition); renderSkillGroups(); renderDrillList();
});

async function populateTrainingPlayerPicker(selectedKey = trainingPlayerKey){
  const select = document.getElementById('trainingPlayerSelect');
  if(!select) return;
  const players = await getAllPlayers();
  players.sort((a,b) => (POSITION_ORDER[a.position]||99)-(POSITION_ORDER[b.position]||99) || String(a.name||'').localeCompare(String(b.name||''), undefined, {sensitivity:'base'}));
  const previous = selectedKey || '';
  select.innerHTML = '<option value="">— Select a player —</option>' + players.map(p => {
    const key = p.key || '';
    const label = `${p.name || '(unnamed)'}${p.position ? ' · ' + p.position : ''}`;
    return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
  }).join('');
  if(previous && players.some(p => p.key === previous)) select.value = previous;
  else select.value='';
}

function clearTrainingView(message='Select a saved player to load their skills.'){
  trainingPlayerKey=null;
  currentPosition='';
  const select=document.getElementById('trainingPlayerSelect'); if(select) select.value='';
  renderSkillGroups();
  renderDrillList();
  const results=document.getElementById('results'); if(results) results.style.display='none';
  const status=document.getElementById('trainingPlayerStatus');
  if(status){status.className='scan-status';status.textContent=message;}
}

async function selectTrainingPlayer(key){
  if(!key){ clearTrainingView(); return; }
  const data = await loadRawPlayer(key);
  if(!data){ clearTrainingView('Could not load that player.'); return; }
  trainingPlayerKey = key;
  currentRoles = normaliseRoles(data);
  currentPosition = currentRoles[0] || data.position || '';
  renderSkillGroups();
  Object.entries(data.skills || {}).forEach(([skill,val]) => {
    const el = document.getElementById(`skill-${skill}`);
    if(el) el.value = val;
  });
  renderDrillList();
  document.getElementById('results').style.display = 'none';
  const status = document.getElementById('trainingPlayerStatus');
  if(status){ status.className = 'scan-status ok'; status.textContent = `Loaded ✓ — ${data.name || 'Player'} (${data.position || '?'})`; }
}

function renderAddSkillPreview(skills={}, position=''){
  const el=document.getElementById('addSkillPreview'); if(!el) return;
  if(!position){el.innerHTML='<div class="ability-empty">Scan a player to see their detected skills here.</div>';return;}
  const groups=groupsFor(position); const white=POSITION_WHITE[position]||[];
  el.innerHTML=Object.entries(groups).map(([group,names])=>`<div class="skill-group"><div class="skill-group-label">${escapeHtml(group)}</div><div class="skill-grid">${names.map(skill=>{const val=Number(skills[skill]??0);return `<div class="skill-cell ${white.includes(skill)?'white':'grey'}"><label>${escapeHtml(skill)}</label><strong style="font-family:'JetBrains Mono',monospace;color:${white.includes(skill)?'var(--turf)':'var(--ink-faint)'}">${val}</strong></div>`;}).join('')}</div></div>`).join('');
}

function isIncompleteScan(player){
  const skills = player.skills || {};
  const pool = isGK(player.position) ? GK_APPLICABLE_POOL : OUTFIELD_SKILLS;
  const white = POSITION_WHITE[player.position] || [];
  return white.some(s => !(skills[s] > 0)) || pool.length === 0;
}

async function renderSquadGrid(){
  const container = document.getElementById('squadList');
  const emptyState = document.getElementById('squadEmptyState');
  if(!container) return;
  const players = await getAllPlayers();
  const positionOrder = POSITION_ORDER;
  players.sort((a,b)=>{
    const ai=positionOrder[a.position]||99, bi=positionOrder[b.position]||99;
    if(ai!==bi) return ai-bi;
    return String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base'});
  });
  if(players.length===0){ container.innerHTML=''; if(emptyState) emptyState.style.display='block'; return; }
  if(emptyState) emptyState.style.display='none';
  container.innerHTML = players.map(p => {
    const catColor=roleColorOf(p.position), incomplete=isIncompleteScan(p);
    const face=p.profileImage ? `<img src="${p.profileImage}" alt="" style="width:42px;height:42px;border-radius:9px;object-fit:cover;object-position:center top;border:1px solid var(--line);flex:0 0 42px;">` : '';
    return `<div class="squad-card" data-key="${escapeHtml(p.key)}">
      <div class="squad-card-main">${face}<div class="squad-card-role" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}55;">${p.position||'?'}</div>
        <div class="squad-card-info"><div class="squad-name-row"><div class="squad-card-name">${escapeHtml(p.name||'(unnamed)')}</div></div>
        <div class="squad-card-meta">${roleCategoryOf(p.position)}${p.ovr?' · OVR '+escapeHtml(p.ovr):''}${p.age?' · Age '+escapeHtml(p.age):''}${incomplete?' · <span style="color:var(--amber)">incomplete scan</span>':''}</div>
        <div>${normaliseAbilities(p).map(a=>`<span class="ability-chip">${escapeHtml(a)}</span>`).join('')}${normalisePlaystyle(p)?`<span class="playstyle-chip">${escapeHtml(normalisePlaystyle(p))}</span>`:''}</div></div></div>
      <button class="squad-card-delete" data-key="${escapeHtml(p.key)}" data-label="${escapeHtml(p.name||p.key)}">✕</button>
    </div>`;
  }).join('');
}

let squadDrag = null;
document.addEventListener('click', function(e){
  if(e.target.closest('[data-drag-handle]')) return;
  const delBtn = e.target.closest('.squad-card-delete');
  if(delBtn){
    e.stopPropagation();
    deletePlayerByKey(delBtn.getAttribute('data-key'), delBtn.getAttribute('data-label'), delBtn);
    return;
  }
  const card = e.target.closest('.squad-card');
  if(card){
    openPlayerProfile(card.getAttribute('data-key'));
  }
});

function normalisePlayerName(name){ return String(name||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''); }

async function extractPlayerFace(dataUrl){
  return new Promise((resolve)=>{
    const img=new Image();
    img.onload=()=>{
      try{
        // Standard Top Eleven player-card portrait area. Keep the full head and
        // upper body, then turn it into a circular professional portrait with
        // a clean branded backdrop.
        const sx=img.width*0.172, sy=img.height*0.008, sw=img.width*0.125, sh=img.height*0.395;
        const c=document.createElement('canvas'); c.width=320; c.height=320;
        const ctx=c.getContext('2d');
        const bg=ctx.createRadialGradient(160,115,20,160,160,225);
        bg.addColorStop(0,'#2b536c'); bg.addColorStop(.58,'#10283a'); bg.addColorStop(1,'#07121d');
        ctx.fillStyle=bg; ctx.fillRect(0,0,320,320);
        ctx.save(); ctx.beginPath(); ctx.arc(160,160,151,0,Math.PI*2); ctx.clip();
        const scale=Math.min(296/sw,296/sh);
        const dw=sw*scale, dh=sh*scale;
        ctx.drawImage(img,sx,sy,sw,sh,160-dw/2,160-dh/2,dw,dh);
        ctx.restore();
        ctx.beginPath(); ctx.arc(160,160,151,0,Math.PI*2); ctx.lineWidth=4; ctx.strokeStyle='rgba(238,246,251,.9)'; ctx.stroke();
        resolve(c.toDataURL('image/jpeg',0.86));
      }catch(_){ resolve(''); }
    };
    img.onerror=()=>resolve(''); img.src=dataUrl;
  });
}

async function findDuplicatePlayer(name, position, exceptKey=null){
  const wanted=normalisePlayerName(name);
  if(!wanted) return null;
  const players=await getAllPlayers();
  return players.find(p=>p.key!==exceptKey && normalisePlayerName(p.name)===wanted) || null;
}

function showToast(message, type='ok'){
  let el=document.getElementById('appToast');
  if(!el){el=document.createElement('div');el.id='appToast';el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:calc(100vw - 32px);padding:11px 16px;border-radius:9px;font:600 12px JetBrains Mono,monospace;box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center;';document.body.appendChild(el);}
  el.style.background=type==='err'?'#42151b':'#103c29'; el.style.color=type==='err'?'#ff9aa5':'#a8ffd0'; el.style.border='1px solid '+(type==='err'?'#ff5a6e':'#3ed98b'); el.textContent=message; el.style.display='block';
  clearTimeout(el._timer); el._timer=setTimeout(()=>el.style.display='none',2600);
}

async function savePlayer(){
  const statusEl=document.getElementById('saveStatus'); statusEl.className='scan-status';
  if(!currentPosition){statusEl.className='scan-status err';statusEl.textContent='Pick a role first.';return;}
  const name=(document.getElementById('nameInput').value||'').trim();
  if(!name){statusEl.className='scan-status err';statusEl.textContent='Enter a player name to save under.';return;}
  const duplicate=await findDuplicatePlayer(name,currentPosition,editingPlayerKey);
  if(duplicate){statusEl.className='scan-status err';statusEl.textContent=`Duplicate player — ${duplicate.name} is already in My Squad.`;showToast('Player already exists in My Squad.','err');return;}
  const slug=slugifyKey(name); if(!slug){statusEl.className='scan-status err';statusEl.textContent='That name has no usable characters — try letters or numbers.';return;}
  const key=editingPlayerKey || `player:${slug}_${Date.now().toString(36)}`;
  const selectedAbilities=getSelectedAbilities('addAbilityPicker');
  const selectedPlaystyle=getSelectedPlaystyle('addPlaystylePicker');
  const existing=await loadRawPlayer(key);
  const createdAt=existing?.createdAt||new Date().toISOString();
  const savedRoles=[...new Set([currentPosition,...currentRoles].filter(Boolean))].slice(0,3);
  const payload={...(existing||{}),name,position:currentPosition,roles:savedRoles,skills:{...addPlayerSkills},age:document.getElementById('ageInput').value.trim()===''?null:Number(document.getElementById('ageInput').value),ovr:document.getElementById('ovrInput').value.trim()===''?null:Number(document.getElementById('ovrInput').value),specialAbilities:selectedAbilities,specialAbility:'',playstyle:selectedPlaystyle,profileImage:pendingPlayerImage||existing?.profileImage||'',createdAt,updatedAt:new Date().toISOString()};
  statusEl.innerHTML='<span class="spinner"></span>Saving player…';
  const btn=document.getElementById('saveBtn'); btn.disabled=true;
  try{
    await window.storage.set(key,JSON.stringify(payload),false);
    currentPlayerKey=key; editingPlayerKey=null;
    await renderSquadGrid(); await populateTrainingPlayerPicker();
    statusEl.className='scan-status ok'; statusEl.textContent=`Saved ✓ — ${name}`;
    showToast(`${name} saved successfully ✓`);
    clearPlayerForm();
    await openPlayerProfile(key,true);
  }catch(err){console.error(err);statusEl.className='scan-status err';statusEl.textContent='Save failed: '+(err.message||err);showToast('Player could not be saved.','err');}
  finally{btn.disabled=false;}
}

async function loadRawPlayer(key){
  try{ const r=await window.storage.get(key,false); return r ? JSON.parse(r.value) : null; }catch(_){ return null; }
}

async function loadPlayerByKey(key){
  const loadStatus = document.getElementById('loadStatus');
  if(!key){ if(loadStatus){ loadStatus.className='scan-status err'; loadStatus.textContent='No player specified.'; } return false; }
  try{
    const data=await loadRawPlayer(key);
    if(!data){ if(loadStatus){loadStatus.className='scan-status err';loadStatus.textContent='Nothing found for that player.';} return false; }
    data.specialAbilities=normaliseAbilities(data);
    data.specialAbility='';
    currentPlayerKey=key;
    if(document.getElementById('posSelect')){
      currentRoles=normaliseRoles(data); currentPosition=currentRoles[0]||data.position||'';
      document.getElementById('posSelect').value=currentPosition; renderDetectedRoles();
    }
    if(document.getElementById('nameInput')) document.getElementById('nameInput').value=data.name||'';
    if(document.getElementById('ageInput')) document.getElementById('ageInput').value=data.age??'';
    if(document.getElementById('ovrInput')) document.getElementById('ovrInput').value=data.ovr??'';
    if(document.getElementById('playerTag')) document.getElementById('playerTag').textContent=data.name?`— ${data.name}`:'';
    renderAbilityPicker('addAbilityPicker',data.position||'',data.specialAbilities,false);
    renderAddSkillPreview(data.skills||{},data.position||'');
    if(loadStatus){loadStatus.className='scan-status ok';loadStatus.textContent=`Loaded ✓ — ${data.name||key}`;}
    return data;
  }catch(err){
    if(loadStatus){loadStatus.className='scan-status err';loadStatus.textContent='Load failed: '+(err.message||err);}
    console.error(err); return false;
  }
}

// Delete is a two-tap arm/confirm instead of window.confirm(), since native
// dialogs don't reliably appear inside this sandboxed webview.
// Two-tap arm/confirm delete, keyed by explicit key + a button element passed
// in (squad cards each have their own delete button, unlike the old single
// shared dropdown-delete button) so multiple cards can each arm independently.
const deleteArmedKeys = {};
async function deletePlayerByKey(key, label, btnEl){
  const loadStatus = document.getElementById('loadStatus');
  const setStatus = (cls, text) => { if(loadStatus){ loadStatus.className = cls; loadStatus.textContent = text; } };

  if(!deleteArmedKeys[key]){
    deleteArmedKeys[key] = true;
    if(btnEl) btnEl.textContent = 'Confirm?';
    setStatus('scan-status warn', 'Tap delete once more to permanently remove "' + label + '".');
    setTimeout(() => {
      if(deleteArmedKeys[key]){
        deleteArmedKeys[key] = false;
        if(btnEl) btnEl.textContent = '✕';
      }
    }, 4000);
    return;
  }

  deleteArmedKeys[key] = false;
  try{
    await window.storage.delete(key, false);
    await window.storage.delete(`session:${key.replace('player:','')}`, false).catch(()=>{});
    const order = await getSquadOrder();
    await saveSquadOrder(order.filter(k => k !== key));
    if(currentPlayerKey === key) currentPlayerKey = null;
    await renderSquadGrid();
    setStatus('scan-status ok', 'Deleted ✓');
  }catch(err){
    setStatus('scan-status err', 'Delete error: ' + (err && err.message ? err.message : String(err)));
    console.error(err);
  }
}

// --- Image scan via Claude vision ---
document.getElementById('fileInput').addEventListener('change', handleFile);
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover', e=>{e.preventDefault(); dz.classList.add('drag');});
dz.addEventListener('dragleave', ()=>dz.classList.remove('drag'));
dz.addEventListener('drop', e=>{
  e.preventDefault(); dz.classList.remove('drag');
  if(e.dataTransfer.files[0]) handleFile({target:{files:e.dataTransfer.files}});
});

function handleFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    document.getElementById('previewRow').style.display = 'flex';
    pendingPlayerImage = await extractPlayerFace(reader.result);
    document.getElementById('previewThumb').src = reader.result;
    scanImage(reader.result);
  };
  reader.readAsDataURL(file);
}

const ALL_SKILL_NAMES = OUTFIELD_SKILLS.concat(GK_SKILLS);

function normalizeForMatch(s){ return s.trim().toLowerCase().replace(/[^a-z]/g,''); }

// Small Levenshtein distance, used to tolerate OCR typos (e.g. "Retlexes" vs "Reflexes")
function levenshtein(a, b){
  const m = a.length, n = b.length;
  if(m === 0) return n;
  if(n === 0) return m;
  const dp = Array.from({length: m+1}, (_, i) => [i].concat(new Array(n).fill(0)));
  for(let j=0; j<=n; j++) dp[0][j] = j;
  for(let i=1; i<=m; i++){
    for(let j=1; j<=n; j++){
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Given a chunk of OCR'd label text, find the closest known skill name —
// tolerant of a few misread characters, since OCR on a compact game UI won't
// always be perfect even on clean text.
function matchSkillName(rawLabel){
  const norm = normalizeForMatch(rawLabel);
  if(norm.length < 3) return null;
  let best = null, bestDist = Infinity;
  ALL_SKILL_NAMES.forEach(skill => {
    const skillNorm = normalizeForMatch(skill);
    // exact or containment match — cheap and very reliable when it hits
    if(norm === skillNorm || norm.indexOf(skillNorm) !== -1 || skillNorm.indexOf(norm) !== -1){
      if(0 < bestDist){ best = skill; bestDist = 0; }
      return;
    }
    const dist = levenshtein(norm, skillNorm);
    const tolerance = Math.max(1, Math.floor(skillNorm.length * 0.25));
    if(dist <= tolerance && dist < bestDist){ best = skill; bestDist = dist; }
  });
  return best;
}

function findHeaderNumber(rows, labelRe){
  const isNum = t => /^\d{1,3}(?:\.5)?$/.test(String(t).trim().replace(/[^0-9.]/g,''));
  for(const row of rows){
    const labelIndex = row.words.findIndex(w => labelRe.test(w.text.trim()));
    if(labelIndex < 0) continue;
    for(let i=labelIndex+1;i<row.words.length;i++){
      const t = row.words[i].text.trim().replace(/[^0-9.]/g,'');
      if(isNum(t)) return Number(t);
    }
    const labelWord = row.words[labelIndex];
    let best = null, bestDist = Infinity;
    rows.forEach(r => {
      if(Math.abs(r.cy-row.cy) > 90) return;
      r.words.forEach(w => {
        const t = w.text.trim().replace(/[^0-9.]/g,'');
        if(!isNum(t)) return;
        const dx = w.bbox.x0 - labelWord.bbox.x1;
        const dy = Math.abs(((w.bbox.y0+w.bbox.y1)/2) - labelWord.bbox.y1);
        if(dx < -40 || dx > 500) return;
        const dist = dy*2 + Math.max(0,dx);
        if(dist < bestDist){bestDist=dist; best=Number(t);}
      });
    });
    if(best !== null) return best;
  }
  return null;
}

function findOvrNumber(rows, imageWidth, imageHeight, ageValue){
  // Top Eleven's OVR is a prominent 2–3 digit number in the player header.
  // OCR may miss the stylised "OVR" letters, so use the number's header position
  // as a fallback instead of inventing a value from the skills grid.
  const labelWords = [];
  rows.forEach(r => r.words.forEach(w => {
    const t=w.text.trim().toLowerCase().replace(/[^a-z]/g,'');
    if(t==='ovr' || levenshtein(t,'ovr')<=1) labelWords.push(w);
  }));
  const nums=[];
  rows.forEach(r => r.words.forEach(w => {
    const raw=w.text.trim().replace(/[^0-9]/g,'');
    if(!/^\d{2,3}$/.test(raw)) return;
    const n=Number(raw);
    if(n<50 || n>300) return;
    const cy=(w.bbox.y0+w.bbox.y1)/2;
    if(cy > imageHeight*0.34) return;
    nums.push({n,w,cy});
  }));
  if(!nums.length) return null;
  if(labelWords.length){
    let best=null,score=Infinity;
    labelWords.forEach(lw=>nums.forEach(x=>{
      const lx=(lw.bbox.x0+lw.bbox.x1)/2, ly=(lw.bbox.y0+lw.bbox.y1)/2;
      const nx=(x.w.bbox.x0+x.w.bbox.x1)/2;
      const d=Math.abs(ly-x.cy)*2 + Math.max(0,nx-lw.bbox.x1)*0.35;
      if(d<score){score=d;best=x.n;}
    }));
    if(best!==null) return best;
  }
  // If Age was detected, never reuse it as OVR. Prefer a number in the upper
  // header and, among candidates, the one furthest from the age label region.
  const ageCandidates=nums.filter(x => x.n !== Number(ageValue));
  if(ageCandidates.length===1) return ageCandidates[0].n;
  ageCandidates.sort((a,b)=>a.cy-b.cy);
  return ageCandidates[0]?.n ?? null;
}

function detectHeaderMetadata(words, rows, rawText, imageHeight=1000, imageWidth=1000){
  const sortedRows = [...rows].sort((a,b)=>a.cy-b.cy);
  const skillGroupLabels = new Set(['defence','defense','attack','physical','goalkeeping','skills','overview','playstyle','stats']);
  const blocked = new Set([
    'age','team','roles','role','special','ability','ovr','rare','elite','stellar','epic','legendary','master','diamond',
    'overview','skills','playstyle','stats','personal','trainer','contract','defence','defense','attack','physical',
    'goalkeeping','goalkeeper','condition','morale','training','level','position','positions','player','quality','quality%',
    'market','value','salary','tokens','cash','green','blue','red','white','mental','passing','finishing','heading','dribbling',
    'crossing','shooting','tackling','marking','speed','strength','stamina','creativity','passing','reflexes','handling','kicking','oneonone'
  ]);
  ALL_SKILL_NAMES.forEach(n => blocked.add(n.toLowerCase()));
  const positions = new Set(Object.keys(POSITION_WHITE));

  // The player's name is in the upper header of a Top Eleven Skills screen.
  // The old detector searched the whole screenshot and therefore happily
  // selected "DEFENCE ATTACK PHYSICAL" as a name. Restricting the candidate
  // area to the upper ~32% and excluding every skill/group label prevents that.
  const headerCutoff = imageHeight * 0.34;
  const candidates = [];
  sortedRows.forEach(row => {
    if(row.cy > headerCutoff) return;
    const toks = row.words.map(w=>w.text.trim())
      .filter(t=>/^[A-Za-z][A-Za-z'’.-]{1,}$/.test(t));
    const clean = toks.filter(t=>{
      const low=t.toLowerCase();
      return !blocked.has(low) && !positions.has(t.toUpperCase()) && !/^(ovr|age|roles?)$/i.test(t);
    });
    // A real Top Eleven player name is normally at least two words. Never
    // accept a lone OCR token (e.g. a random 'Karen' hallucination) as a name.
    if(clean.length < 2 || clean.length > 3) return;
    const minX = Math.min(...row.words.map(w => w.bbox.x0));
    const maxX = Math.max(...row.words.map(w => w.bbox.x1));
    const center = (minX+maxX)/2;
    const confs = row.words.map(w=>Number.isFinite(w.confidence)?w.confidence:50);
    const conf = confs.reduce((a,b)=>a+b,0)/confs.length;
    // Names are normally left/centre aligned in the player header, not a
    // full-width section heading. Prefer 2-word names and readable OCR.
    const score = (clean.length === 2 ? 65 : 42)
      + conf * 0.35
      + (center < imageWidth*0.62 ? 15 : 0)
      - (center > imageWidth*0.78 ? 25 : 0)
      - row.cy/(imageHeight||1000)*20;
    candidates.push({name:clean.join(' '),score,cy:row.cy,conf});
  });
  candidates.sort((a,b)=>b.score-a.score);
  let name = candidates[0]?.name || '';

  // Reject obvious OCR artefacts and common UI phrases even if they slipped
  // through the token filter.
  if(name && /^(defence|defense|attack|physical)(\s+(defence|defense|attack|physical)){0,2}$/i.test(name)) name='';
  if(name && candidates[0] && candidates[0].conf < 50) name='';

  // OVR gets its own detector. First try the literal OCR text for the very
  // common 'OVR 116' pattern, then fall back to the spatial label/number
  // detector. This prevents unrelated numbers elsewhere in the skills grid
  // being mistaken for OVR.
  let ovr = null;
  const rawOvr = String(rawText || '').match(/\bOVR\s*[:=\-]?\s*(\d{2,3})\b/i);
  if(rawOvr) ovr = Number(rawOvr[1]);
  if(ovr === null) ovr = findHeaderNumber(sortedRows, /^OVR:?$/i);
  const age = findHeaderNumber(sortedRows, /^Age:?$/i);
  if(ovr === null) ovr = findOvrNumber(sortedRows, imageWidth, imageHeight, age);
  if(ovr !== null && (ovr < 50 || ovr > 300 || (age !== null && ovr === age))) ovr = null;

  let specialAbility = '';
  for(const row of sortedRows){
    if(row.cy > headerCutoff) break;
    const idx = row.words.findIndex(w => /^special$/i.test(w.text.trim()));
    if(idx >= 0){
      const tail = row.words.slice(idx+1).map(w=>w.text.trim()).filter(t=>/^[A-Za-z][A-Za-z -]{2,}$/.test(t));
      const text = tail.join(' ').replace(/\s+/g,' ').trim();
      if(text && !/^ability$/i.test(text)) { specialAbility = text; break; }
    }
  }
  return {name, age, ovr, specialAbility};
}

async function makeHeaderOCR(dataUrl){
  // Run a second, focused OCR pass over the player-header area. This is much
  // more reliable for Name / Age / OVR than asking one OCR pass to understand
  // the entire skills grid at once.
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = async () => {
      try{
        const h = Math.max(1, Math.floor(img.height * 0.36));
        const c = document.createElement('canvas');
        const scale = 2;
        c.width = img.width * scale;
        c.height = h * scale;
        const ctx = c.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(img, 0, 0, img.width, h, 0, 0, c.width, c.height);
        const headerUrl = c.toDataURL('image/jpeg', 0.92);
        const r = await Tesseract.recognize(headerUrl, 'eng', {
          logger: ()=>{},
          config: { tessedit_pageseg_mode: '11' }
        });
        resolve(r.data);
      }catch(e){ reject(e); }
    };
    img.onerror=()=>reject(new Error('Could not prepare header image'));
    img.src=dataUrl;
  });
}

async function makeOvrOCR(dataUrl){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=async()=>{
      try{
        // The OVR block is consistently in the upper-left portion of the Top Eleven
        // player header. A tight crop prevents skill values such as 137/167/152
        // from competing with the actual OVR. Multiple preprocessing variants
        // handle the gold background and white stylised digits.
        const sx=img.width*0.22, sy=img.height*0.12, sw=img.width*0.16, sh=img.height*0.11;
        const c=document.createElement('canvas'); c.width=Math.max(1,Math.floor(sw*4)); c.height=Math.max(1,Math.floor(sh*4));
        const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
        const base=ctx.getImageData(0,0,c.width,c.height);
        const variants=[];
        const gray=new Uint8ClampedArray(c.width*c.height*4);
        for(let i=0;i<base.data.length;i+=4){
          const y=0.299*base.data[i]+0.587*base.data[i+1]+0.114*base.data[i+2];
          const v=Math.max(0,Math.min(255,(y-75)*2.2)); gray[i]=gray[i+1]=gray[i+2]=v; gray[i+3]=255;
        }
        const gc=document.createElement('canvas'); gc.width=c.width; gc.height=c.height; gc.getContext('2d').putImageData(new ImageData(gray,c.width,c.height),0,0);
        variants.push(c.toDataURL('image/png'),gc.toDataURL('image/png'));
        let best=null;
        for(const url of variants){
          const r=await Tesseract.recognize(url,'eng',{logger:()=>{},config:{tessedit_pageseg_mode:'11',tessedit_char_whitelist:'0123456789OVR'}});
          const text=String(r.data?.text||'');
          const matches=[...text.matchAll(/(?<!\d)(\d{2,3})(?!\d)/g)].map(m=>Number(m[1])).filter(n=>n>=50&&n<=300);
          const words=(r.data?.words||[]).map(w=>({text:String(w.text||''),confidence:Number(w.confidence)||0,bbox:w.bbox}));
          for(const w of words){ const n=Number(String(w.text).replace(/[^0-9]/g,'')); if(n>=50&&n<=300) matches.push(n); }
          if(matches.length){
            // Prefer the most common candidate; in this crop there should only be
            // one real 2–3 digit value.
            const counts={}; matches.forEach(n=>counts[n]=(counts[n]||0)+1);
            const candidate=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
            best=Number(candidate); break;
          }
        }
        resolve(best);
      }catch(e){reject(e);}
    };
    img.onerror=()=>reject(new Error('Could not prepare OVR crop')); img.src=dataUrl;
  });
}

async function makeRolesOCR(dataUrl){
  return new Promise((resolve,reject)=>{
    const img=new Image(); img.onload=async()=>{ try{
      // The Roles chips sit in the upper-middle/right header of the standard
      // Top Eleven Skills screen. A focused pass avoids confusing skill labels
      // with position codes and can read up to three visible roles.
      const sx=img.width*0.53, sy=img.height*0.16, sw=img.width*0.23, sh=img.height*0.14;
      const c=document.createElement('canvas'); c.width=Math.max(1,Math.floor(sw*4)); c.height=Math.max(1,Math.floor(sh*4));
      c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
      const r=await Tesseract.recognize(c.toDataURL('image/png'),'eng',{logger:()=>{},config:{tessedit_pageseg_mode:'11',tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'}});
      resolve(String(r.data?.text||''));
    }catch(e){reject(e);} }; img.onerror=()=>reject(new Error('Could not prepare roles crop')); img.src=dataUrl;
  });
}

async function scanImage(dataUrl){
  const preservedAbilities=getSelectedAbilities('addAbilityPicker');
  const status = document.getElementById('scanStatus');
  const note = document.getElementById('scanNote');
  note.style.display = 'none';
  status.className = 'scan-status';
  status.innerHTML = '<span class="spinner"></span>Loading OCR engine (first scan only, a few MB)…';

  try{
    if(typeof Tesseract === 'undefined'){
      throw new Error('OCR library failed to load — check your connection and try again.');
    }

    const result = await Tesseract.recognize(dataUrl, 'eng', {
      logger: (m) => {
        if(m.status === 'recognizing text'){
          status.innerHTML = `<span class="spinner"></span>Reading skills… ${Math.round((m.progress||0)*100)}%`;
        }
      }
    });

    const data = result.data;
    const words = (data.words || []).filter(w => w.text && w.text.trim() && (w.confidence === undefined || w.confidence > 25));

    if(words.length === 0){
      throw new Error('No readable text found in that image — try a clearer, more direct screenshot.');
    }

    // Group words into rows by vertical position, since the skills screen is a
    // 2-column grid: each row has up to two (label, number) pairs side by side.
    const sorted = [...words].sort((a,b) => a.bbox.y0 - b.bbox.y0);
    const rows = [];
    const rowHeight = (sorted.reduce((sum,w) => sum + (w.bbox.y1 - w.bbox.y0), 0) / sorted.length) || 20;
    sorted.forEach(w => {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2;
      let row = rows.find(r => Math.abs(r.cy - cy) < rowHeight * 0.6);
      if(!row){ row = {cy, words: []}; rows.push(row); }
      row.words.push(w);
      row.cy = (row.cy * (row.words.length-1) + cy) / row.words.length;
    });
    rows.forEach(r => r.words.sort((a,b) => a.bbox.x0 - b.bbox.x0));

    // Walk each row left-to-right, accumulating label text until a number is
    // hit, then match that accumulated label against the known skill list —
    // this naturally handles the 2-per-row layout without needing fixed column coordinates.
    const foundSkills = {};
    rows.forEach(row => {
      let labelBuffer = [];
      row.words.forEach(w => {
        const t = w.text.trim();
        if(/^\d{1,3}$/.test(t)){
          const label = labelBuffer.join(' ');
          const matched = matchSkillName(label);
          if(matched){ foundSkills[matched] = Number(t); }
          labelBuffer = [];
        } else if(/^[A-Za-z]+$/.test(t)){
          labelBuffer.push(t);
        } else {
          labelBuffer = [];
        }
      });
    });

    if(Object.keys(foundSkills).length === 0){
      throw new Error('Could not match any skill names — try a screenshot with more of the skills list visible, or enter values manually.');
    }

    // Both name and role sit in the header area above the skills grid, so we
    // reuse the same row-clustering already built for skill parsing rather
    // than re-scanning raw text — that's what makes role detection reliable
    // even if the literal word "Roles" itself gets misread, and lets us pull
    // a best-effort name from the very top row instead of leaving it blank.
    const rowsSortedByY = [...rows].sort((a,b) => a.cy - b.cy);

    // Role: scan rows top-to-bottom for any standalone token that's an exact
    // match for a real position code (DR, DL, DC, MC, AMC, ST, GK, etc.) —
    // this catches dual-role players (e.g. "DL DC" shown side by side) since
    // it just takes the first valid code encountered, and doesn't depend on
    // the word "Roles" being read correctly at all.
    const POSITION_CODES = ALL_POSITION_CODES;
    let detectedRoles = [];
    // Roles live in the player header, around the Roles label. Restrict the OCR
    // search to the upper third and collect every distinct position code found.
    for(const row of rowsSortedByY){
      if(row.cy > Math.min(340, Math.max(...words.map(w=>w.bbox.y1),1000)*0.34)) continue;
      for(const w of row.words){
        const t = w.text.trim().toUpperCase();
        if(POSITION_CODES.includes(t) && !detectedRoles.includes(t)) detectedRoles.push(t);
      }
    }
    if(!detectedRoles.length){
      const gkHits = GK_SKILLS.filter(s => foundSkills[s] !== undefined).length;
      if(gkHits >= 3) detectedRoles=['GK'];
    }
    detectedRoles=detectedRoles.slice(0,3);
    const detectedRole = detectedRoles[0] || '';

    let headerMeta = detectHeaderMetadata(words, rows, data.text || '', Math.max(...words.map(w=>w.bbox.y1), 1000), Math.max(...words.map(w=>w.bbox.x1), 1000));
    // Focused header OCR gets a separate chance to read the name/OVR/age.
    try{
      const headerData = await makeHeaderOCR(dataUrl);
      const hWords = (headerData.words || []).filter(w => w.text && w.text.trim() && (w.confidence === undefined || w.confidence > 20));
      const hSorted = [...hWords].sort((a,b)=>a.bbox.y0-b.bbox.y0);
      const hRows=[];
      const hAvg=(hSorted.reduce((sum,w)=>sum+(w.bbox.y1-w.bbox.y0),0)/Math.max(1,hSorted.length))||20;
      hSorted.forEach(w=>{
        const cy=(w.bbox.y0+w.bbox.y1)/2;
        let row=hRows.find(r=>Math.abs(r.cy-cy)<hAvg*0.7);
        if(!row){row={cy,words:[]};hRows.push(row);}
        row.words.push(w); row.cy=(row.cy*(row.words.length-1)+cy)/row.words.length;
      });
      hRows.forEach(r=>r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0));
      const focused=detectHeaderMetadata(hWords,hRows,headerData.text||'',Math.max(...hWords.map(w=>w.bbox.y1),1000),Math.max(...hWords.map(w=>w.bbox.x1),1000));
      // Prefer focused header results, but keep the full-image result if the
      // focused pass could not read a field.
      headerMeta={
        name: focused.name || headerMeta.name,
        age: focused.age ?? headerMeta.age,
        ovr: focused.ovr ?? headerMeta.ovr,
        specialAbility: focused.specialAbility || headerMeta.specialAbility
      };
    }catch(_){ /* full-image OCR result is still usable */ }
    // Final OVR rescue pass. This is intentionally independent from the normal
    // header OCR because the large white OVR digits are often segmented poorly
    // by full-screen OCR even though they are visually obvious.
    try{ const rescueOvr=await makeOvrOCR(dataUrl); if(rescueOvr!==null) headerMeta.ovr=rescueOvr; }catch(_){ }
    try{
      const roleText=await makeRolesOCR(dataUrl);
      const roleMatches=[...roleText.toUpperCase().matchAll(/\b(?:GK|DL|DC|DR|DML|DMC|DMR|ML|MC|MR|AML|AMC|AMR|ST)\b/g)].map(m=>m[0]);
      roleMatches.forEach(r=>{if(!detectedRoles.includes(r))detectedRoles.push(r);});
      detectedRoles=detectedRoles.slice(0,3);
    }catch(_){ }
    if(detectedRoles.length){ detectedRole=detectedRoles[0]; }
    const detectedName = headerMeta.name;
    const detectedAge = headerMeta.age;
    const detectedOvr = headerMeta.ovr;
    const detectedSpecialAbility = '';

    if(detectedRole && POSITION_WHITE[detectedRole]){
      currentRoles=detectedRoles; currentPosition=detectedRole;
      document.getElementById('posSelect').value = detectedRole;
      renderDetectedRoles();
    }

    if(detectedAge !== null) document.getElementById('ageInput').value = detectedAge;
    if(detectedOvr !== null) document.getElementById('ovrInput').value = detectedOvr;

    // Name handling: never silently overwrite a name that's already in the
    // field (e.g. you Loaded a player, then rescanned their new screenshot —
    // OCR misreading their name slightly shouldn't cost you that link). If
    // the field is empty, a confident multi-word detection can fill
    // it directly. Either way, show what was detected as a tappable suggestion
    // so you can always see and correct it rather than guess what happened.
    const nameField = document.getElementById('nameInput');
    const nameSuggestBox = document.getElementById('nameSuggestBox');
    if(detectedName && !nameField.value.trim()){
      nameField.value = detectedName;
      document.getElementById('playerTag').textContent = `— ${detectedName}`;
    }
    if(nameSuggestBox){
      if(detectedName){
        nameSuggestBox.style.display = 'flex';
        nameSuggestBox.innerHTML = `<span>Detected name: <b>${detectedName}</b></span><button type="button" id="useDetectedNameBtn">Use this</button>`;
        document.getElementById('useDetectedNameBtn').addEventListener('click', () => {
          nameField.value = detectedName;
          document.getElementById('playerTag').textContent = `— ${detectedName}`;
          nameSuggestBox.style.display = 'none';
        });
      } else {
        nameSuggestBox.style.display = 'none';
      }
    }

    addPlayerSkills={};
    Object.entries(foundSkills).forEach(([skill,val]) => { addPlayerSkills[skill]=val; });
    renderAddSkillPreview(addPlayerSkills, currentPosition);
    renderSkillGroups();
    renderDrillList();
    renderAbilityPicker('addAbilityPicker', currentPosition, preservedAbilities, false);
    const preservedPlaystyle=getSelectedPlaystyle('addPlaystylePicker');
    renderPlaystylePicker('addPlaystylePicker', currentPosition, preservedPlaystyle, false);

    const missingMeta = [];
    if(!detectedName) missingMeta.push('name');
    if(detectedAge === null) missingMeta.push('age');
    if(detectedOvr === null) missingMeta.push('OVR');
    if(!detectedRole) missingMeta.push('role');
    if(missingMeta.length){
      note.style.display = 'flex';
      note.className = 'note warn';
      note.innerHTML = `⚠️ <span>Couldn't confidently read: <b>${missingMeta.join(', ')}</b>. Check the fields before saving. Special ability is often shown as an icon in Top Eleven, so it may need to be entered manually.</span>`;
    }

    const matchedCount = Object.keys(foundSkills).length;
    status.className = 'scan-status ok';
    status.textContent = `Scanned ✓ — matched ${matchedCount} skill${matchedCount===1?'':'s'}${detectedName ? ' and player details' : ''}. Header fields were read separately; check them before saving.`;
  } catch(err){
    status.className = 'scan-status err';
    status.textContent = 'Scan failed: ' + err.message;
    console.error(err);
  }
}

window.addEventListener('error', function(e){
  const bar = document.getElementById('globalErrorBar');
  if(bar){ bar.style.display = 'block'; bar.textContent = 'Script error: ' + e.message + ' (line ' + e.lineno + ')'; }
});

document.getElementById('saveBtn').addEventListener('click', savePlayer);
document.getElementById('buildBtn').addEventListener('click', buildSession);

function clearPlayerForm(){
  editingPlayerKey=null; currentPosition=''; currentRoles=[]; addPlayerSkills={}; pendingPlayerImage='';
  document.getElementById('nameInput').value='';
  document.getElementById('ageInput').value='';
  document.getElementById('ovrInput').value='';
  document.getElementById('playerTag').textContent='';
  document.getElementById('posSelect').value='';
  renderDetectedRoles();
  document.getElementById('saveBtn').textContent='💾 Save Player';
  document.getElementById('addPlayerTitle').textContent='Add Player';
  document.getElementById('addPlayerSubtitle').textContent='Upload a Skills screenshot, review the scan, choose their role and special abilities, then save them to My Squad.';
  document.getElementById('previewRow').style.display='none';
  document.getElementById('nameSuggestBox').style.display='none';
  document.getElementById('scanNote').style.display='none';
  document.getElementById('fileInput').value='';
  renderAbilityPicker('addAbilityPicker','',[],false);
  renderPlaystylePicker('addPlaystylePicker','', '', false);
  const psCount=document.getElementById('addPlaystyleCount'); if(psCount)psCount.textContent='0 / 1';
  const count=document.getElementById('addAbilityCount'); if(count)count.textContent='0 / 2';
  renderAddSkillPreview({},'');
  const loadStatus=document.getElementById('loadStatus');
  if(loadStatus){loadStatus.className='scan-status ok';loadStatus.textContent='Ready for a new player.';}
}

renderSkillGroups();
renderDrillList();

// ============================================================
// PAGE NAVIGATION SHELL
// ============================================================
const PAGES = ['dashboard','squad','add-player','training','player','formation','playmakers','mentors','tactics','settings'];
let currentPage='dashboard';
let suppressHistory=false;

function showPage(pageId, persist=true, options={}){
  if(!PAGES.includes(pageId)) pageId='dashboard';
  if(pageId===currentPage && persist && !options.force){ return; }
  if(pageId==='training' && !options.preserveTraining) clearTrainingView();
  currentPage=pageId;
  if(persist && !suppressHistory){
    try{
      history.pushState({teApp:true,page:pageId,playerKey:currentPlayerKey},'', '#'+pageId+(pageId==='player'&&currentPlayerKey?'?player='+encodeURIComponent(currentPlayerKey):''));
      localStorage.setItem('te:lastPage',pageId);
      if(currentPlayerKey)localStorage.setItem('te:lastPlayerKey',currentPlayerKey);
    }catch(_){}
  }
  PAGES.forEach(p=>{const el=document.getElementById('page-'+p);if(el)el.style.display=p===pageId?'block':'none';});
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.getAttribute('data-page')===pageId));
  window.scrollTo(0,0);
  if(pageId==='dashboard') renderDashboard();
  if(pageId==='squad') renderSquadGrid();
  if(pageId==='add-player'){
    renderAbilityPicker('addAbilityPicker',currentPosition,getSelectedAbilities('addAbilityPicker'),false);
    renderPlaystylePicker('addPlaystylePicker',currentPosition,getSelectedPlaystyle('addPlaystylePicker'),false);
    renderAddSkillPreview(addPlayerSkills,currentPosition);
  }
  if(pageId==='training') populateTrainingPlayerPicker(trainingPlayerKey);
  if(pageId==='playmakers') renderPlaymakers();
  if(pageId==='mentors') renderMentors();
  if(pageId==='tactics'){ renderTactics(); renderTacticalPresets(); }
}

function navigateBackFallback(){
  const fallback={player:'squad','training':'squad','add-player':'squad',squad:'dashboard',formation:'dashboard',playmakers:'dashboard',mentors:'dashboard',tactics:'dashboard',settings:'dashboard'};
  showPage(fallback[currentPage]||'dashboard');
}

function closeNavDrawer(){
  const drawer = document.getElementById('navDrawer');
  const overlay = document.getElementById('navDrawerOverlay');
  if(drawer) drawer.classList.remove('open');
  if(overlay) overlay.classList.remove('open');
}
function toggleNavDrawer(){
  const drawer = document.getElementById('navDrawer');
  const overlay = document.getElementById('navDrawerOverlay');
  if(!drawer) return;
  const isOpen = drawer.classList.toggle('open');
  if(overlay) overlay.classList.toggle('open', isOpen);
}
const hamburgerBtn = document.getElementById('hamburgerBtn');
if(hamburgerBtn) hamburgerBtn.addEventListener('click', toggleNavDrawer);
const navDrawerOverlay = document.getElementById('navDrawerOverlay');
if(navDrawerOverlay) navDrawerOverlay.addEventListener('click', closeNavDrawer);
const navDrawerVersion = document.getElementById('navDrawerVersion');
if(navDrawerVersion) navDrawerVersion.textContent = 'v3.0.0';

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => { showPage(el.getAttribute('data-page')); closeNavDrawer(); });
});

const squadAddPlayerBtn=document.getElementById('squadAddPlayerBtn');
if(squadAddPlayerBtn) squadAddPlayerBtn.addEventListener('click',()=>{clearPlayerForm();showPage('add-player');});
const dashEmptyAddBtn=document.getElementById('dashEmptyAddBtn');
if(dashEmptyAddBtn) dashEmptyAddBtn.addEventListener('click',()=>{clearPlayerForm();showPage('add-player');});

window.addEventListener('popstate',e=>{
  const state=e.state?.teApp ? e.state : null;
  const page=state?.page || (location.hash ? location.hash.slice(1).split('?')[0] : null);
  if(page==='player' && state?.playerKey){ openPlayerProfile(state.playerKey,false); return; }
  if(page && PAGES.includes(page)){ suppressHistory=true; showPage(page,false,{preserveTraining:true}); suppressHistory=false; }
  else navigateBackFallback();
});

if(!history.state?.teApp){ try{const base=location.href.split('#')[0]; history.replaceState({teApp:true,page:initialPage},'',base+'#'+initialPage); history.pushState({teApp:true,page:initialPage},'',base+'#'+initialPage);}catch(_){} }


// ============================================================
// DASHBOARD — every number here is computed from real stored
// players. Nothing here is fabricated; anything we can't
// honestly compute (quality %, condition, morale, match info)
// is simply not shown, since this app has never scanned that data.
// ============================================================
async function renderDashboard(){
  const players = await getAllPlayers();
  const empty = document.getElementById('dashboardEmpty');
  const content = document.getElementById('dashboardContent');
  if(players.length === 0){
    if(empty) empty.style.display = 'block';
    if(content) content.style.display = 'none';
    return;
  }
  if(empty) empty.style.display = 'none';
  if(content) content.style.display = 'block';

  document.getElementById('statTotalPlayers').textContent = players.length;
  const ovrs=players.map(p=>Number(p.ovr||0)).filter(v=>v>0);
  const avgOvr=ovrs.length?Math.round(ovrs.reduce((a,b)=>a+b,0)/ovrs.length):'—';
  const top=[...players].sort((a,b)=>Number(b.ovr||0)-Number(a.ovr||0))[0];
  document.getElementById('statAvgOvr').textContent=avgOvr; document.getElementById('statTopOvr').textContent=top?.ovr||'—';
  document.getElementById('statRolesCovered').textContent=new Set(players.flatMap(playerRoles)).size;
  const strongest=top?.name||'—'; document.getElementById('dashTopPlayer').textContent=strongest;
  const groupAvg=(names)=>{const vals=players.map(p=>avgSkill(p,names)).filter(v=>v>0);return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):'—';};
  document.getElementById('dashDefAvg').textContent=groupAvg(['Tackling','Marking','Positioning','Heading','Bravery']);
  document.getElementById('dashMidAvg').textContent=groupAvg(['Passing','Dribbling','Creativity','Positioning']);
  document.getElementById('dashAttAvg').textContent=groupAvg(['Shooting','Finishing','Dribbling','Creativity']);

  const byCategory = {};
  players.forEach(p => {
    const cat = roleCategoryOf(p.position);
    byCategory[cat] = (byCategory[cat]||0) + 1;
  });
  const catOrder = ['Goalkeeper','Defence','Midfield','Attack','Unknown'];
  document.getElementById('statByPosition').innerHTML = catOrder
    .filter(c => byCategory[c])
    .map(c => `<div class="dash-row"><span>${c}</span><span>${byCategory[c]}</span></div>`)
    .join('') || '<div class="dash-row"><span>No roles set yet</span></div>';

  const coverageEl=document.getElementById('dashPositionCoverage');
  if(coverageEl){ coverageEl.innerHTML=Object.keys(POSITION_ORDER).map(pos=>{const n=players.filter(p=>playerRoles(p).includes(pos)).length;return `<div class="dash-row"><span>${pos}</span><span style="color:${n?'var(--turf)':'var(--ink-faint)'}">${n}</span></div>`;}).join(''); }

  const incomplete = players.filter(isIncompleteScan);
  const attentionEl = document.getElementById('statNeedsAttention');
  attentionEl.innerHTML = incomplete.length
    ? incomplete.slice(0,5).map(p => `<div class="dash-row"><span>${p.name||p.key}</span><span style="color:var(--amber)">incomplete</span></div>`).join('')
    : '<div class="dash-row"><span style="color:var(--turf)">All scanned players look complete ✓</span></div>';

  const recent = [...players].sort((a,b) => new Date(b.updatedAt||b.createdAt||0) - new Date(a.updatedAt||a.createdAt||0)).slice(0,5);
  document.getElementById('statRecent').innerHTML = recent.map(p => {
    const when = p.updatedAt || p.createdAt;
    const dateStr = when ? new Date(when).toLocaleDateString() : 'unknown date';
    return `<div class="dash-row"><span>${p.name||p.key} <span style="color:var(--ink-faint)">(${p.position||'?'})</span></span><span>${dateStr}</span></div>`;
  }).join('') || '<div class="dash-row"><span>—</span></div>';
}

// ============================================================
// PLAYER PROFILE — every operation is keyed to the selected player's storage key.
// ============================================================
async function savePlayerRecordByKey(key, changes){
  const data=await loadRawPlayer(key);
  if(!data) return false;
  const updated={...data,...changes,updatedAt:new Date().toISOString(),roles:normaliseRoles(changes),specialAbilities:normaliseAbilities(changes),playstyle:normalisePlaystyle(changes),specialAbility:''};
  await window.storage.set(key,JSON.stringify(updated),false);
  return updated;
}

function setProfileEditMode(enabled){
  profileEditMode=enabled;
  ['profileName','profileAge','profileOvr','profilePosition'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!enabled;});
  const actions=document.getElementById('profileActions'); const editActions=document.getElementById('profileEditActions');
  if(actions) actions.style.display=enabled?'none':'flex';
  if(editActions) editActions.style.display=enabled?'flex':'none';
}

function renderProfileSkills(data, editable=false){
  const barsEl=document.getElementById('profileBars'); if(!barsEl) return;
  const position=data.position||''; const white=POSITION_WHITE[position]||[]; const pool=displaySkillsFor(position);
  if(!position){barsEl.innerHTML='<div class="ability-empty">No role assigned.</div>';return;}
  barsEl.innerHTML=pool.map(s=>{
    const val=Number((data.skills||{})[s]||0); const isWhite=white.includes(s); const pct=Math.min(val/220*100,100);
    return `<div class="bar-row">
      <div class="bar-label" style="${isWhite?'color:var(--ink);font-weight:600;':'color:var(--ink-faint);'}">${escapeHtml(s)}</div>
      ${editable ? `<input class="profile-skill-input" type="number" min="0" max="300" data-profile-skill="${escapeHtml(s)}" value="${val}">` : `<div class="bar-track"><div class="bar-fill ${isWhite?'':'grey-bar'}" style="width:${pct}%"></div></div><div class="bar-val">${val}</div>`}
    </div>`;
  }).join('');
}

async function openPlayerProfile(key,pushHistory=true){
  const data=await loadRawPlayer(key); if(!data) return;
  data.specialAbilities=normaliseAbilities(data); data.specialAbility='';
  currentPlayerKey=key;
  profileEditMode=false;
  const abilities=normaliseAbilities(data);
  document.getElementById('profileName').value=data.name||'';
  document.getElementById('profilePosition').value=data.position||'';
  document.getElementById('profileMeta').textContent=roleCategoryOf(data.position)+' · Roles: '+normaliseRoles(data).join(' / ')+(data.updatedAt?' · updated '+new Date(data.updatedAt).toLocaleDateString():'');
  document.getElementById('profileAge').value=data.age??'';
  document.getElementById('profileOvr').value=data.ovr??'';
  renderAbilityChips('profileAbilities',abilities);
  renderAbilityPicker('profileAbilityPicker',data.position||'',abilities,true);
  renderPlaystyleChip('profilePlaystyle',data.playstyle);
  renderPlaystylePicker('profilePlaystylePicker',data.position||'',data.playstyle||'',true);
  const avatar=document.getElementById('profileAvatar'); if(avatar){avatar.src=data.profileImage||'';avatar.style.display=data.profileImage?'block':'none';}
  renderProfileSkills(data,false);
  setProfileEditMode(false);
  showPage('player',pushHistory);
}

function renderProfileEditAbilities(data){
  const holder=document.getElementById('profileAbilities'); if(!holder) return;
  holder.innerHTML='<div id="profileAbilityPicker"></div><div id="profilePlaystylePicker" class="playstyle-panel" style="margin-top:10px;"></div>';
  renderAbilityPicker('profileAbilityPicker',data.position||'',normaliseAbilities(data),false);
  renderPlaystylePicker('profilePlaystylePicker',data.position||'',data.playstyle||'',false);
}

function goBackInApp(fallback='dashboard'){
  if(history.length>1){ history.back(); } else showPage(fallback);
}

const profileBackBtn=document.getElementById('profileBackBtn');
if(profileBackBtn) profileBackBtn.addEventListener('click',()=>goBackInApp('squad'));

const profileEditBtn=document.getElementById('profileEditBtn');
if(profileEditBtn) profileEditBtn.addEventListener('click',async()=>{
  if(!currentPlayerKey)return; const data=await loadRawPlayer(currentPlayerKey); if(!data)return;
  setProfileEditMode(true);
  renderProfileEditAbilities(data);
  renderProfileSkills(data,true);
});

const profileCancelBtn=document.getElementById('profileCancelBtn');
if(profileCancelBtn) profileCancelBtn.addEventListener('click',()=>openPlayerProfile(currentPlayerKey,true));

const profilePositionEl=document.getElementById('profilePosition');
if(profilePositionEl) profilePositionEl.addEventListener('change',()=>{
  if(!profileEditMode) return;
  const position=normalisePosition(profilePositionEl.value);
  renderPlaystylePicker('profilePlaystylePicker',position,getSelectedPlaystyle('profilePlaystylePicker'),false);
});

const profileSaveBtn=document.getElementById('profileSaveBtn');
if(profileSaveBtn) profileSaveBtn.addEventListener('click',async()=>{
  if(!currentPlayerKey)return;
  const old=await loadRawPlayer(currentPlayerKey); if(!old)return;
  const position=document.getElementById('profilePosition').value;
  const skills={};
  skillsFor(position).forEach(s=>{const el=document.querySelector(`[data-profile-skill="${CSS.escape(s)}"]`);if(el)skills[s]=Number(el.value)||0;});
  const chosenProfileRoles=normaliseRoles(old);
  const selectedProfilePosition=normalisePosition(position);
  const changes={
    name:document.getElementById('profileName').value.trim(),
    position,
    roles:[selectedProfilePosition,...chosenProfileRoles.filter(r=>r!==selectedProfilePosition)].slice(0,3),
    age:document.getElementById('profileAge').value.trim()===''?null:Number(document.getElementById('profileAge').value),
    ovr:document.getElementById('profileOvr').value.trim()===''?null:Number(document.getElementById('profileOvr').value),
    skills,
    specialAbilities:getSelectedAbilities('profileAbilityPicker'),
    playstyle:getSelectedPlaystyle('profilePlaystylePicker')
  };
  if(!changes.name){alert('Player name cannot be empty.');return;}
  try{
    await savePlayerRecordByKey(currentPlayerKey,changes);
    await renderSquadGrid(); await populateTrainingPlayerPicker();
    await openPlayerProfile(currentPlayerKey,true);
  }catch(err){console.error(err);alert('Could not save player: '+(err.message||err));}
});

const profileUpdateBtn=document.getElementById('profileUpdateBtn');
if(profileUpdateBtn) profileUpdateBtn.addEventListener('click',async()=>{
  if(!currentPlayerKey)return;
  const data=await loadRawPlayer(currentPlayerKey); if(!data)return;
  editingPlayerKey=currentPlayerKey;
  currentRoles=normaliseRoles(data); currentPosition=currentRoles[0]||data.position||'';
  document.getElementById('nameInput').value=data.name||'';
  document.getElementById('ageInput').value=data.age??'';
  document.getElementById('ovrInput').value=data.ovr??'';
  document.getElementById('posSelect').value=currentPosition;
  renderDetectedRoles();
  document.getElementById('playerTag').textContent=data.name?`— ${data.name}`:'';
  addPlayerSkills={...(data.skills||{})}; pendingPlayerImage=data.profileImage||'';
  renderAbilityPicker('addAbilityPicker',currentPosition,normaliseAbilities(data),false);
  renderPlaystylePicker('addPlaystylePicker',currentPosition,data.playstyle||'',false);
  renderAddSkillPreview(addPlayerSkills,currentPosition);
  document.getElementById('saveBtn').textContent='↻ Update Player';
  document.getElementById('addPlayerTitle').textContent='Update Player';
  document.getElementById('addPlayerSubtitle').textContent='Upload a new Skills screenshot. Only this player will be updated.';
  document.getElementById('scanStatus').textContent='Ready — upload a new screenshot. It will update only '+(data.name||'this player')+'.';
  document.getElementById('scanStatus').className='scan-status';
  // The squad page is now list-only; send update flow to Add Player.
  showPage('add-player');
});

const profileTrainingBtn=document.getElementById('profileTrainingBtn');
if(profileTrainingBtn) profileTrainingBtn.addEventListener('click',async()=>{
  if(!currentPlayerKey)return;
  trainingPlayerKey=currentPlayerKey;
  showPage('training',true,{preserveTraining:true});
  await populateTrainingPlayerPicker(currentPlayerKey);
  const picker=document.getElementById('trainingPlayerSelect'); if(picker)picker.value=currentPlayerKey;
  await selectTrainingPlayer(currentPlayerKey);
});

const profileDeleteBtn=document.getElementById('profileDeleteBtn');
if(profileDeleteBtn) profileDeleteBtn.addEventListener('click',async()=>{
  if(!currentPlayerKey)return;
  if(!profileDeleteBtn.armed){
    profileDeleteBtn.armed=true; profileDeleteBtn.textContent='Tap again to confirm';
    setTimeout(()=>{profileDeleteBtn.armed=false;profileDeleteBtn.textContent='Delete';},4000); return;
  }
  try{
    await window.storage.delete(currentPlayerKey,false);
    await window.storage.delete(`session:${currentPlayerKey.replace('player:','')}`,false).catch(()=>{});
    const order=await getSquadOrder(); await saveSquadOrder(order.filter(k=>k!==currentPlayerKey));
    currentPlayerKey=null; editingPlayerKey=null; profileDeleteBtn.armed=false; profileDeleteBtn.textContent='Delete';
    await renderSquadGrid(); await populateTrainingPlayerPicker(); showPage('squad');
  }catch(err){console.error(err);}
});

const trainingPlayerSelect = document.getElementById('trainingPlayerSelect');
if(trainingPlayerSelect){
  trainingPlayerSelect.addEventListener('change', e => selectTrainingPlayer(e.target.value));
}

// Initial load — every fresh launch starts on Dashboard. Squad data remains intact,
// but transient training/formation/tactical views are deliberately reset.
renderDashboard();
renderSquadGrid();
let initialPlayerKey=null;
try{initialPlayerKey=localStorage.getItem('te:lastPlayerKey')||null;localStorage.setItem('te:lastPage','dashboard');}catch(_){}
currentPage='dashboard';
clearTrainingView('Select a saved player to load their skills.');
try{window.storage.delete('formation:last',false).catch(()=>{});window.storage.delete('tactics:current',false).catch(()=>{});}catch(_){}
showPage('dashboard',false,{force:true});


// ============================================================
// FORMATION ENGINE
// ============================================================
const FORMATIONS = [
  {name:'4-4-2', slots:['GK','DL','DC','DC','DR','ML','MC','MC','MR','ST','ST']},
  {name:'4-3-3', slots:['GK','DL','DC','DC','DR','MC','MC','MC','AML','ST','AMR']},
  {name:'4-2-3-1', slots:['GK','DL','DC','DC','DR','DMC/MC','DMC/MC','AML','AMC','AMR','ST']},
  {name:'3-5-2', slots:['GK','DC','DC','DC','ML','MC','MC','MC','MR','ST','ST']},
  {name:'4-5-1', slots:['GK','DL','DC','DC','DR','DMC','ML','MC','MR','AMC','ST']},
  {name:'4-1-2-1-2', slots:['GK','DL','DC','DC','DR','DMC','MC','MC','AMC','ST','ST']}
];
const PLAYSTYLE_BONUS = {
  'Poacher':['ST'],'False Nine':['ST','AMC'],'Target Man':['ST'],'Inside Forward':['AML','AMR'],'Winger':['ML','MR','AML','AMR'],'Enganche':['AMC'],'False Winger':['ML','MR','AML','AMR'],'Complete Forward':['ST','AMC'],
  'Box-to-Box':['MC'],'Mezzala':['MC'],'Ball Winner':['DMC','MC'],'Anchor Man':['DMC'],'Playmaker':['DMC','MC','AMC'],'Regista':['DMC','MC'],'Holding Midfielder':['DMC','MC'],'Wing Back':['DL','DR','DML','DMR'],'Box Commander':['DC'],'Ball Playing DC':['DC'],'Stopper':['DC'],'Sweeper Keeper':['GK'],'Full Back':['DL','DR'],'No-Nonsense DC':['DC']
};
const ABILITY_BONUS = {
  'Penalty Kick Stopper':['GK'],'Defensive Wall':['DR','DL','DC','DMR','DML'],'Aerial Defender':['DR','DL','DC','DMR','DML'],'Dribbler':['MR','ML','MC','AMR','AML','AMC'],
  'Corner Specialist':['DMC','MR','ML','MC','AMR','AML','AMC','ST'],'Shadow Striker':['AMR','AML','AMC','ST'],'One-on-One Scorer':['AMR','AML','AMC','ST'],'One-on-One Stopper':['GK'],'Playmaker':['DMC','MR','ML','MC','AMC'],
  'Free Kick Specialist':['DMC','MR','ML','MC','AMR','AML','AMC','ST'],'Penalty Kick Specialist':['DR','DL','DC','DMC','MR','ML','MC','AMR','AML','AMC','ST']
};
function slotOptions(slot){ return String(slot).split('/').map(s=>normalisePosition(s)).filter(Boolean); }
function formationPositionFit(playerPos, slot){
  const roles=Array.isArray(playerPos)?playerPos.map(normalisePosition):playerRoles({position:playerPos});
  const opts=slotOptions(slot); if(roles.some(r=>opts.includes(r))) return 1;
  const p=roles[0]||'';
  const adjacent={GK:[],DL:['DR','DML'],DR:['DL','DMR'],DC:['DMC','DL','DR'],DML:['DL','DMC','ML'],DMR:['DR','DMC','MR'],DMC:['MC','DC','DML','DMR'],ML:['MR','MC','DML','AML'],MR:['ML','MC','DMR','AMR'],MC:['DMC','ML','MR','AMC'],AML:['AMR','ML','AMC'],AMR:['AML','MR','AMC'],AMC:['MC','AML','AMR','ST'],ST:['AMC','AMR','AML']};
  return opts.some(o=>(adjacent[p]||[]).includes(o))?0.28:0.03;
}
function roleSkillScore(player, slot){
  const s=player.skills||{}; const primary=slotOptions(slot)[0]; const keyBySlot={
    GK:['Reflexes','Agility','Anticipation','Rushing Out','Communication'],DL:['Tackling','Marking','Positioning','Crossing','Speed'],DR:['Tackling','Marking','Positioning','Crossing','Speed'],
    DC:['Tackling','Marking','Positioning','Heading','Bravery','Strength'],DML:['Tackling','Marking','Passing','Crossing','Strength'],DMR:['Tackling','Marking','Passing','Crossing','Strength'],DMC:['Tackling','Marking','Positioning','Passing','Bravery','Creativity'],
    ML:['Passing','Dribbling','Crossing','Speed','Creativity'],MR:['Passing','Dribbling','Crossing','Speed','Creativity'],MC:['Passing','Positioning','Tackling','Dribbling','Creativity','Fitness'],
    AML:['Passing','Dribbling','Crossing','Shooting','Finishing','Speed'],AMR:['Passing','Dribbling','Crossing','Shooting','Finishing','Speed'],AMC:['Passing','Dribbling','Shooting','Finishing','Creativity','Speed'],ST:['Positioning','Shooting','Finishing','Heading','Strength','Speed']
  };
  const keys=keyBySlot[primary]||OUTFIELD_SKILLS; const vals=keys.map(k=>Number(s[k]||0)).filter(v=>v>0); return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
}
function playerSlotScore(player,slot){
  const roles=playerRoles(player); const fit=formationPositionFit(roles,slot); const ovr=Number(player.ovr||0); const skill=roleSkillScore(player,slot); const style=normalisePlaystyle(player); const abilities=normaliseAbilities(player);
  const opts=slotOptions(slot); const exactPrimary=normalisePosition(player.position)===opts.find(o=>roles.includes(o));
  const styleBonus=(style&&(PLAYSTYLE_BONUS[style]||[]).some(x=>opts.includes(x)))?10:0;
  const abilityBonus=abilities.reduce((sum,a)=>sum+((ABILITY_BONUS[a]||[]).some(x=>opts.includes(x))?3:0),0);
  const positionBonus=fit===1?(exactPrimary?230:205):fit>0.2?18:-35;
  return positionBonus + fit*(ovr*0.46+skill*0.40)+styleBonus+abilityBonus;
}
function assignFormation(players, formation){
  const remaining=[...players]; const assignments=new Array(formation.slots.length);
  const slotOrder=formation.slots.map((slot,index)=>({slot,index,candidates:players.filter(p=>formationPositionFit(p,slot)===1).length})).sort((a,b)=>a.candidates-b.candidates||a.index-b.index);
  for(const item of slotOrder){
    let best=null,bestScore=-Infinity,bestIndex=-1;
    remaining.forEach((p,i)=>{const score=playerSlotScore(p,item.slot);if(score>bestScore){best=p;bestScore=score;bestIndex=i;}});
    if(best){assignments[item.index]={player:best,slot:item.slot,score:bestScore};remaining.splice(bestIndex,1);}
  }
  const chosen=assignments.filter(Boolean); const total=chosen.reduce((sum,x)=>sum+x.score,0); const exact=chosen.filter(x=>formationPositionFit(playerRoles(x.player),x.slot)===1).length;
  return {chosen,remaining,total,exact};
}
function chooseBestFormation(players){
  if(players.length<11) return {error:`You need at least 11 players. You currently have ${players.length}.`};
  const ranked=FORMATIONS.map(f=>({formation:f,...assignFormation(players,f)}));
  // A valid natural-role XI is more important than a small score difference.
  ranked.sort((a,b)=>b.exact-a.exact || b.total-a.total);
  return ranked[0];
}
function renderFormation(result){
  const pitch=document.getElementById('formationPitch'), bench=document.getElementById('formationBench'); if(!pitch||!bench)return;
  pitch.querySelectorAll('.pitch-player').forEach(e=>e.remove());
  const layouts={
    '4-4-2':[['GK',50,91],['DL',12,72],['DC',35,78],['DC',65,78],['DR',88,72],['ML',11,50],['MC',36,55],['MC',64,55],['MR',89,50],['ST',38,19],['ST',62,19]],
    '4-3-3':[['GK',50,91],['DL',12,72],['DC',35,78],['DC',65,78],['DR',88,72],['MC',24,52],['MC',50,57],['MC',76,52],['AML',16,28],['ST',50,15],['AMR',84,28]],
    '4-2-3-1':[['GK',50,91],['DL',12,72],['DC',35,78],['DC',65,78],['DR',88,72],['DMC',34,60],['DMC',66,60],['AML',15,34],['AMC',50,32],['AMR',85,34],['ST',50,13]],
    '3-5-2':[['GK',50,91],['DC',25,78],['DC',50,81],['DC',75,78],['ML',9,52],['MC',32,55],['MC',50,59],['MC',68,55],['MR',91,52],['ST',40,18],['ST',60,18]],
    '4-5-1':[['GK',50,91],['DL',12,72],['DC',35,78],['DC',65,78],['DR',88,72],['DMC',50,63],['ML',10,48],['MC',35,51],['MR',90,48],['AMC',50,30],['ST',50,13]],
    '4-1-2-1-2':[['GK',50,91],['DL',12,72],['DC',35,78],['DC',65,78],['DR',88,72],['DMC',50,64],['MC',34,51],['MC',66,51],['AMC',50,30],['ST',40,14],['ST',60,14]]
  };
  const layout=layouts[result.formation.name]||[];
  result.chosen.forEach(({player,slot},index)=>{
    const spec=layout[index]||[slotOptions(slot)[0]||'?',50,50]; const el=document.createElement('div'); el.className='pitch-player'; el.style.left=spec[1]+'%';el.style.top=spec[2]+'%';
    const actual=normalisePosition(player.position)||slotOptions(slot)[0]||'?'; const lastName=String(player.name||'Player').trim().split(/\s+/).pop()||'Player'; el.title=`${player.name} · ${actual} · OVR ${player.ovr||'—'}`;
    el.innerHTML=`<div class="pitch-player-dot">${player.profileImage?`<img src="${player.profileImage}" alt="">`:`<span>${escapeHtml(actual)}</span>`}</div><div class="pitch-player-name">${escapeHtml(lastName)}</div>`; el.addEventListener('click',()=>openPlayerProfile(player.key));pitch.appendChild(el);
  });
  bench.innerHTML=result.remaining.slice(0,8).map(p=>`<div class="bench-card"><b>${escapeHtml(p.name||'Player')}</b><br><span>${escapeHtml(playerRoles(p).join(' / '))} · OVR ${escapeHtml(p.ovr||'—')}${normalisePlaystyle(p)?' · '+escapeHtml(normalisePlaystyle(p)):''}</span></div>`).join('');
}
async function runTeamSelect(){
  const players=await getAllPlayers(); const result=chooseBestFormation(players); if(result.error){document.getElementById('formationName').textContent='Not enough players';document.getElementById('formationSummary').textContent=result.error;showToast(result.error,'err');return;}
  document.getElementById('formationName').textContent=result.formation.name; document.getElementById('formationSummary').textContent=`${result.exact}/11 natural-role picks · weighted team score ${Math.round(result.total)} · OVR + skills + playstyles + abilities`;
  renderFormation(result); try{await window.storage.set('formation:last',JSON.stringify({formation:result.formation.name,chosen:result.chosen.map(x=>({key:x.player.key,slot:x.slot})),updatedAt:new Date().toISOString()}),false);}catch(_){ }
}
const teamSelectBtn=document.getElementById('teamSelectBtn'); if(teamSelectBtn)teamSelectBtn.addEventListener('click',runTeamSelect);

// ============================================================
// MENTORS — real data transcribed from your own screenshots,
// not invented. "Assigned" is stored locally so the app remembers
// your current pick between visits.
// ============================================================
const MENTORS = [
  {name:"Alan Shearer",title:"The Finisher",focus:"Finishing",style:"attack",verified:true,description:"Legendary Mentor centred on scoring and finishing."},
  {name:"Claude Makélélé",title:"The Ball Winner",focus:"Ball-winning",style:"defence",verified:true,description:"Legendary Mentor centred on recovering possession and defensive midfield work."},
  {name:"Nemanja Vidić",title:"The Defender",focus:"Defence",style:"defence",verified:true,description:"Legendary Mentor centred on defensive solidity and stopping attacks."},
  {name:"Cesc Fàbregas",title:"The Playmaker",focus:"Playmaking",style:"control",verified:true,description:"Legendary Mentor centred on creative play and controlling midfield tempo."},
  {name:"Lewis Green",title:"The Wing Commander",focus:"Crossing & Heading",style:"width",verified:false,description:"Squad analysis favours Lewis when your team is built around wide play, crossing and aerial targets."},
  {name:"Jonas Brown",title:"The Tactical Adapter",focus:"Adaptive team play",style:"adaptive",verified:false,description:"Included in the current official seven-Mentor roster. The app treats Jonas as a flexible balanced option until a verified public breakdown of every individual bonus is available."},
  {name:"Rubén Herrera",title:"The Defensive Organiser",focus:"Defensive structure",style:"structure",verified:false,description:"Included in the current official seven-Mentor roster. The app favours Rubén for defensive/shape recommendations based on observed community use with defensive tactics."}
];

async function getAssignedMentor(){
  try{ const r = await window.storage.get('mentor:assigned', false); return r ? r.value : null; }catch(_){ return null; }
}
async function setAssignedMentor(name){
  await window.storage.set('mentor:assigned', name, false);
}

async function renderMentors(){
  const container = document.getElementById('mentorsList');
  if(!container) return;
  const assigned = await getAssignedMentor();
  container.innerHTML = MENTORS.map(m => {
    const isAssigned = assigned === m.name;
    return `
    <div class="mentor-card ${isAssigned?'assigned':''}">
      <div class="mentor-head">
        <div>
          <div class="mentor-name">${m.name}</div>
          <div class="mentor-title">${m.title}</div>
        </div>
        ${isAssigned ? '<span class="mentor-badge">ASSIGNED</span>' : ''}
      </div>
      <div class="mentor-row"><b>Specialisation:</b> ${m.focus}</div>
      <div class="mentor-row">${m.description}</div>
      <div class="mentor-row" style="font-size:11px;opacity:.78;">${m.verified ? 'Officially established focus' : 'App recommendation profile based on current public/community evidence; exact in-game bonuses still depend on Mentor level.'}</div>
      <button class="small mentor-assign-btn" data-mentor="${m.name.replace(/"/g,'&quot;')}">${isAssigned ? 'Unassign' : 'Assign'}</button>
    </div>`;
  }).join('');
}

document.addEventListener('click', async function(e){
  const btn = e.target.closest('.mentor-assign-btn');
  if(!btn) return;
  const name = btn.getAttribute('data-mentor');
  const current = await getAssignedMentor();
  await setAssignedMentor(current === name ? '' : name);
  renderMentors();
});

// ============================================================
// TACTICS — the real option structure from your screenshots
// (In Possession / In Transition / Out of Possession). This
// stores your current selections; it does not yet recommend
// anything, since a real recommendation needs squad-wide
// attribute analysis this app doesn't do yet.
// ============================================================
const TACTICS_OPTIONS = {
  "In Possession": {"Shooting Tendency":["Shoot on Sight","Work it into the Box","Balanced"],"Passing Style":["Short","Long","Mixed"],"Focus Passing":["Left Flank","Right Flank","Both Flanks","Through the Middle","Balanced"],"Cross Tendency":["Low","Medium","High"]},
  "In Transition": {"Possession Lost":["Counter Press","Regroup"],"Possession Won":["Focus on Buildup","Counter Attack"],"Mentality":["Hard Defending","Defending","Normal","Attacking","Hard Attacking"]},
  "Out of Possession": {"Marking Style":["Man to Man","Zonal"],"Pressing":["Low Block","Mid Press","High Press"],"Back Line":["Track Opponent","Set Offside Trap","Balanced"],"Tackling Style":["Stay on Feet","Aggressive","Balanced"]}
};

async function getTacticSelections(){
  try{ const r = await window.storage.get('tactics:current', false); return r ? JSON.parse(r.value) : {}; }catch(_){ return {}; }
}
async function setTacticSelection(group, field, value){
  const cur = await getTacticSelections();
  cur[group] = cur[group] || {};
  cur[group][field] = value;
  await window.storage.set('tactics:current', JSON.stringify(cur), false);
}

async function renderTactics(){
  const container = document.getElementById('tacticsGroups');
  if(!container) return;
  const selections = await getTacticSelections();
  container.innerHTML = Object.entries(TACTICS_OPTIONS).map(([group, fields]) => `
    <div class="tactic-group">
      <div class="tactic-group-title">${group}</div>
      ${Object.entries(fields).map(([field, options]) => {
        const current = (selections[group] && selections[group][field]) || '';
        return `<div class="tactic-field">
          <label>${field}</label>
          <select data-group="${group}" data-field="${field}" class="tactic-select">
            <option value="">— not set —</option>
            ${options.map(o => `<option value="${o}" ${o===current?'selected':''}>${o}</option>`).join('')}
          </select>
        </div>`;
      }).join('')}
    </div>
  `).join('');
}

document.addEventListener('change', function(e){
  const sel = e.target.closest('.tactic-select');
  if(!sel) return;
  setTacticSelection(sel.getAttribute('data-group'), sel.getAttribute('data-field'), sel.value);
});


// ============================================================
// PLAYMAKERS — set-piece and captain ranking
// ============================================================
function avgSkill(player,names){ const vals=names.map(n=>Number((player.skills||{})[n]||0)).filter(v=>v>0); return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; }
function scorePenalty(p){ return Number((p.skills||{}).Finishing||0)*0.62 + Number((p.skills||{}).Shooting||0)*0.20 + Number((p.skills||{}).Creativity||0)*0.08 + Number(p.ovr||0)*0.10 + (normaliseAbilities(p).includes('Penalty Kick Specialist')?20:0); }
function scoreCorner(p){ return Number((p.skills||{}).Crossing||0)*0.62 + Number((p.skills||{}).Passing||0)*0.20 + Number((p.skills||{}).Creativity||0)*0.10 + Number(p.ovr||0)*0.08 + (normaliseAbilities(p).includes('Corner Specialist')?20:0); }
function scoreFreeKick(p){ return Number((p.skills||{}).Shooting||0)*0.62 + Number((p.skills||{}).Finishing||0)*0.14 + Number((p.skills||{}).Passing||0)*0.14 + Number((p.skills||{}).Creativity||0)*0.06 + Number(p.ovr||0)*0.04 + (normaliseAbilities(p).includes('Free Kick Specialist')?20:0); }
function scoreCaptain(p){ const age=Number(p.age||0); const experience=Math.min(30,Math.max(0,age-20)*1.2); const broad=avgSkill(p,['Tackling','Marking','Positioning','Passing','Creativity','Shooting','Finishing','Bravery','Fitness']); return Number(p.ovr||0)*0.58+broad*0.30+experience*0.12; }
function playerFaceHtml(p){ return p.profileImage?`<img class="playmaker-face" src="${p.profileImage}" alt="">`:`<div class="playmaker-fallback">${escapeHtml(normalisePosition(p.position)||'?')}</div>`; }
function playmakerRow(p,rank,score){ return `<div class="playmaker-row"><div class="playmaker-rank">${rank}</div>${playerFaceHtml(p)}<div><div class="playmaker-name">${escapeHtml(p.name||'Player')}</div><div class="playmaker-meta">${escapeHtml(playerRoles(p).join(' / '))} · OVR ${escapeHtml(p.ovr||'—')}${normaliseAbilities(p).length?' · '+escapeHtml(normaliseAbilities(p).join(', ')):''}</div></div><div class="playmaker-score">${Math.round(score)}</div></div>`; }
async function renderPlaymakers(){
  const players=await getAllPlayers(); const eligible=players.filter(p=>normalisePosition(p.position)!=='GK');
  const penalties=eligible.map(p=>({p,score:scorePenalty(p)})).sort((a,b)=>b.score-a.score).slice(0,5);
  const corner=eligible.map(p=>({p,score:scoreCorner(p)})).sort((a,b)=>b.score-a.score)[0]; const fk=eligible.map(p=>({p,score:scoreFreeKick(p)})).sort((a,b)=>b.score-a.score)[0]; const captain=players.map(p=>({p,score:scoreCaptain(p)})).sort((a,b)=>b.score-a.score)[0];
  document.getElementById('penaltyTakers').innerHTML=penalties.length?penalties.map((x,i)=>playmakerRow(x.p,i+1,x.score)).join(''):'<div class="ability-empty">Add outfield players to rank penalty takers.</div>';
  document.getElementById('cornerTaker').innerHTML=corner?playmakerRow(corner.p,1,corner.score):'<div class="ability-empty">No eligible player yet.</div>';
  document.getElementById('freeKickTaker').innerHTML=fk?playmakerRow(fk.p,1,fk.score):'<div class="ability-empty">No eligible player yet.</div>';
  document.getElementById('captainPick').innerHTML=captain?playmakerRow(captain.p,1,captain.score):'<div class="ability-empty">Add players to choose a captain.</div>';
}

// ============================================================
// 2027 TACTICAL GENERATOR
// ============================================================
function squadMetrics(players){
  const roleCounts={}; players.forEach(p=>playerRoles(p).forEach(r=>roleCounts[r]=(roleCounts[r]||0)+1));
  const avg=(names)=>{const vals=players.map(p=>avgSkill(p,names)).filter(v=>v>0);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;};
  return {roleCounts,def:avg(['Tackling','Marking','Positioning','Bravery','Heading']),mid:avg(['Passing','Creativity','Dribbling','Positioning']),attack:avg(['Shooting','Finishing','Dribbling','Creativity']),cross:avg(['Crossing']),ovr:avg(['OVR'])};
}
function mentorScore(priority,m,mentor){
  const base={defending:{defence:100,structure:94,adaptive:82,control:68,width:55,attack:48},balanced:{control:100,adaptive:94,defence:86,structure:82,width:80,attack:76},attacking:{attack:100,width:96,control:90,adaptive:84,defence:66,structure:62}};
  let score=base[priority][mentor.style]||60;
  if(mentor.name==='Lewis Green') score+=m.cross/20;
  if(mentor.name==='Alan Shearer') score+=m.attack/20;
  if(mentor.name==='Cesc Fàbregas') score+=m.mid/20;
  if(mentor.name==='Claude Makélélé') score+=(m.def+m.mid)/45;
  if(mentor.name==='Nemanja Vidić') score+=m.def/18;
  if(mentor.name==='Rubén Herrera') score+=m.def/20;
  if(mentor.name==='Jonas Brown') score+=(m.def+m.mid+m.attack)/70;
  return Math.round(score*10)/10;
}
function bestMentor(priority,m){return MENTORS.map(x=>({...x,score:mentorScore(priority,m,x)})).sort((a,b)=>b.score-a.score)[0];}
function recommendTactics(players,priority){
  const m=squadMetrics(players); const has=(r)=>m.roleCounts[r]||0; const mentor=bestMentor(priority,m).name;
  const plans={
    defending:{mentor,shoot:'Balanced',pass:'Mixed',focus:'Balanced',cross:'Medium',lost:'Regroup',won:'Focus on Buildup',mentality:'Defending',mark:'Zonal',press:'Mid Press',back:'Balanced',tackle:'Stay on Feet'},
    balanced:{mentor,shoot:'Balanced',pass:'Mixed',focus:'Balanced',cross:'Medium',lost:'Counter Press',won:'Focus on Buildup',mentality:'Normal',mark:'Zonal',press:'Mid Press',back:'Balanced',tackle:'Balanced'},
    attacking:{mentor,shoot:'Work it into the Box',pass:'Short',focus:has('AML')+has('AMR')+has('ML')+has('MR')>=2?'Both Flanks':'Through the Middle',cross:m.cross>=110?'High':'Medium',lost:'Counter Press',won:'Counter Attack',mentality:'Attacking',mark:'Zonal',press:'High Press',back:'Set Offside Trap',tackle:'Aggressive'}
  };
  return {...plans[priority],metrics:m};
}
function tacticalCard(label,plan){return `<div class="tactical-preset"><h3>${label}</h3><div class="mentor">Recommended Mentor · ${escapeHtml(plan.mentor)}</div><div class="line">${escapeHtml(plan.shoot)} · ${escapeHtml(plan.pass)} · ${escapeHtml(plan.focus)}</div><div class="line">${escapeHtml(plan.lost)} / ${escapeHtml(plan.won)} · ${escapeHtml(plan.mentality)}</div><div class="line">${escapeHtml(plan.mark)} · ${escapeHtml(plan.press)} · ${escapeHtml(plan.back)} · ${escapeHtml(plan.tackle)}</div></div>`;}
async function generateTacticalPlan(){
  const players=await getAllPlayers(); const priority=document.getElementById('tacticalPriority').value; const plan=recommendTactics(players,priority); const el=document.getElementById('tacticalRecommendation');
  if(players.length<11){el.innerHTML='<div class="tactical-result"><b>Not enough players.</b><div class="formation-note">Add at least 11 players before asking the app to generate a full team tactic.</div></div>';return;}
  el.innerHTML=`<div class="tactical-result"><b>${priority[0].toUpperCase()+priority.slice(1)} recommendation</b><button class="small" style="float:right;color:var(--turf);border-color:var(--turf-dim);" data-apply-tactical="${priority}">Apply</button><div class="tactical-result-grid"><div class="tactical-result-item"><div class="tactical-result-label">Recommended Mentor</div><div class="tactical-result-value">${escapeHtml(plan.mentor)}</div></div><div class="tactical-result-item"><div class="tactical-result-label">Suggested mentality</div><div class="tactical-result-value">${escapeHtml(plan.mentality)}</div></div><div class="tactical-result-item"><div class="tactical-result-label">Core shape</div><div class="tactical-result-value">${priority==='defending'?'Protect the centre and regain shape':priority==='attacking'?'Press high and create width':'Control possession and maintain balance'}</div></div><div class="tactical-result-item"><div class="tactical-result-label">Squad basis</div><div class="tactical-result-value">${players.length} players analysed</div></div></div></div>`;
}
async function renderTacticalPresets(){ const players=await getAllPlayers(); const el=document.getElementById('tacticalPresets'); if(!el)return; if(players.length<1){el.innerHTML='';return;} el.innerHTML=tacticalCard('Defending',recommendTactics(players,'defending'))+tacticalCard('Balanced',recommendTactics(players,'balanced'))+tacticalCard('Attacking',recommendTactics(players,'attacking')); }
async function applyTacticalPlan(priority){
  const players=await getAllPlayers(); if(players.length<1)return;
  const plan=recommendTactics(players,priority); const values={
    'In Possession':{'Shooting Tendency':plan.shoot,'Passing Style':plan.pass,'Focus Passing':plan.focus,'Cross Tendency':plan.cross},
    'In Transition':{'Possession Lost':plan.lost,'Possession Won':plan.won,'Mentality':plan.mentality},
    'Out of Possession':{'Marking Style':plan.mark,'Pressing':plan.press,'Back Line':plan.back,'Tackling Style':plan.tackle}
  };
  for(const [group,fields] of Object.entries(values)) for(const [field,value] of Object.entries(fields)) await setTacticSelection(group,field,value);
  await setAssignedMentor(plan.mentor); await renderTactics(); showToast(`${priority[0].toUpperCase()+priority.slice(1)} tactic applied · ${plan.mentor} assigned ✓`);
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-apply-tactical]');if(!b)return;applyTacticalPlan(b.getAttribute('data-apply-tactical'));});

const generateTacticsBtn=document.getElementById('generateTacticsBtn'); if(generateTacticsBtn)generateTacticsBtn.addEventListener('click',generateTacticalPlan);

const clearAllBtn = document.getElementById('clearAllDataBtn');
if(clearAllBtn){
  clearAllBtn.addEventListener('click', async () => {
    if(!clearAllBtn.armed){
      clearAllBtn.armed = true;
      clearAllBtn.textContent = 'Tap again to confirm — this cannot be undone';
      setTimeout(() => { clearAllBtn.armed = false; clearAllBtn.textContent = 'Clear All Squad Data'; }, 4000);
      return;
    }
    const keys = [];
    for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i); if(k && k.indexOf('te:')===0) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
    clearAllBtn.textContent = 'Cleared ✓';
    renderSquadGrid(); renderDashboard();
  });
}
