from pathlib import Path
import shutil
root=Path(__file__).resolve().parent.parent
out=root/'dist'
if out.exists():shutil.rmtree(out)
out.mkdir()
for name in ['index.html','data-status.html','styles.css','app.js','config.js','sw.js','manifest.webmanifest','lib','assets','data']:
 p=root/name
 if p.is_dir():shutil.copytree(p,out/name)
 else:shutil.copy2(p,out/name)
print('Static runtime prepared in dist/')
