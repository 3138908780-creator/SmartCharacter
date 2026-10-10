"""Prepare notices from the exact Canvas Cargo.lock and Skia DEPS; never uses personal caches."""
import pathlib, re, json, tomllib, tarfile, hashlib, subprocess, concurrent.futures, shutil
ROOT=pathlib.Path(__file__).resolve().parent.parent
CACHE=ROOT/'.runtime-cache/downloads'; OUT=ROOT/'.runtime-cache/native-notices'; 
if OUT.exists():shutil.rmtree(OUT)
OUT.mkdir(exist_ok=True)
LOCK=json.loads((ROOT/'desktop/runtime-locks/native-notices.json').read_text())
LOCKED_HASHES={r['source']:r['sha256'] for r in LOCK['records']}
CANVAS=ROOT/'.runtime-cache/build/canvas-1.0.9'; SKIA=ROOT/'.runtime-cache/build/skia-a9c42c9fce77cd748805df0ec67ef5718800b1e9'
def download(url,name,expected=None):
 p=CACHE/name
 if not p.exists():subprocess.run(['/usr/bin/curl','-fsSL','--retry','2',url,'-o',str(p)],check=True)
 h=hashlib.sha256(p.read_bytes()).hexdigest()
 expected=expected or LOCKED_HASHES.get(url)
 if expected and h!=expected:raise RuntimeError('checksum mismatch '+name)
 return p,h
def notices(archive,dest):
 dest.mkdir(parents=True,exist_ok=True);paths=[]
 with tarfile.open(archive) as t:
  for m in t:
   if m.isfile() and re.search(r'(LICENSE|COPYING|PATENTS|NOTICE|FTL\.TXT)',m.name,re.I):
    parts=pathlib.PurePosixPath(m.name).parts
    if '..' in parts:raise RuntimeError('archive path')
    p=dest.joinpath(*parts);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(m).read());paths.append(str(p.relative_to(OUT)))
 return paths
def crate(s):
 n,v=s['name'],s['version'];url=f'https://static.crates.io/crates/{n}/{n}-{v}.crate';p,h=download(url,f'{n}-{v}.crate',s['checksum']);paths=notices(p,OUT/'rust'/f'{n}-{v}')
 with tarfile.open(p) as t:
  m=tomllib.loads(t.extractfile(f'{n}-{v}/Cargo.toml').read().decode())['package'];lic=m.get('license',m.get('license-file','unknown'))
  vcs=json.loads(t.extractfile(f'{n}-{v}/.cargo_vcs_info.json').read()) if f'{n}-{v}/.cargo_vcs_info.json' in t.getnames() else {}
 if not paths:
  repo=m.get('repository','').removesuffix('.git');sha=vcs.get('git',{}).get('sha1')
  if not repo.startswith('https://github.com/') or not sha:raise RuntimeError('license source absent: '+n)
  repo_path=repo.split('github.com/')[1];source_url=f'https://codeload.github.com/{repo_path}/tar.gz/{sha}';extra,eh=download(source_url,f'crate-license-{n}-{sha}.tar.gz');paths=notices(extra,OUT/'rust'/f'{n}-{v}')
  if not paths:raise RuntimeError('upstream license absent: '+n)
 return {'name':n,'version':v,'license':lic,'source':url,'sha256':h,'files':paths,'archive':p.name}
crates=[s for s in tomllib.loads((CANVAS/'Cargo.lock').read_text())['package'] if s.get('source','').startswith('registry+')]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:records=list(ex.map(crate,crates))
# Sources enabled by scripts/build-skia.js. Keep exact Skia DEPS revisions and original notices.
required={'brotli','expat','freetype','harfbuzz','highway','icu','libjpeg-turbo','libjxl','libpng','libwebp','libyuv','wuffs','zlib'}
deps=re.findall(r'["\']third_party/externals/([^"\']+)["\']\s*:\s*["\'](https:[^"\']+)@([a-f0-9]+)["\']',(SKIA/'DEPS').read_text())
def dep(s):
 n,u,v=s;url=u.removesuffix('.git')+f'/+archive/{v}.tar.gz';p,h=download(url,f'skia-{n}-{v}.tar.gz');paths=notices(p,OUT/'skia'/n)
 if not paths:raise RuntimeError('Skia dependency notice absent '+n)
 return {'name':'skia-'+n,'version':v,'source':url,'sha256':h,'files':paths,'archive':p.name,'license':'included upstream original license notices'}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:records+=list(ex.map(dep,[s for s in deps if s[0] in required]))
for p in SKIA.rglob('*'):
 if p.is_file() and re.search(r'(LICENSE|COPYING|PATENTS|NOTICE)',p.name,re.I):
  dest=OUT/'skia-main'/p.relative_to(SKIA);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
(OUT/'sources.json').write_text(json.dumps({'canvas':'1.0.9','skia':'a9c42c9fce77cd748805df0ec67ef5718800b1e9','records':records,'notice':'Cargo lock includes build-only crates as conservative notice superset. Skia enabled dependencies follow upstream build flags. Review native package provenance before public redistribution.'},indent=2))
print('notices prepared',len(records))
