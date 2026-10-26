#!/usr/bin/env python3
"""Collect public restaurant data. API keys are read only by this offline job.

Raw responses/checkpoints stay in --cache. The public output is built from an
explicit allow-list and published only after pagination and schema validation.
"""
import argparse, base64, concurrent.futures, csv, gzip, hashlib, html, io, json, math, os, pathlib, re, shutil, sys, tempfile, time, zipfile
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from collections import Counter
KST = timezone(timedelta(hours=9))
SBIZ = 'https://apis.data.go.kr/B553077/api/open/sdsc2'
TOUR = 'https://apis.data.go.kr/B551011/KorService2'
SOURCE_URLS = {'sbiz':'https://www.data.go.kr/data/15012005/openapi.do','tour':'https://www.data.go.kr/data/15101578/openapi.do','food':'https://www.foodsafetykorea.go.kr/api/openApiInfo.do?svc_no=C004&menu_grp=MENU_GRP31&menu_no=661'}
class CollectionError(Exception): pass

def now(): return datetime.now(KST).isoformat(timespec='seconds')
def clean(value): return html.unescape(re.sub(r'<[^>]*>', ' ', str(value or ''))).strip()
def token(value): return re.sub(r'[^0-9a-z가-힣]', '', clean(value).lower())
def korean_coord(lat,lon):
    try: return 32<=float(lat)<=39.5 and 124<=float(lon)<=132
    except (ValueError,TypeError): return False

def request_json(base, params=None, key=None, key_param='serviceKey'):
    query = dict(params or {})
    if key: query[key_param] = urllib.parse.unquote(key)
    url = base + ('?' + urllib.parse.urlencode(query) if query else '')
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'matjiphannun-data-collector/0.2','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=45) as response: raw=response.read().decode('utf-8-sig')
            data=json.loads(raw)
            if 'OpenAPI_ServiceResponse' in data:
                code=data['OpenAPI_ServiceResponse'].get('cmmMsgHeader',{}).get('returnReasonCode','unknown')
                raise CollectionError('API gateway error '+str(code))
            return data
        except urllib.error.HTTPError as err:
            if err.code not in (429,500,502,503,504): raise CollectionError('HTTP '+str(err.code)) from None
            if err.code==429: raise CollectionError('API quota exceeded') from None
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError): pass
        if attempt<2: time.sleep(2**attempt)
    raise CollectionError('Network or JSON response failed after 3 attempts')

def unpack(data,source):
    root=data.get('response',data)
    header=root.get('header',{})
    if str(header.get('resultCode','')) not in ('00','0000','0'): raise CollectionError(source+' response code '+str(header.get('resultCode','missing')))
    body=root.get('body',{})
    items=body.get('items',{})
    if isinstance(items,dict): items=items.get('item',[])
    if not items: items=[]
    if isinstance(items,dict):items=[items]
    if not isinstance(items,list):raise CollectionError(source+' item schema mismatch')
    total=int(body.get('totalCount',-1))
    if total<0:raise CollectionError(source+' missing totalCount')
    return items,total

def paged(source,op,params,key,cache):
    target=cache/source;target.mkdir(parents=True,exist_ok=True)
    def get(page):
        checkpoint=target/f'page-{page}.json'
        if checkpoint.exists(): return json.loads(checkpoint.read_text())
        d=request_json((SBIZ if source=='sbiz' else TOUR)+'/'+op,{**params,'numOfRows':1000,'pageNo':page},key,'ServiceKey' if source=='sbiz' else 'serviceKey')
        items,total=unpack(d,source)
        if source=='sbiz':
            for row in items:row.setdefault('stdrDt',d.get('header',{}).get('stdrYm'))
        checkpoint.write_text(json.dumps({'rows':items,'total':total},ensure_ascii=False));return {'rows':items,'total':total}
    first=get(1);total=first['total'];rows=first['rows'];pages=math.ceil(total/1000)
    if total==0: raise CollectionError(source+' returned zero rows; retain previous release')
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(get,range(2,pages+1)):
            if result['total']!=total:raise CollectionError(source+' changed total while collecting; retry a consistent snapshot')
            rows.extend(result['rows'])
    id_key='bizesId' if source=='sbiz' else 'contentid'
    if len(rows)!=total or len({r.get(id_key) for r in rows})!=total:raise CollectionError(source+' incomplete or repeated pagination')
    return rows,total

