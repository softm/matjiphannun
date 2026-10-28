#!/usr/bin/env python3
"""Resume public restaurant web enrichment without API keys or private user data.

KTO's public restaurant sitemap and the read-only request used by its print page
are the primary source. Owner websites are followed only after identity checks.
Full pages, visitors' reviews, user photos, and credentials are never published.
"""
import argparse, base64, concurrent.futures, gzip, hashlib, html, ipaddress
import json, math, os, pathlib, re, socket, threading, time
import urllib.error, urllib.parse, urllib.request, urllib.robotparser
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
KTO = 'https://korean.visitkorea.or.kr'
SITEMAP = KTO + '/restaurants_sitemap.xml'
UA = 'matjiphannun-web-collector/0.3 (+https://github.com/softm/matjiphannun)'
KST = timezone(timedelta(hours=9))
FIELDS = {'firstMenu':'signatureMenu','treatMenu':'menu','openTime':'hours',
          'restDate':'closedDays','parking':'parking','parkingFee':'parkingFee',
          'reservation':'reservation','reservationUrl':'reservationUrl',
          'seat':'seats','accomCount':'capacity','packing':'takeaway',
          'smoking':'smoking','chkCreditCard':'payment','kidsFacility':'children'}
LABELS = {'signatureMenu':'대표 메뉴','menu':'취급 메뉴','hours':'영업시간',
          'closedDays':'휴무일','parking':'주차','parkingFee':'주차 요금',
          'reservation':'예약','reservationUrl':'예약 웹사이트','seats':'좌석',
          'capacity':'수용 인원','takeaway':'포장','smoking':'흡연','payment':'결제',
          'children':'어린이 편의','phone':'업소 전화','website':'업소 웹사이트',
          'price':'업소 표기 가격대','breakTime':'휴식시간','lastOrder':'마지막 주문'}

def now(): return datetime.now(KST).isoformat(timespec='seconds')
def clean(value, limit=1800):
    text = re.sub(r'<br\s*/?>|</(?:p|li|div)>', ' · ', str(value or ''), flags=re.I)
    text = html.unescape(re.sub(r'<[^>]*>', ' ', text))
    text = re.sub(r'\s+', ' ', text).strip(' ·\t\n')
    return '' if text.lower() in ('null','none','undefined','-','정보없음') else text[:limit]
