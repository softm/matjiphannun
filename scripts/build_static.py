from pathlib import Path
import hashlib, json, re, shutil, time
root=Path(__file__).resolve().parent.parent
out=root/'dist'
if out.exists():
 for attempt in range(4):
  try:shutil.rmtree(out);break
  except OSError:
   if attempt==3:raise
   time.sleep(0.1)
out.mkdir()
for name in ['index.html','data-status.html','styles.css','app.js','config.js','sw.js','manifest.webmanifest','lib','assets','data']:
 p=root/name
 if p.is_dir():shutil.copytree(p,out/name)
 else:shutil.copy2(p,out/name)
html=(out/'index.html').read_text(encoding='utf-8')
assets=sorted(set(re.findall(r'(?:src|href)="(\./[^"#]+)',html)))
required=['./','./index.html','./manifest.webmanifest','./data-status.html']
files=[]
for item in required+assets:
 if item.startswith(('http:','https:')) or item in files:continue
 target=(out/item.split('?',1)[0].removeprefix('./'))
 if not target.exists():raise FileNotFoundError(f'HTML runtime asset missing: {item}')
 files.append(item)
digest=hashlib.sha256('\n'.join(files).encode()).hexdigest()[:12]
sw=(out/'sw.js').read_text(encoding='utf-8')
sw=re.sub(r"const CACHE='[^']+';",f"const CACHE='matjiphannun-shell-{digest}';",sw,1)
sw=re.sub(r"const FILES=\[[^;]+;",'const FILES='+json.dumps(files,ensure_ascii=False,separators=(',',':'))+';',sw,1)
(out/'sw.js').write_text(sw,encoding='utf-8')
print('Static runtime prepared in dist/')
