import { DEFAULT_PLACE, CATEGORIES, CONTEXTS, escapeHTML, rankPlaces, prettyDistance, formatDateTime, hasValidUrl } from './lib/domain.js';
import { readStore, writeStore, exportArchive, importArchive } from './lib/storage.js';
import { fetchRestaurants, lookupLocations, reverseLocation } from './lib/providers.js';
import { loadNaverMaps, RestaurantMap } from './lib/naver-map.js';

const $ = selector => document.querySelector(selector);
const state = {
  location: { ...DEFAULT_PLACE },
  settings: { radius: 2400, context: 'balanced', category: 'all', sort: 'fit', ...readStore('settings') },
  favorites: readStore('favorites'), reviews: readStore('reviews'),
  savedLocations: readStore('savedLocations'),
  places: [], ranked: [], selectedId: null, loading: false,
  locationIsFallback: true, favoritesOnly: false, map: null, markers: [], originMarker: null, fetchedAt: null,
  stale: false, search: '', requestNumber: 0, detail: null,
};
let loadAbort = null;
let toastTimer = null;
let lastKnownError = null;
const emojis = { restaurant: '🍲', cafe: '☕', fast_food: '🥪', food_court: '🍱' };
const escape = escapeHTML;

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('is-on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), 3000);
}
function persist() {
  writeStore('settings', state.settings); writeStore('favorites', state.favorites);
  writeStore('reviews', state.reviews); writeStore('savedLocations', state.savedLocations);
}
function safeText(txt) { return escape(String(txt || '')); }
function apiStatus(message) { $('#data-indicator').textContent = message; }
function setLoader(visible, message) {
  state.loading = visible;
  $('#map-loader').classList.toggle('is-visible', visible);
  if (message) $('#map-loader .map-loader-detail').textContent = message;
  if (visible) $('#restaurant-list').innerHTML = '<div class="list-loading"><div class="loading-ring"></div>주변 식당의 실제 등록 정보를 확인 중이에요.</div>';
}
function renderChips() {
  $('#context-chips').innerHTML = Object.entries(CONTEXTS).map(([key,value]) => `<button type="button" class="context-chip ${state.settings.context===key?'is-active':''}" data-context="${key}" aria-pressed="${state.settings.context===key}">${safeText(value)}</button>`).join('');
  $('#category-chips').innerHTML = Object.entries(CATEGORIES).map(([key,value]) => `<button type="button" class="category-chip ${state.settings.category===key?'is-active':''}" data-category="${key}" aria-pressed="${state.settings.category===key}">${safeText(value)}</button>`).join('');
  $('#radius-button').textContent = `반경 ${state.settings.radius / 1000}km⌄`;
  $('#sort-select').value = state.settings.sort;
}
function updateLocationLabel() {
  $('#location-label').textContent = state.location.name + (state.locationIsFallback ? ' (현위치 아님)' : '');
  $('#mobile-location').textContent = '📍 ' + state.location.name.slice(0, 22);
}
async function createMap() {
  $('#map').innerHTML='<div class="map-error"><div class="loading-ring"></div><strong>네이버 지도를 불러오는 중입니다.</strong></div>';
  try {
    await loadNaverMaps();
    state.map = new RestaurantMap('map', state.location, id => openDetail(id, {fromMap:true}));
    placeOriginMarker(); renderMarkers();
  } catch(error) {
    $('#map').innerHTML = `<div class="map-error"><strong>네이버 지도 연결을 확인해 주세요.</strong><span>${safeText(error.message)}</span><span>식당 목록은 계속 이용할 수 있습니다.</span></div>`;
  }
}
function placeOriginMarker() { state.map?.origin(state.location,state.location.name); }
function renderMarkers() { state.map?.render(state.ranked,state.selectedId,safeText); }
function renderInsight() {
  const all = state.ranked;
  const n = all.length;
  const insight=$('#insight-card');
  if (!n) { insight.innerHTML = '<div class="insight-icon">✦</div><div><strong>한눈 인사이트</strong><p>조건에 맞는 등록 식당이 아직 없습니다. 검색 범위를 넓혀 보세요.</p></div>'; return; }
  const cats = {};
  all.forEach(p => { cats[p.amenity]=(cats[p.amenity]||0)+1; });
  const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  const top=sorted[0];
  const nearest=[...all].sort((a,b)=>a.distance-b.distance)[0];
  const label=CATEGORIES[top[0]]||'음식점';
  const notice = `검색된 ${n}곳 중 ${label} ${top[1]}곳. 가장 가까운 곳은 직선거리 ${prettyDistance(nearest.distance)}입니다.`;
  insight.innerHTML = `<div class="insight-icon">✦</div><div><strong>이 동네 한눈 인사이트</strong><p>${safeText(notice)}</p></div>`;
}
function cardHTML(p,i) {
  const saved=Boolean(state.favorites[p.id]);
  const tag=p.tags || {};
  const shortEvidence = p.hygiene ? `공식 위생정보 · ${p.hygiene.grade}` : (p.source === 'tour' ? '한국관광공사 음식점 정보' : '소상공인시장진흥공단 상가정보');
  const photo = p.images?.find(image => hasValidUrl(image.url) && ['Type1','Type3'].includes(image.license));
  return `<article class="restaurant-card ${p.id===state.selectedId?'is-selected':''}" data-open="${safeText(p.id)}" tabindex="0" role="button" aria-label="${safeText(p.name)} 상세 보기">
    <div class="restaurant-illustration kind-${safeText(p.amenity)}"><span class="emoji" aria-hidden="true">${emojis[p.amenity]||'🍴'}</span>${photo?`<img src="${safeText(photo.url)}" alt="${safeText(p.name)} · ${safeText(photo.author)} 제공" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:""}${i<5&&!photo?`<span class="rank-badge">추천 ${i+1}</span>`:''}</div>
    <div class="restaurant-card-body">
      <div class="card-overline">${safeText(p.category)}</div>
      <div class="card-name-line"><h3 class="card-name">${safeText(p.name)}</h3><button type="button" class="save-heart ${saved?'is-saved':''}" data-save="${safeText(p.id)}" aria-label="${saved?'즐겨찾기 해제':'즐겨찾기 저장'}">${saved?'♥':'♡'}</button></div>
      <div class="card-subinfo"><span>📍 직선 ${prettyDistance(p.distance)}</span><span class="dot-sep">·</span><span>${p.hours?'영업시간 등록':'영업시간 미확인'}</span></div>
      <div class="fit-tag">✧ 내 조건 적합도 ${p.score}점</div>
      <div class="card-meta">${safeText(shortEvidence)} ${state.reviews[p.id]?.stars?`· 내 평가 ${state.reviews[p.id].stars}점`:''}</div>
    </div>
  </article>`;
}
function renderResults() {
  if (state.loading) return;
  const ranked=rankPlaces(state.places,state.location,{...state.settings,search:state.search,favorites:state.favorites,reviews:state.reviews});
  state.ranked=state.favoritesOnly ? ranked.filter(p=>state.favorites[p.id]) : ranked;
  $('#result-count').textContent=`${state.ranked.length}곳`;
  if (state.fetchedAt) apiStatus(`공공 식당 데이터 · 수집 ${formatDateTime(state.fetchedAt)}${state.stale?' · 갱신 지연':''}`);
  else if (lastKnownError) apiStatus(lastKnownError);
  renderInsight();
  const list=$('#restaurant-list');
  if (!state.ranked.length) {
    list.innerHTML = `<div class="list-empty"><span style="font-size:42px">🍜</span><strong>조건에 맞는 식당을 찾지 못했어요.</strong><span>${lastKnownError ? safeText(lastKnownError) : '수집된 공공데이터에 해당 지역·조건의 식당이 없을 수 있어요. 데이터 현황에서 수집 범위를 확인하세요.'}</span><button id="clear-filters" type="button">조건 초기화</button><button id="retry-load" type="button">실제 데이터 다시 조회</button></div>`;
  } else {
    list.innerHTML=state.ranked.slice(0,120).map(cardHTML).join('');
    if (state.ranked.length>120) list.innerHTML+=`<p class="hint-text" style="margin:8px 0 15px">현재 ${state.ranked.length}곳 중 120곳을 표시합니다. 조건을 좁혀 주세요.</p>`;
  }
  renderMarkers();
}
async function loadRestaurants() {
  loadAbort?.abort(); loadAbort=new AbortController();
  const request=++state.requestNumber;
  lastKnownError=null;
  setLoader(true,'공공 식당 데이터에서 주변 지역을 확인합니다'); apiStatus('실제 장소 데이터 조회 중');
  try {
    const result=await fetchRestaurants(state.location.lat,state.location.lon,state.settings.radius,loadAbort.signal);
    if (request!==state.requestNumber) return;
    Object.assign(state,{places:result.places,fetchedAt:result.fetchedAt,stale:result.stale});
    if (result.stale) toast('원본 API 접속이 불안정해 이전 데이터를 표시합니다.');
  } catch(err) {
    if (request!==state.requestNumber || err.name==='AbortError') return;
    state.places=[];state.fetchedAt=null;state.stale=false;
    lastKnownError='식당 데이터 파일을 불러오지 못했습니다. 연결을 확인한 후 다시 시도해 주세요.';
    toast(lastKnownError);
    console.warn('Restaurant provider:',err.message);
  } finally {
    if (request===state.requestNumber) { setLoader(false);renderResults(); }
  }
}
async function setLocation(location,{isCurrent=false,suppressReverse=false}={}) {
  state.location={lat:Number(location.lat),lon:Number(location.lon),name:location.name||'선택한 지역',isCurrent};
  state.locationIsFallback=!isCurrent;
  updateLocationLabel();
  state.map?.center(state.location);
  placeOriginMarker();
  writeStore('lastLocation',state.location);
  await loadRestaurants();
  if (isCurrent&&!suppressReverse) {
    // 위치 공개에 동의한 사용자의 주소 표시 목적, 1회 역지오코딩.
    try {
      const name=await reverseLocation(state.location.lat,state.location.lon);
      if(!state.location.isCurrent)return;
      state.location.name=name;updateLocationLabel();writeStore('lastLocation',state.location);
    } catch { state.location.name='내 현재 위치';updateLocationLabel(); }
  }
}
function getCurrentPosition() {
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('이 브라우저에서 위치 정보를 사용할 수 없습니다.'));return;}
    navigator.geolocation.getCurrentPosition(p=>resolve(p.coords),reject,{enableHighAccuracy:true,timeout:9500,maximumAge:180000});
  });
}
async function useCurrentPosition(silent=false) {
  try {
    if (!silent) toast('현재 위치 권한을 확인합니다.');
    setLoader(true,'현재 위치를 확인합니다');
    const coords=await getCurrentPosition();
    $('#location-dialog').open&&$('#location-dialog').close();
    await setLocation({lat:coords.latitude,lon:coords.longitude,name:'내 현재 위치'},{isCurrent:true});
  } catch {
    if(silent){
      const prev=readStore('lastLocation');
      if(prev && Number.isFinite(prev.lat)&&Number.isFinite(prev.lon) && typeof prev.name==='string'){
        await setLocation(prev,{isCurrent:false,suppressReverse:true});
      } else await setLocation({...DEFAULT_PLACE},{isCurrent:false,suppressReverse:true});
      toast('위치 접근을 허용하지 않아 선택·기본 위치에서 검색합니다.');
    } else { setLoader(false); renderResults(); toast('위치 권한을 허용하거나 지역명을 검색해 주세요.'); }
  }
}
function toggleFavorite(id) {
  const place=state.places.find(p=>p.id===id);
  if (!place) return;
  if (state.favorites[id]) { delete state.favorites[id];toast('즐겨찾기를 해제했습니다.'); }
  else { state.favorites[id]={id,lat:place.lat,lon:place.lon,name:place.name,category:place.category,savedAt:new Date().toISOString()};toast('내 맛집에 저장했습니다.'); }
  persist();renderResults();
  if ($('#detail-dialog').open&&state.selectedId===id) renderDetail(place);
}
function openDetail(id, {fromMap=false}={}) {
  const place=state.places.find(p=>p.id===id);
  if(!place)return;
  state.selectedId=id;
  if(fromMap && window.innerWidth<=850) { $('#sheet').dataset.level='compact'; $('#app').classList.add('map-focus'); }
  renderDetail(place);
  if(!$('#detail-dialog').open) $('#detail-dialog').showModal();
  state.map?.center(place, window.innerWidth<=850 ? $('#detail-dialog').getBoundingClientRect().height : 0);
  renderResults();
}
function renderDetail(place) {
  const info=rankPlaces([place],state.location,{...state.settings,category:'all',radius:100000,reviews:state.reviews})[0];
  const rec=state.reviews[place.id]||{};
  const selected=Number(rec.stars)||0;
  const note=rec.note||'';
  const sourceLink = place.sourceUrl || 'https://www.data.go.kr/data/15012005/openapi.do';
  const sourceName = place.source === 'tour' ? '한국관광공사' : '소상공인시장진흥공단';
  const photo = place.images?.find(image=>hasValidUrl(image.url)&&['Type1','Type3'].includes(image.license));
  const navigate=`https://map.naver.com/p/search/${encodeURIComponent(place.name+' '+place.address)}`;
  const google=`https://www.google.com/maps/dir/?api=1&destination=${place.lat}%2C${place.lon}`;
  const fav=Boolean(state.favorites[place.id]);
  $('#detail-content').innerHTML=`<button class="close-detail" type="button" id="close-detail" aria-label="닫기">×</button>
    <div class="detail-resize"><button type="button" id="resize-detail" aria-label="상세 크기 조절">━ <span>상세 펼치기 ↕</span></button></div><div class="detail-cover">${photo?`<img src="${safeText(photo.url)}" alt="${safeText(place.name)} · ${safeText(photo.author)} 제공" referrerpolicy="no-referrer">`:(emojis[place.amenity]||'🍴')}<span class="cover-source">${photo?`${safeText(photo.author)} · 공공누리 ${photo.license==='Type3'?'3유형 (변경금지)':'1유형'}`:'업종 아이콘 · 실제 사진 미확보'}</span></div>
    <div class="detail-main">
      <div class="detail-top"><span class="detail-type">${safeText(place.category)}</span><button type="button" class="save-heart ${fav?'is-saved':''}" data-save="${safeText(place.id)}">${fav?'♥ 저장됨':'♡ 내 맛집 저장'}</button></div>
      <h2>${safeText(place.name)}</h2>
      <p class="detail-description">${safeText(place.address||'등록된 상세 주소 없음')} · 현재 탐색 중심에서 직선거리 ${prettyDistance(info.distance)}</p>
      <div class="detail-facts"><div><small>내 조건 적합도</small><strong>${info.score}점</strong></div><div><small>확인된 세부 항목</small><strong>${info.evidence}개 / 6개</strong></div></div>
      <div class="detail-section"><h3>왜 추천하나요?</h3><p>${safeText(info.reason)} · 거리 ${prettyDistance(info.distance)} · 추가 등록된 정보 ${info.evidence}개. 이 점수는 맛 평점이 아니며 리뷰/메뉴가격/위생 상태를 평가하지 않습니다.</p></div>
      <div class="detail-section"><h3>확인된 장소 정보</h3><p>영업시간: ${safeText(place.hours||'정보 미확인')}${place.hours?' (원천 제공 정보 · 방문 전 확인)':''}</p><p>전화: ${safeText(place.phone||'정보 미확인')}</p><p>홈페이지: ${place.website&&hasValidUrl(place.website)?`<a href="${safeText(place.website)}" target="_blank" rel="noopener noreferrer">공식 웹사이트 열기</a>`:'정보 미확인'}</p><p>휠체어 접근성: ${safeText(place.tags?.wheelchair==='yes'?'가능으로 등록':place.tags?.wheelchair==='no'?'어려움으로 등록':'정보 미확인')}</p></div>
      <div class="detail-actions"><a class="primary" href="${navigate}" target="_blank" rel="noopener noreferrer">↗ 네이버 지도 · 길찾기</a><a href="${google}" target="_blank" rel="noopener noreferrer">Google 길찾기</a>${place.phone?`<a href="tel:${safeText(place.phone.replace(/[^0-9+\-]/g,''))}">☎ 전화하기</a>`:''}<button type="button" id="share-place">↗ 공유하기</button></div>
      <div class="detail-section"><h3>나만의 맛집 기록 <span style="color:#98a79a;font-size:10px;font-weight:500">(기기 내부 저장)</span></h3><p style="margin-bottom:7px">직접 다녀온 경우에만 개인 평가를 남겨 주세요.</p><div class="stars-row">${[1,2,3,4,5].map(n=>`<button type="button" class="star-button ${n<=selected?'is-active':''}" data-stars="${n}" aria-label="내 개인 평점 ${n}점">★</button>`).join('')}<span style="font-size:11px;color:#7b907e;margin-left:5px">${selected ? `나의 평가 ${selected}/5` : '평가하지 않음'}</span></div>
      <textarea class="memo-input" id="review-note" placeholder="먹은 메뉴, 재방문하고 싶은 이유, 주차 팁 등을 남겨보세요." maxlength="2000">${safeText(note)}</textarea>
      <button type="button" id="save-record" class="save-note">내 방문 메모 저장</button></div>
      ${place.hygiene?`<div class="detail-section hygiene-section"><h3>공식 위생등급 · ${safeText(place.hygiene.grade)}</h3><p>식품의약품안전처 식품안심업소 지정정보<br>지정기간 ${safeText(place.hygiene.validFrom)} ~ ${safeText(place.hygiene.validUntil)}<br>원천 확인일 ${safeText(place.hygiene.checkedAt?.slice(0,10)||formatDateTime(state.fetchedAt))}</p></div>`:''}
      ${place.description?`<div class="detail-section"><h3>음식점 소개</h3><p>${safeText(place.description)}</p></div>`:''}
      ${place.menu?.length?`<div class="detail-section"><h3>원천에 등록된 대표 메뉴</h3><p>${place.menu.map(m=>safeText(m.name)).join(' · ')}</p><p>가격 미확인 · 방문 전 업소에 확인하세요.</p></div>`:''}
      <div class="detail-section"><p>출처: <a href="${safeText(sourceLink)}" target="_blank" rel="noopener noreferrer">${sourceName} 원문 ↗</a><br>원천 기준일 ${safeText(place.sourceDate||'미제공')} · 수집일 ${safeText(place.collectedAt?.slice(0,10)||formatDateTime(state.fetchedAt))}</p><p class="warning">현재 영업 여부·메뉴 가격·방문자 리뷰는 미확인입니다. 위생 배지가 없는 업소는 지정정보를 연결하지 못한 경우도 있습니다.</p>${photo?`<p><a href="${safeText(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">사진 출처 ↗</a> · ${safeText(photo.author)} · 공공누리 ${photo.license==='Type3'?'3유형 (변경금지)':'1유형'}</p>`:''}</div>
    </div>`;
  $('#close-detail').onclick=()=>$('#detail-dialog').close();
  $('#resize-detail').onclick=()=>{ const h=$('#resize-detail');if(h.dataset.ignoreClick==='1'){delete h.dataset.ignoreClick;return;}const d=$('#detail-dialog');const levels=['compact','expanded','full'];d.dataset.level=levels[(levels.indexOf(d.dataset.level)+1)%3]; };
  installDetailDrag();
  $('#detail-content').querySelectorAll('[data-stars]').forEach(button=>{
    button.addEventListener('click',()=>{
      const stars=Number(button.dataset.stars);
      state.reviews[place.id]={...state.reviews[place.id],stars: stars === state.reviews[place.id]?.stars?0:stars,updatedAt:new Date().toISOString()};
      persist();renderDetail(place);renderResults();
    });
  });
  $('#save-record').onclick=()=>{
    const note=$('#review-note').value.trim();
    if(!note&&!state.reviews[place.id]?.stars){delete state.reviews[place.id];}
    else state.reviews[place.id]={...state.reviews[place.id],note,updatedAt:new Date().toISOString(),name:place.name};
    persist();renderResults();toast('개인 맛집 기록을 기기에 저장했습니다.');
  };
  $('#share-place').onclick=async()=>{
    const url=new URL(window.location.href);url.searchParams.set('lat',place.lat);url.searchParams.set('lon',place.lon);url.searchParams.set('place',place.id);
    if(navigator.share)try{await navigator.share({title:place.name,text:'맛집한눈에서 확인한 식당',url:url.href});return;}catch{}
    try{await navigator.clipboard.writeText(url.href);toast('공유 링크를 복사했습니다.');}catch{toast('브라우저에서 링크 복사를 허용해 주세요.');}
  };
}
function renderSavedLocations() {
  const list=$('#saved-location-list');
  list.innerHTML=state.savedLocations.length ? state.savedLocations.map((p,i)=>`<div class="location-result"><button type="button" data-locidx="${i}" class="location-result-name" style="background:transparent;text-align:left;color:#43644d">📍 ${safeText(p.name)}</button><button type="button" data-delete-loc="${i}" title="위치 삭제" aria-label="${safeText(p.name)} 삭제">삭제</button></div>`).join('') : '<p class="empty-search-line">아직 저장한 동네가 없습니다.</p>';
}
function showDialog(selector) {const dialog=$(selector); if(!dialog.open)dialog.showModal();}
function closeAll() {document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
function installSheetDrag() {
  const sheet=$('#sheet'), handle=$('#sheet-handle');
  let startingY=0,startingHeight=0, dragging=false, moved=false;
  const vh=()=>window.innerHeight;
  function finalize(){
    const pct=Math.round((sheet.getBoundingClientRect().height/vh())*100);
    sheet.style.height='';sheet.dataset.level=pct<51?'compact':pct<77?'expanded':'full';
    handle.setAttribute('aria-valuenow',String(pct));
    state.map?.resize();
  }
  handle.addEventListener('pointerdown',e=>{
    if(window.innerWidth>850)return;
    dragging=true;moved=false;startingY=e.clientY;startingHeight=sheet.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging)return;
    if(Math.abs(startingY-e.clientY)>8)moved=true;
    if(!moved)return;
    const next=Math.min(.9*vh(),Math.max(.25*vh(),startingHeight+startingY-e.clientY));
    sheet.style.height=`${Math.round(next)}px`;
  });
  handle.addEventListener('pointerup',()=>{if(!dragging)return;dragging=false;if(!moved){const levels=['compact','expanded','full'];const i=levels.indexOf(sheet.dataset.level);sheet.style.height='';sheet.dataset.level=levels[(i+1)%3];handle.setAttribute('aria-valuenow',String([40,66,90][(i+1)%3]));}else finalize()});
  handle.addEventListener('pointercancel',()=>{if(!dragging)return;dragging=false;finalize()});
  handle.addEventListener('keydown',e=>{
    if(!['ArrowUp','ArrowDown','Enter',' '].includes(e.key))return;e.preventDefault();
    const levels=['compact','expanded','full'],n=levels.indexOf(sheet.dataset.level);
    const m=e.key==='ArrowDown'?Math.max(0,n-1):Math.min(2,n+1);
    sheet.style.height='';sheet.dataset.level=levels[m];handle.setAttribute('aria-valuenow',String([40,66,90][m]));
  });
}
function installDetailDrag() {
  const handle=$('#resize-detail'), dialog=$('#detail-dialog');
  let start=0,height=0,moving=false;
  handle.onpointerdown=e=>{if(window.innerWidth>850)return;start=e.clientY;height=dialog.getBoundingClientRect().height;moving=false;handle.setPointerCapture(e.pointerId);};
  handle.onpointermove=e=>{if(!handle.hasPointerCapture(e.pointerId))return; if(Math.abs(start-e.clientY)>8)moving=true; if(moving)dialog.style.height=`${Math.min(innerHeight*.94,Math.max(innerHeight*.32,height+start-e.clientY))}px`;};
  const end=e=>{if(!handle.hasPointerCapture(e.pointerId))return;handle.releasePointerCapture(e.pointerId);if(moving){ const p=dialog.getBoundingClientRect().height/innerHeight;dialog.dataset.level=p<.48?'compact':p<.79?'expanded':'full';dialog.style.height='';if(e.type==='pointerup')handle.dataset.ignoreClick='1';}};
  handle.onpointerup=end;handle.onpointercancel=end;
}
function bindEvents(){
  $('#context-chips').addEventListener('click',e=>{
    const btn=e.target.closest('[data-context]');if(!btn)return;
    state.settings.context=btn.dataset.context;persist();renderChips();renderResults();
  });
  $('#category-chips').addEventListener('click',e=>{
    const btn=e.target.closest('[data-category]');if(!btn)return;
    state.settings.category=btn.dataset.category;persist();renderChips();renderResults();
  });
  $('#radius-button').onclick=async()=>{
    const choices=[1000,2400,5000];let index=choices.indexOf(state.settings.radius);index=(index+1)%choices.length;
    state.settings.radius=choices[index];persist();renderChips();await loadRestaurants();
  };
  $('#sort-select').onchange=e=>{state.settings.sort=e.target.value;persist();renderResults()};
  $('#search-form').onsubmit=e=>{e.preventDefault();state.search=$('#restaurant-search').value.trim();renderResults();if(window.innerWidth<=850)$('#sheet').dataset.level='full'};
  $('#restaurant-search').addEventListener('input',e=>{state.search=e.target.value.trim();renderResults()});
  $('#restaurant-list').addEventListener('click',e=>{
    const save=e.target.closest('[data-save]');if(save){e.stopPropagation();toggleFavorite(save.dataset.save);return;}
    const card=e.target.closest('[data-open]');if(card)openDetail(card.dataset.open);
    if(e.target.closest('#clear-filters')){
      state.search='';state.favoritesOnly=false;$('#restaurant-search').value='';state.settings.category='all';state.settings.context='balanced';persist();renderChips();renderResults();
    }
    if(e.target.closest('#retry-load'))loadRestaurants();
  });
  $('#restaurant-list').addEventListener('keydown',e=>{
    if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-open]')){e.preventDefault();openDetail(e.target.dataset.open);}
  });
  $('#detail-content').addEventListener('click',e=>{const btn=e.target.closest('[data-save]');if(btn)toggleFavorite(btn.dataset.save)});
  $('#detail-dialog').addEventListener('close',()=>{state.selectedId=null;$('#app').classList.remove('map-focus');renderResults();});
  $('#location-edit').onclick=()=>{renderSavedLocations();showDialog('#location-dialog')};
  $('#mobile-location').onclick=$('#location-edit').onclick;
  $('#map-my-location').onclick=()=>useCurrentPosition();
  $('#location-use-current').onclick=()=>useCurrentPosition();
  $('#search-map-area').onclick=()=>{
    if(!state.map)return toast('지도가 아직 준비되지 않았습니다.');
    const pos=state.map.getCenter();setLocation({lat:pos.lat,lon:pos.lon,name:'지도 중심 · 선택한 지역'},{isCurrent:false,suppressReverse:true});
  };
  $('#location-form').onsubmit=async e=>{
    e.preventDefault();const q=$('#location-query').value.trim();const results=$('#location-search-results');
    results.innerHTML='<p class="empty-search-line">주소를 검색하는 중입니다...</p>';
    try{
      const locations=await lookupLocations(q);
      results.innerHTML=locations.length ? locations.map((p,i)=>`<button class="location-result" type="button" data-searchloc="${i}"><span class="location-result-name">📍 ${safeText(p.name)}</span><span>›</span></button>`).join('') : '<p class="empty-search-line">주소 검색 결과가 없습니다.</p>';
      results.querySelectorAll('[data-searchloc]').forEach(b=>b.onclick=()=>{
        const p=locations[Number(b.dataset.searchloc)];closeAll();setLocation(p,{isCurrent:false,suppressReverse:true});
      });
    }catch(err){results.innerHTML=`<p class="empty-search-line">${safeText(err.message)}</p>`;}
  };
  $('#saved-location-list').addEventListener('click',e=>{
    const del=e.target.closest('[data-delete-loc]');if(del){state.savedLocations.splice(Number(del.dataset.deleteLoc),1);persist();renderSavedLocations();return;}
    const btn=e.target.closest('[data-locidx]');if(!btn)return;
    const loc=state.savedLocations[Number(btn.dataset.locidx)];closeAll();setLocation(loc,{isCurrent:false,suppressReverse:true});
  });
  $('#save-current-location').onclick=()=>{
    if(state.savedLocations.some(p=>Math.abs(p.lat-state.location.lat)<.00001&&Math.abs(p.lon-state.location.lon)<.00001))return toast('이미 저장한 동네입니다.');
    state.savedLocations.push({lat:state.location.lat,lon:state.location.lon,name:state.location.name});persist();renderSavedLocations();toast('자주 찾는 동네에 저장했습니다.');
  };
  $('#settings-open').onclick=()=>{updateSettingsModal();showDialog('#settings-dialog')};
  $('#settings-footer').onclick=$('#settings-open').onclick;
  $('#favorites-only').onchange=e=>{state.favoritesOnly=e.target.checked;renderResults()};
  $('#export-data').onclick=()=>{
    const blob=new Blob([exportArchive()],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`맛집한눈-내기록-${new Date().toISOString().slice(0,10)}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);toast('로컬 맛집 기록 백업 파일을 생성했습니다.');
  };
  $('#import-data').onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(file.size>3_000_000)return toast('3MB 이하의 JSON 백업을 선택해 주세요.');
    try{
      importArchive(await file.text());
      state.favorites=readStore('favorites');state.reviews=readStore('reviews');state.savedLocations=readStore('savedLocations');
      state.settings={...state.settings,...readStore('settings')};renderChips();renderResults();updateSettingsModal();toast('백업을 복원했습니다.');
    }catch(err){toast(err.message)}finally{e.target.value=''}
  };
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$('#'+btn.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()}));
  installSheetDrag();
}
function updateSettingsModal(){
  $('#saved-count').textContent=Object.keys(state.favorites).length;
  $('#reviews-count').textContent=Object.keys(state.reviews).length;
  $('#favorites-only').checked=state.favoritesOnly;
}
async function boot(){
  renderChips();createMap();bindEvents();updateLocationLabel();
  $('#sheet').dataset.level='expanded';
  $('#detail-dialog').dataset.level='expanded';
  const params=new URLSearchParams(location.search);
  const lat=Number(params.get('lat')),lon=Number(params.get('lon'));
  if(params.has('lat')&&params.has('lon')&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
    await setLocation({lat,lon,name:'공유받은 식당 주변'},{isCurrent:false,suppressReverse:true});
    const placeId=params.get('place');if(placeId&&state.places.some(p=>p.id===placeId))openDetail(placeId);
  }else await useCurrentPosition(true);
  if('serviceWorker' in navigator && location.protocol==='https:' && !location.hostname.endsWith('androidplatform.net')){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
}
boot().catch(err=>{console.error(err);setLoader(false);toast('앱 초기화에 실패했습니다. 페이지를 새로고침해 주세요.')});