def token(value): return re.sub(r'[^0-9a-z가-힣]', '', clean(value).lower())
def load(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default
def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')))
    os.replace(temp, path)
def unpack(data):
    if data.get('encoding') == 'gzip-base64':
        return json.loads(gzip.decompress(base64.b64decode(data['data'])))
    return data

def safe_url(url):
    try:
        u = urllib.parse.urlsplit(html.unescape(str(url)))
        if u.scheme not in ('http','https') or not u.hostname or u.username or u.password:
            return False
        if u.port not in (None,80,443) or u.hostname.lower() in ('localhost','metadata.google.internal'):
            return False
        try: return ipaddress.ip_address(u.hostname).is_global
        except ValueError: return '.' in u.hostname and not u.hostname.endswith(('.local','.internal'))
    except ValueError: return False

def public_host(url):
    if not safe_url(url): raise ValueError('unsafe URL')
    host = urllib.parse.urlsplit(url).hostname
    # The single fixed KTO host is also used behind HTTPS proxies without local
    # DNS. Arbitrary owner URLs still require public DNS on every redirect.
    if host=='korean.visitkorea.or.kr':return
    for result in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(result[4][0]).is_global:
            raise ValueError('non-public destination')

class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_host(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

class Network:
    def __init__(self, interval=.8, timeout=25):
        self.interval=interval; self.timeout=timeout; self.lock=threading.Lock()
        self.last=0.; self.robots={}; self.robots_lock=threading.Lock()
        self.opener=urllib.request.build_opener(PublicRedirect())
    def raw(self, url, form=None, limit=5_000_000):
        public_host(url)
        with self.lock:
            delay=self.interval-(time.monotonic()-self.last)
            if delay>0: time.sleep(delay)
            self.last=time.monotonic()
        data=urllib.parse.urlencode(form).encode() if form is not None else None
        req=urllib.request.Request(url,data=data,headers={'User-Agent':UA,'Accept':'application/json,text/html,application/xml','Content-Type':'application/x-www-form-urlencoded'})
        with self.opener.open(req,timeout=self.timeout) as response:
            raw=response.read(limit+1)
            if len(raw)>limit: raise ValueError('response too large')
            return raw.decode(response.headers.get_content_charset() or 'utf-8',errors='replace'), response.geturl()
    def allowed(self, url):
        u=urllib.parse.urlsplit(url); origin=u.scheme+'://'+u.netloc
        with self.robots_lock:
            if origin not in self.robots:
                parser=urllib.robotparser.RobotFileParser()
                try: raw,_=self.raw(origin+'/robots.txt',limit=100_000); parser.parse(raw.splitlines())
                except urllib.error.HTTPError as err:
                    parser.parse(['User-agent: *','Allow: /' if err.code==404 else 'Disallow: /'])
                except Exception: parser.parse(['User-agent: *','Disallow: /'])
                self.robots[origin]=parser
            return self.robots[origin].can_fetch(UA,url)
    def get(self,url,form=None):
        if not self.allowed(url): raise ValueError('robots disallow or unavailable')
        for attempt in range(3):
            try: return self.raw(url,form)
            except urllib.error.HTTPError as err:
                if err.code not in (429,500,502,503,504) or attempt==2: raise
                time.sleep(min(30,2**(attempt+1)))
            except (urllib.error.URLError,TimeoutError):
                if attempt==2: raise
                time.sleep(2**attempt)

def sitemap_entries(text):
    root=ET.fromstring(text); result=[]; seen=set()
    for item in root.findall('{*}url'):
        url=item.findtext('{*}loc',''); mod=item.findtext('{*}lastmod','')
        u=urllib.parse.urlsplit(url); cid=urllib.parse.parse_qs(u.query).get('cotid',[''])[0]
        if u.hostname!='korean.visitkorea.or.kr' or u.path!='/detail/ms_detail.do' or not re.fullmatch(r'[a-f0-9-]{36}',cid): continue
        if cid not in seen: result.append({'cotid':cid,'modified':mod}); seen.add(cid)
    if not result: raise ValueError('restaurant sitemap empty or changed')
    return result

def fact(key,value,url,checked,source_date='',label=None,source='한국관광공사'):
    return {'key':key,'label':label or LABELS.get(key,key),'value':clean(value),
            'sourceUrl':url,'sourceName':source,'checkedAt':checked,'sourceDate':source_date,
            'basis':'source-reported'}

def make_points(facts):
    points=[]; conflicts=[]; bykey={}
    for f in facts: bykey.setdefault(f['key'],[]).append(f)
    for key, items in bykey.items():
        if len({f['sourceUrl'] for f in items})>1 and len({token(f['value']) for f in items})>1:
            conflicts.append({'key':key,'label':items[0]['label'],'values':items})
    order=['signatureMenu','breakTime','lastOrder','parking','closedDays','reservation','hours','takeaway','seats','capacity','price']
    ordered=sorted(facts,key=lambda f:order.index(f['key']) if f['key'] in order else len(order))
    for f in ordered:
        key=f['key']; value=f['value']
        if not value or key in ('menu','phone','website','reservationUrl','payment'): continue
        kind='fact'
        if key in ('breakTime','lastOrder') or key=='hours' and re.search(r'브레이크|준비\s*시간|휴식',value): kind='caution'
        if key=='parking' and re.search(r'불가|없음|불가능|유료|협소|[12]\s*(면|대)',value): kind='caution'
        if key in ('closedDays','reservation') and re.search(r'휴무|제외|필수|사전|불가',value):kind='caution'
        if any(c['key']==key for c in conflicts):kind='conflict'
        points.append({'label':f['label'],'text':value[:220],'kind':kind,'evidence':f})
    return points,conflicts

def normalize_kto(data, entry, targets, checked):
    if data.get('header',{}).get('process')!='success': raise ValueError('KTO response rejected')
    body=data.get('body',{}); articles=body.get('article',[])
    if not articles: return None,'unavailable'
    a=articles[0]
    if str(a.get('contentType'))!='39' or str(a.get('contentStatus'))!='2':return None,'unavailable'
    p=targets.get(str(a.get('cid','')))
    if not p:return None,'unmatched'
    address=' '.join(filter(None,[clean(a.get('addr1')),clean(a.get('addr2'))]))
    # A content ID alone is insufficient when a provider reassigns/renames it.
    if token(p['name'])!=token(a.get('title')) or token(p['address'])!=token(address):return None,'identity-mismatch'
    try:
        if abs(float(a['mapY'])-p['lat'])>.001 or abs(float(a['mapX'])-p['lon'])>.001:return None,'identity-mismatch'
    except (KeyError,ValueError,TypeError):return None,'identity-mismatch'
    url=KTO+'/detail/ms_detail.do?cotid='+entry['cotid']; date=entry.get('modified','')
    facts=[]
    for source,key in FIELDS.items():
        if clean(a.get(source)):facts.append(fact(key,a[source],url,checked,date))
    for part in clean(a.get('openTime')).split(' · '):
        if re.search(r'브레이크|준비\s*시간|휴식',part):facts.append(fact('breakTime',part,url,checked,date))
        if re.search(r'마지막\s*주문|라스트\s*오더',part):facts.append(fact('lastOrder',part,url,checked,date))
    overview=clean(a.get('overView'),6000)
    for label,pattern in [('포장 안내',r'포장'),('단체 이용',r'단체석|단체\s*이용|단체\s*예약'),('반려동물 안내',r'반려동물|애견'),('전망 안내',r'오션뷰|바다\s*전망|강\s*전망|호수\s*전망')]:
        sentences=[s.strip() for s in re.split(r'(?<=[다요])\.|[\n\r]',overview) if re.search(pattern,s)]
        if sentences:facts.append(fact('feature:'+label,sentences[0][:240],url,checked,date,label+' (원천 소개)'))
    # tel is the tourism content manager; infoCenter/telNo identify the restaurant.
    phone=clean(a.get('infoCenter') or a.get('telNo'))
    if phone:facts.append(fact('phone',phone,url,checked,date))
    website=extract_url(a.get('homepage',''))
    if website:facts.append(fact('website',website,url,checked,date))
    for row in body.get('barrierFree',[]):
        title=clean(row.get('TITLE')); value=clean(row.get('DETAIL_TEXT'))
        if title and value:facts.append(fact('access:'+title,value,url,checked,date,title))
    for row in body.get('subArticle',[]):
        title=clean(row.get('displayTitle')); value=clean(row.get('contentBody'))
        if title and value:facts.append(fact('facility:'+title,value,url,checked,date,title))
    # Collapse duplicate source fields, preserving negative statements verbatim.
    facts=list({(f['key'],f['value']):f for f in facts}.values())
    points,conflicts=make_points(facts)
    images=[]
    for image in body.get('image',[]):
        license=image.get('cpyrhtDivCd') or image.get('license')
        image_url=image.get('originimgurl') or image.get('url','')
        if license in ('Type1','Type3') and urllib.parse.urlsplit(image_url).hostname=='tong.visitkorea.or.kr':
            images.append({'url':image_url.replace('http:','https:',1),'license':license,'author':'한국관광공사','sourceUrl':url,'caption':clean(image.get('imgAlt'))})
    result={'id':p['id'],'name':p['name'],'address':p['address'],'lat':p['lat'],'lon':p['lon'],
            'tourId':str(a['cid']),'checkedAt':checked,'sourceDate':date,'sourceUrl':url,
            'facts':facts,'points':points,'conflicts':conflicts,'images':images,
            'photoGallery':{'count':len(body.get('image',[])),'sourceUrl':url,'rights':'per-image-license-required',
                            'items':[{'sourceImageId':str(i.get('imgPath','')),'caption':clean(i.get('imgAlt')),'rights':'unverified'} for i in body.get('image',[])]},
            'website':website}
    return result,'matched'

class StructuredPage(HTMLParser):
    def __init__(self):super().__init__();self.in_json=False;self.raw='';self.docs=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and dict(attrs).get('type','').lower()=='application/ld+json':self.in_json=True;self.raw=''
    def handle_data(self,data):
        if self.in_json:self.raw+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.in_json:
            self.in_json=False
            try:self.docs.append(json.loads(self.raw))
            except json.JSONDecodeError:pass

def extract_url(value):
    text=html.unescape(str(value or ''))
    match=re.search(r'https?://[^\s<>"\']+',text)
    url=match.group(0) if match else ''
    return url if safe_url(url) else ''

def owner_facts(text,url,target,checked):
    parser=StructuredPage();parser.feed(text); nodes=[]
    def walk(node):
        if isinstance(node,list):
            for item in node:walk(item)
        if isinstance(node,dict):
            nodes.append(node)
            for key in ('@graph','mainEntity','itemListElement'):walk(node.get(key))
    walk(parser.docs); results=[]
    for node in nodes:
        types=node.get('@type',[]);types=[types] if isinstance(types,str) else types
        if not set(types)&{'Restaurant','CafeOrCoffeeShop','FoodEstablishment','Bakery'}:continue
        addr=node.get('address',{});addr=addr if isinstance(addr,dict) else {}
        address=' '.join(str(addr.get(k,'')) for k in ('addressRegion','addressLocality','streetAddress'))
        street=token(addr.get('streetAddress',''))
        if token(node.get('name'))!=token(target['name']) or not street or street not in token(target['address']):continue
        # Reject a same-name branch unless street + building number match.
        if not re.search(r'\d',street):continue
        def add(key,value):
            if clean(value):results.append(fact(key,value,url,checked,source='업소 공개 웹사이트'))
        add('phone',node.get('telephone'))
        hours=node.get('openingHours')
        if isinstance(hours,(str,list)):add('hours',' · '.join(hours) if isinstance(hours,list) else hours)
        for h in node.get('openingHoursSpecification',[]) if isinstance(node.get('openingHoursSpecification'),list) else []:
            if isinstance(h,dict):add('hours',clean(h.get('dayOfWeek'))+' '+clean(h.get('opens'))+'~'+clean(h.get('closes')))
        if node.get('acceptsReservations') is not None:add('reservation',{True:'예약 가능으로 기재',False:'예약 불가로 기재'}.get(node['acceptsReservations'],str(node['acceptsReservations'])) if isinstance(node['acceptsReservations'],(str,bool)) else '')
        add('price',node.get('priceRange'))
        menus=node.get('hasMenu',[]);menus=menus if isinstance(menus,list) else [menus]
        def menu_items(value):
            if isinstance(value,list):
                for child in value:yield from menu_items(child)
            elif isinstance(value,dict):
                if value.get('@type')=='MenuItem':yield value
                for key in ('hasMenuSection','hasMenuItem'):yield from menu_items(value.get(key))
        for item in menu_items(menus):
            name=clean(item.get('name'));offers=item.get('offers',[]);offers=offers if isinstance(offers,list) else [offers]
            for offer in offers:
                if not isinstance(offer,dict):continue
                price=str(offer.get('price',''));currency=clean(offer.get('priceCurrency'))
                if name and re.fullmatch(r'\d+(\.\d+)?',price) and currency:
                    results.append(fact('menuPrice:'+name,name+' · '+price+' '+currency,url,checked,label='메뉴 가격',source='업소 공개 웹사이트'))
        # Photos and reviews require separate publication rights; never infer them.
    return list({(f['key'],f['value']):f for f in results}.values())

def load_targets(data):
    manifest=unpack(load(data/'manifest.json')); targets={}
    for shard in manifest['shards']:
        for p in unpack(load(data/shard['path']))['places']:
            tid=p.get('sourceIds',{}).get('tour')
            if tid:targets[str(tid)]=p
    return manifest,targets

def publish(data,records,state):
    groups={}
    for record in records.values():
        cell=f"{math.floor(record['lon']*40)}-{math.floor(record['lat']*40)}"
        groups.setdefault(cell,{})[record['id']]=record
    base=data/'enrichment'; shards=[]
    for cell,items in sorted(groups.items()):
        payload={'records':items};path='regions/'+cell+'.json'
        write(base/path,payload)
        shards.append({'cell':cell,'path':path,'count':len(items),'sha256':hashlib.sha256((base/path).read_bytes()).hexdigest()})
    checked=now(); counts={}
    for r in records.values():
        for key in {f['key'] for f in r['facts']}:counts[key]=counts.get(key,0)+1
    status={'generatedAt':checked,'source':'한국관광공사 공개 음식점 웹·업소 구조화 웹',
            'sitemapTotal':len(state['entries']),'attempted':len(state['results']),
            'outcomes':dict(__import__('collections').Counter(v['status'] for v in state['results'].values())),
            'remaining':sum(e['cotid'] not in state['results'] or state['results'][e['cotid']]['status']=='retry' for e in state['entries']),
            'enriched':len(records),'facts':sum(len(r['facts']) for r in records.values()),
            'points':sum(len(r['points']) for r in records.values()),'fieldCoverage':counts,
            'sourcePhotoReferences':sum(r['photoGallery']['count'] for r in records.values()),
            'licensedAdditionalImages':sum(len(r['images']) for r in records.values()),
            'ownerChecked':sum(bool(r.get('ownerCheckedAt')) for r in records.values()),
            'limitations':['공개 웹에 연결된 음식점부터 수집. 전국 모든 식당의 세부정보 확보를 의미하지 않음',
                            '사진별 이용조건 확인 후 앱에 표시. 미확인 사진은 공식 갤러리 링크만 제공',
                            '원천에 기재된 정보이며 실시간 영업·맛·혼잡도 검증 아님']}
    write(base/'status.json',status)
    write(base/'manifest.json',{'version':checked,'shards':shards})
    return status

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',default=str(ROOT/'data'))
    ap.add_argument('--state',default=str(ROOT/'.collection/web-state.json'))
    ap.add_argument('--limit',type=int,default=1800);ap.add_argument('--seconds',type=int,default=2700)
    ap.add_argument('--workers',type=int,default=3);ap.add_argument('--interval',type=float,default=.8)
    ap.add_argument('--owner-limit',type=int,default=100);ap.add_argument('--refresh-sitemap',action='store_true')
    args=ap.parse_args();data=pathlib.Path(args.data);state_path=pathlib.Path(args.state)
    network=Network(max(.5,args.interval));started=time.monotonic()
    state=load(state_path,{'entries':[],'results':{}})
    last=datetime.fromisoformat(state.get('sitemapCheckedAt','2000-01-01T00:00:00+09:00'))
    if not state['entries'] or args.refresh_sitemap or datetime.now(KST)-last>timedelta(days=7):
        raw,_=network.get(SITEMAP);entries=sitemap_entries(raw)
        old={e['cotid']:e.get('modified') for e in state['entries']}
        for entry in entries:
            if old.get(entry['cotid'])!=entry.get('modified'):state['results'].pop(entry['cotid'],None)
        state['entries']=entries;state['sitemapCheckedAt']=now();write(state_path,state)
    # Recheck unchanged source pages monthly too; their sitemap dates can be stale.
    for cid,result in list(state['results'].items()):
        if datetime.now(KST)-datetime.fromisoformat(result['checkedAt'])>timedelta(days=30):
            del state['results'][cid]
    _,targets=load_targets(data);records={}
    for file in sorted((data/'enrichment/regions').glob('*.json')):
        records.update(load(file,{}).get('records',{}))
    pending=[e for e in state['entries'] if e['cotid'] not in state['results'] or (state['results'][e['cotid']]['status']=='retry' and state['results'][e['cotid']].get('attempts',0)<3)]
    if pending and not network.allowed(KTO+'/call'):
        raise SystemExit('Source robots rules unavailable or disallow collection; queue retained')
    def collect(entry):
        cid=entry['cotid'];check=now();old=state['results'].get(cid,{})
        try:
            raw,_=network.get(KTO+'/call',{'cmd':'TOUR_CONTENT_BODY_VIEW','cotid':cid,'locationx':'0','locationy':'0','stampId':''})
            record,status=normalize_kto(json.loads(raw),entry,targets,check)
            return cid,record,{'status':status,'checkedAt':check,'attempts':old.get('attempts',0)+1}
        except Exception as err:
            # Only a safe error category; request URLs, raw responses and stacks stay private.
            attempts=old.get('attempts',0)+1
            return cid,None,{'status':'retry' if attempts<3 else 'review-needed','checkedAt':check,'attempts':attempts,'error':type(err).__name__}
    owner_pending=[r for r in records.values() if r.get('website') and not r.get('ownerCheckedAt')]
    if not pending and not owner_pending:
        print(json.dumps(load(data/'enrichment/status.json',{}),ensure_ascii=False));return
    processed=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(args.workers,4))) as pool:
        for i in range(0,min(len(pending),args.limit),max(1,args.workers)):
            if time.monotonic()-started>args.seconds:break
            for cid,record,result in pool.map(collect,pending[i:i+args.workers]):
                state['results'][cid]=result
                if record:
                    old=records.get(record['id'],{})
                    for key in ('ownerCheckedAt','ownerFacts'): 
                        if key in old:record[key]=old[key]
                    if record.get('ownerFacts'):
                        record['facts']+=record['ownerFacts'];record['points'],record['conflicts']=make_points(record['facts'])
                    records[record['id']]=record
                processed+=1
            if processed%30<max(1,args.workers):
                write(state_path,state);publish(data,records,state)
                print(json.dumps({'processedThisRun':processed,'enriched':len(records),'queue':len(state['entries'])}),flush=True)
            if processed>=9 and all(state['results'][e['cotid']]['status']=='retry' for e in pending[:processed]):break
    owners=0
    for record in records.values():
        if owners>=args.owner_limit or time.monotonic()-started>args.seconds:break
        url=record.get('website','');host=urllib.parse.urlsplit(url).hostname or ''
        if not url or record.get('ownerCheckedAt') or any(host==h or host.endswith('.'+h) for h in ['naver.com','naver.me','instagram.com','facebook.com','kakao.com','blogspot.com']):continue
        owners+=1
        try:
            raw,final=network.get(url)
            if urllib.parse.urlsplit(final).hostname not in (host,'www.'+host,host.removeprefix('www.')):continue
            facts=owner_facts(raw,final,record,now());record['ownerFacts']=facts
            record['facts']+=facts;record['points'],record['conflicts']=make_points(record['facts'])
            record['ownerCheckedAt']=now()
        except Exception:pass
    write(state_path,state);status=publish(data,records,state)
    print(json.dumps(status,ensure_ascii=False),flush=True)
    if processed and all(state['results'][e['cotid']]['status']=='retry' for e in pending[:processed]):
        raise SystemExit('No source responses succeeded; previous enrichment remains available')

if __name__=='__main__':main()