def food_rows(key,cache):
    target=cache/'food';target.mkdir(parents=True,exist_ok=True)
    def get(page):
        checkpoint=target/f'page-{page}.json'
        if checkpoint.exists():return json.loads(checkpoint.read_text())
        start=(page-1)*1000+1
        for attempt in range(4):
            d=request_json('https://openapi.foodsafetykorea.go.kr/api/'+key+'/C004/json/'+str(start)+'/'+str(start+999)).get('C004',{})
            if d.get('RESULT',{}).get('CODE')!='INFO-500':break
            time.sleep(2**attempt)
        if d.get('RESULT',{}).get('CODE')!='INFO-000':raise CollectionError('C004 response code '+str(d.get('RESULT',{}).get('CODE','missing')))
        # Remove personal/business registration fields before even checkpointing.
        allowed=['LCNS_NO','BSSH_NM','ADDR','HG_ASGN_NO','HG_ASGN_LV','ASGN_FROM','ASGN_TO','ASGN_CANCEL_YMD','CLSBIZ_DVS_CD_NM','CLSBIZ_DT','CHNG_DT']
        result={'rows':[{k:r.get(k,'') for k in allowed} for r in d.get('row',[])],'total':int(d['total_count'])}
        checkpoint.write_text(json.dumps(result,ensure_ascii=False));return result
    first=get(1);rows=first['rows'];total=first['total']
    # C004 rejects overlapping requests for the same key (INFO-500).
    for page in range(2,math.ceil(total/1000)+1):
        result=get(page)
        if result['total']!=total:raise CollectionError('C004 total changed during pagination')
        rows.extend(result['rows'])
        print('C004 page '+str(page)+'/'+str(math.ceil(total/1000)),flush=True)
    if len(rows)!=total:raise CollectionError('C004 incomplete pagination')
    return rows,total

def source_place(source,identifier,name,address,lat,lon,category,source_date,collected):
    if not identifier or not clean(name) or not korean_coord(lat,lon):return None
    amenity='cafe' if any(w in category for w in ['카페','커피','찻집']) else 'fast_food' if any(w in category for w in ['김밥','샌드위치','버거','피자','치킨','분식']) else 'restaurant'
    return {'id':source+':'+str(identifier),'source':source,'sourceIds':{source:str(identifier)},'name':clean(name),'address':clean(address),'lat':float(lat),'lon':float(lon),'amenity':amenity,'category':clean(category) or '음식점','phone':'','website':'','hours':'','tags':{},'images':[],'menu':[],'hygiene':None,'sourceUrl':SOURCE_URLS[source],'sourceDate':source_date or None,'collectedAt':collected}

def normalize_sbiz(r,collected):
    if r.get('indsLclsCd')!='I2':return None
    return source_place('sbiz',r.get('bizesId'),' '.join(filter(None,[r.get('bizesNm'),r.get('brchNm')])),r.get('rdnmAdr') or r.get('lnoAdr'),r.get('lat'),r.get('lon'),r.get('indsSclsNm',''),r.get('stdrDt'),collected)

def normalize_tour_tuple(r,collected):
    ident,name,address,lat,lon,image,license,modified,phone,region,district,category=r
    labels={'FD01':'한식','FD02':'외국식','FD03':'이색음식','FD04':'간편식','FD05':'카페·찻집'}
    p=source_place('tour',ident,name,address,lat,lon,labels.get(str(category)[:4],'음식점'),str(modified)[:8],collected)
    if not p:return None
    p['phone']=clean(phone);p['sourceIds']['tour']=str(ident)
    if license in ('Type1','Type3') and isinstance(image,str) and image.startswith(('https://tong.visitkorea.or.kr/','http://tong.visitkorea.or.kr/')):
        p['images']=[{'url':image.replace('http:','https:',1),'author':'한국관광공사','license':license,'sourceUrl':SOURCE_URLS['tour'],'contentId':str(ident)}]
    return p

def valid_hygiene(r,today):
    start=str(r.get('ASGN_FROM',''));end=str(r.get('ASGN_TO',''))
    return bool(re.fullmatch(r'\d{8}',start) and re.fullmatch(r'\d{8}',end) and start<=today<=end and not r.get('ASGN_CANCEL_YMD') and not r.get('CLSBIZ_DT') and r.get('CLSBIZ_DVS_CD_NM')=='정상' and r.get('HG_ASGN_LV'))

def combine(sbiz,tour,food,collected):
    places=[p for p in (normalize_sbiz(r,collected) for r in sbiz) if p]
    index={}
    for p in places:index.setdefault((token(p['name']),token(p['address'])),[]).append(p)
    tour_matches=0
    tour_keys=Counter((token(r[1]),token(r[2])) for r in tour)
    for r in tour:
        p=normalize_tour_tuple(r,collected)
        if not p:continue
        candidates=index.get((token(p['name']),token(p['address'])),[])
        # Exact full name/address, unique and nearby. Never match by distance alone.
        if len(candidates)==1 and tour_keys[(token(p['name']),token(p['address']))]==1 and abs(candidates[0]['lat']-p['lat'])<.0008 and abs(candidates[0]['lon']-p['lon'])<.0008:
            existing=candidates[0];existing['images']=p['images'];existing['phone']=p['phone'];existing['sourceIds']['tour']=p['sourceIds']['tour'];tour_matches+=1
        else: places.append(p)
    food_index={};today=collected[:10].replace('-','')
    for r in food:
        if valid_hygiene(r,today):food_index.setdefault((token(r['BSSH_NM']),token(r['ADDR'])),[]).append(r)
    matches=0
    place_keys=Counter((token(p['name']),token(p['address'])) for p in places)
    for p in places:
        candidates=food_index.get((token(p['name']),token(p['address'])),[])
        if len(candidates)!=1 or place_keys[(token(p['name']),token(p['address']))]!=1:continue
        r=candidates[0];p['hygiene']={'grade':clean(r['HG_ASGN_LV']),'validFrom':r['ASGN_FROM'],'validUntil':r['ASGN_TO'],'designationId':r['HG_ASGN_NO'],'sourceUrl':SOURCE_URLS['food'],'checkedAt':collected};matches+=1
    unique={p['id']:p for p in places}
    return list(unique.values()),{'tourMatches':tour_matches,'hygieneMatches':matches,'foodValid':sum(valid_hygiene(r,today) for r in food)}

def load_sbiz_zip(path,source_date):
    mapping={'상가업소번호':'bizesId','상호명':'bizesNm','지점명':'brchNm','도로명주소':'rdnmAdr','지번주소':'lnoAdr','위도':'lat','경도':'lon','상권업종대분류코드':'indsLclsCd','상권업종소분류명':'indsSclsNm'}
    rows=[];region_counts={};all_rows=0
    with zipfile.ZipFile(path) as archive:
        files=[name for name in archive.namelist() if name.lower().endswith('.csv')]
        if not files:raise CollectionError('Official ZIP contains no CSV')
        for name in files:
            with archive.open(name) as stream:
                reader=csv.DictReader(io.TextIOWrapper(stream,encoding='utf-8-sig',newline=''))
                if not set(mapping).issubset(set(reader.fieldnames or [])):raise CollectionError('Official CSV column schema changed')
                count=0
                for row in reader:
                    all_rows+=1
                    if row['상권업종대분류코드']!='I2':continue
                    item={v:row[k] for k,v in mapping.items()};item['stdrDt']=source_date
                    # Preserve floor/unit in the address used for conservative matching.
                    rows.append(item);count+=1
                region_counts[name]=count
                print('CSV processed: '+str(len(region_counts))+'/'+str(len(files))+'; food '+str(count),flush=True)
    if len(files)<16 or not all(region_counts.values()):raise CollectionError('Official nationwide CSV regions incomplete')
    if len({r['bizesId'] for r in rows})!=len(rows):raise CollectionError('Official CSV contains duplicate store IDs')
    return rows,{'files':len(files),'allIndustriesRows':all_rows,'foodRows':len(rows),'regionCounts':region_counts,'sourceDate':source_date}

def publish(places,stats,output,collected):
    if not places:raise CollectionError('No valid coordinates; previous release retained')
    version=datetime.now(KST).strftime('%Y%m%dT%H%M%S')
    output.mkdir(parents=True,exist_ok=True);groups={}
    for p in places:
        cell=(math.floor(p['lon']*40),math.floor(p['lat']*40));groups.setdefault(cell,[]).append(p)
    staged=pathlib.Path(tempfile.mkdtemp(prefix='matjip-data-'))
    try:
        shards=[]
        for (x,y),rows in sorted(groups.items()):
            path=f'regions/{version}/{x}-{y}.json';target=staged/path;target.parent.mkdir(parents=True,exist_ok=True)
            public_rows=[]
            for record in sorted(rows,key=lambda p:p['id']):
                public={k:v for k,v in record.items() if k!='collectedAt' and v not in (None,'',[],{})}
                if public.get('hygiene'):public['hygiene']={k:v for k,v in public['hygiene'].items() if k!='checkedAt'}
                public_rows.append(public)
            plain=json.dumps({'places':public_rows},ensure_ascii=False,separators=(',',':')).encode()
            compressed=base64.b64encode(gzip.compress(plain,compresslevel=6,mtime=0)).decode()
            payload=json.dumps({'encoding':'gzip-base64','data':compressed},separators=(',',':'));target.write_text(payload)
            shards.append({'path':path,'bounds':[x/40,y/40,(x+1)/40,(y+1)/40],'count':len(rows),'sha256':hashlib.sha256(payload.encode()).hexdigest()})
        stats.update({'generatedAt':collected,'total':len(places),'withCoordinates':len(places),'withPhotos':sum(bool(p['images']) for p in places),'withHygiene':sum(bool(p['hygiene']) for p in places),'sources':SOURCE_URLS})
        manifest={'schemaVersion':1,'version':version,'generatedAt':collected,'count':len(places),'shards':shards,'coverage':stats['coverage']}
        (staged/'status.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2));(staged/'manifest.json').write_text(json.dumps({'encoding':'gzip-base64','data':base64.b64encode(gzip.compress(json.dumps(manifest,separators=(',',':')).encode(),mtime=0)).decode()},separators=(',',':')))
        # New immutable shards first; manifest last. Failed builds never replace it.
        shutil.copytree(staged/'regions',output/'regions',dirs_exist_ok=True)
        shutil.copy2(staged/'status.json',output/'status.json')
        os.replace(staged/'manifest.json',output/'manifest.json')
        # Two complete snapshots cover requests crossing a deployment boundary.
        # Stable record payloads avoid rewriting unchanged data just for a timestamp.
        versions=sorted((output/'regions').iterdir(),key=lambda p:p.name,reverse=True)
        for old in versions[2:]:
            if old.is_dir():shutil.rmtree(old)
    finally:shutil.rmtree(staged,ignore_errors=True)
    return stats

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cache',default='.private/collection');parser.add_argument('--output',default='data');parser.add_argument('--from-cache');parser.add_argument('--credentials');parser.add_argument('--food-only',action='store_true');parser.add_argument('--sbiz-zip');parser.add_argument('--sbiz-date',default='2026-06-30')
    args=parser.parse_args();cache=pathlib.Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
    secret=json.loads(pathlib.Path(args.credentials).read_text()) if args.credentials else os.environ
    if args.food_only:
        food,total=food_rows(secret['FOODSAFETY_API_KEY'],cache);(cache/'food-sanitized.json').write_text(json.dumps(food,ensure_ascii=False));print(json.dumps({'C004':len(food),'total':total}));return
    collected=now()
    if args.from_cache:
        raw=pathlib.Path(args.from_cache);tour=[]
        for f in sorted(raw.glob('tour-compact-*.json')):tour.extend(json.loads(f.read_text()))
        for f in sorted(raw.glob('tour-500-page-*.json')):tour.extend(json.loads(f.read_text()))
        tour=list({str(r[0]):r for r in tour}.values())
        sbiz=[]
        for f in sorted(raw.glob('sbiz-*.json')):sbiz.extend(json.loads(f.read_text()))
        sbiz=list({str(r['bizesId']):r for r in sbiz}.values())
        zip_info=None
        if args.sbiz_zip:sbiz,zip_info=load_sbiz_zip(args.sbiz_zip,args.sbiz_date)
        food=json.loads((raw/'food-sanitized.json').read_text()) if (raw/'food-sanitized.json').exists() else []
        coverage={'sbiz':'selected-areas','sbizNote':'서울시청 반경 2km 초기 검증 지역. 2026-06 원천 자료. 전국 상가정보 전수 수집 전.','tour':'national-listed-restaurants','tourSourceTotal':13409,'tourCollected':len(tour),'food':'national' if food else 'pending'}
        if zip_info:coverage.update({'sbiz':'national','sbizNote':'공식 시도별 CSV 전체 수집','sbizFileSnapshot':zip_info})
        if len(tour)!=13409:raise CollectionError('Tour initial snapshot incomplete')
    else:
        key=secret.get('DATA_GO_KR_SERVICE_KEY');food_key=secret.get('FOODSAFETY_API_KEY')
        if not key or not food_key:raise CollectionError('Required collector secrets are missing')
        sbiz,sbiz_total=paged('sbiz','storeListInUpjong',{'divId':'indsLclsCd','key':'I2','type':'json'},key,cache)
        rawtour,tour_total=paged('tour','areaBasedList2',{'MobileOS':'ETC','MobileApp':'matjiphannun','_type':'json','contentTypeId':'39','arrange':'A'},key,cache)
        tour=[[r.get(k,'') for k in ['contentid','title']] + [' '.join(filter(None,[r.get('addr1'),r.get('addr2')]))] + [r.get(k,'') for k in ['mapy','mapx','firstimage','cpyrhtDivCd','modifiedtime','tel','lDongRegnCd','lDongSignguCd','lclsSystm3']] for r in rawtour]
        food,food_total=food_rows(food_key,cache)
        coverage={'sbiz':'national','sbizSourceTotal':sbiz_total,'tour':'national-listed-restaurants','tourSourceTotal':tour_total,'food':'national','foodSourceTotal':food_total}
    places,matching=combine(sbiz,tour,food,collected)
    stats={'invalidCoordinates':{'sbiz':sum(not korean_coord(r.get('lat'),r.get('lon')) for r in sbiz),'tour':sum(not korean_coord(r[3],r[4]) for r in tour)},'coverage':coverage,'sourceCounts':{'sbiz':len(sbiz),'tour':len(tour),'C004':len(food)},'matching':matching,'limitations':['현재 영업 여부·메뉴 가격·리뷰는 미확인','사진·위생정보는 확인된 해당 업소 자료만 표시','관광공사 목록은 전국의 모든 식당 목록이 아님']}
    result=publish(places,stats,pathlib.Path(args.output),collected)
    print(json.dumps({'total':result['total'],'withPhotos':result['withPhotos'],'withHygiene':result['withHygiene'],'sourceCounts':result['sourceCounts']},ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except (CollectionError,KeyError) as err:
        # Never print exception objects from URL-bearing network libraries.
        print('Collection failed: '+str(err),file=sys.stderr);sys.exit(1)
