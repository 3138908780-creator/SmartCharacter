import { readFile, writeFile, mkdir, cp, rename, rm, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { prepareRuntime, root } from './prepare-runtime.mjs';
import { listInventory } from './runtime-inventory.mjs';
import { resourceSha256 } from './verify-runtime-resources.mjs';
const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
const {lock,cache} = await prepareRuntime(target);
const buildRoot = join(root,'.runtime-cache/build', target); await mkdir(buildRoot,{recursive:true});
const stage = join(root,'.runtime-cache',`stage-${target}-${randomUUID()}`); await mkdir(stage,{recursive:true});
function run(command,args,options={}) { const r=spawnSync(command,args,{stdio:'inherit',...options});if(r.status!==0)throw new Error(`构建失败：${command} (${r.status})`); }
const tar = process.platform==='win32' ? 'tar.exe' : '/usr/bin/tar';
function extract(asset,dest,args=[]) {run(tar,['-xf',join(cache,lock.assets[asset].file),'-C',dest,...args]);}
extract('python',stage);
const notices = join(buildRoot,`python-notices-${target}`);await mkdir(notices,{recursive:true});extract('pythonNotices',notices,['python/PYTHON.json','python/licenses']);
await cp(join(notices,'python/licenses'),join(stage,'licenses/python'),{recursive:true});
await cp(join(notices,'python/PYTHON.json'),join(stage,'licenses/python/PYTHON.json'));
const components={};
const component=(name,version,source,license,licenseFiles)=>{components[name]={version,source,license,licenseFiles,redistributionApproved:true};};
const licensePaths = async dir => Object.keys(await listInventory(dir,[])).filter(n=>!n.endsWith('PYTHON.json')).map(n=>relative(stage,join(dir,n)).split('\\').join('/'));
component('python',lock.assets.python.version,lock.assets.python.url,'Python-2.0/CNRI and dependencies; included original notices',await licensePaths(join(stage,'licenses/python')));
const python = join(stage,target.startsWith('darwin')?'python/bin/python3.12':'python/python.exe');
const crossWindows = target==='win32-x64' && process.platform!=='win32';
const crossMac = target.startsWith('darwin') && target !== `${process.platform}-${process.arch}`;
for(const name of ['pillow',...(target==='win32-x64'?['numpy','opencv']:[])]) {
  const a=lock.assets[name];
  if(crossWindows || crossMac) {
    const dest=join(stage,crossMac?'python/lib/python3.12/site-packages':'python/Lib/site-packages');await mkdir(dest,{recursive:true});
    run('/usr/bin/tar',['-xf',join(cache,a.file),'-C',dest]);
  } else run(python,['-I','-B','-m','pip','install','--no-index','--no-deps','--no-compile','--no-cache-dir','--disable-pip-version-check',join(cache,a.file)],{env:{...process.env,PYTHONPYCACHEPREFIX:join(root,'.runtime-cache/pycache')}});
  const all=await listInventory(stage,[]);const paths=Object.keys(all).filter(p=>p.includes('.dist-info/')&&/(license|copying)/i.test(p)&&p.toLowerCase().includes(name==='opencv'?'opencv_python_headless':name));
  if(!paths.length)throw new Error(`wheel 许可缺失：${name}`);
  component(name,a.version,a.url,a.license,paths);
  const direct = paths[0].split('.dist-info/')[0] + '.dist-info/direct_url.json';
  try {
    await readFile(join(stage,direct));
    const text = JSON.stringify({url:a.url,archive_info:{hashes:{sha256:a.sha256}}})+'\n';
    await writeFile(join(stage,direct),text);
    const record = direct.replace('direct_url.json','RECORD'), line = direct.split('/').slice(-2).join('/');
    const sha = createHash('sha256').update(text).digest('base64url');
    const old = await readFile(join(stage,record),'utf8');
    await writeFile(join(stage,record),old.split('\n').map(row=>row.startsWith(line+',')?`${line},sha256=${sha},${Buffer.byteLength(text)}`:row).join('\n'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

}
if (target === 'win32-x64') {
  // SC uses cv2 only for still-frame YuNet detection; its optional video FFmpeg plugin is unused.
  const plugin = 'python/Lib/site-packages/cv2/opencv_videoio_ffmpeg4130_64.dll';
  await rm(join(stage,plugin),{force:true});
  const record = join(stage,'python/Lib/site-packages/opencv_python_headless-4.13.0.92.dist-info/RECORD');
  const rows = await readFile(record,'utf8');
  await writeFile(record,rows.split('\n').filter(row=>!row.startsWith('cv2/opencv_videoio_ffmpeg4130_64.dll,')).join('\n'));
}
await mkdir(join(stage,'models'),{recursive:true}); await mkdir(join(stage,'licenses/whisper'),{recursive:true});
await cp(join(cache,lock.assets.whisperModel.file),join(stage,'models/ggml-base-q5_1.bin'));
await cp(join(cache,lock.assets.whisperModelLicense.file),join(stage,'licenses/whisper/model-MIT.txt'));
component('whisperModel',lock.assets.whisperModel.version,lock.assets.whisperModel.url,'MIT',['licenses/whisper/model-MIT.txt']);
await mkdir(join(stage,'sources'),{recursive:true});
for(const name of ['ffmpegSource','whisperSource'])await cp(join(cache,lock.assets[name].file),join(stage,'sources',lock.assets[name].file));
extract('ffmpegSource',buildRoot);extract('whisperSource',buildRoot);
const ffmpegSource=join(buildRoot,'ffmpeg-9.0.2'),whisperSource=join(buildRoot,'whisper.cpp-1.9.5');
await mkdir(join(stage,'licenses/ffmpeg'),{recursive:true});
await cp(join(ffmpegSource,'COPYING.LGPLv2.1'),join(stage,'licenses/ffmpeg/LGPL-2.1.txt'));
await cp(join(ffmpegSource,'LICENSE.md'),join(stage,'licenses/ffmpeg/LICENSE.md'));
await cp(join(whisperSource,'LICENSE'),join(stage,'licenses/whisper/whisper-cpp-MIT.txt'));
const resources={},missing=[];
async function resource(name,path,componentName,executable=true){const s=components[componentName];resources[name]={relative:path,version:s.version,license:s.license,redistributionApproved:true,sha256:await resourceSha256(join(stage,path)),executable};}
await resource('python',relative(stage,python).split('\\').join('/'),'python');await resource('whisperModel','models/ggml-base-q5_1.bin','whisperModel',false);
if(target.startsWith('darwin')) {
  if(process.platform!=='darwin')throw new Error('Mac 组件构建需要 macOS 工具链');
  const cpu = target === 'darwin-arm64' ? 'arm64' : 'x86_64';
  const ffmpegArgs=['--disable-autodetect','--disable-shared','--enable-static','--disable-doc','--disable-debug','--disable-ffplay','--disable-gpl','--disable-nonfree','--disable-version3','--extra-cflags=-mmacosx-version-min=14.0','--extra-ldflags=-mmacosx-version-min=14.0'];
  if (target === 'darwin-x64') ffmpegArgs.push('--enable-cross-compile','--target-os=darwin','--arch=x86_64','--disable-x86asm','--cc=clang','--extra-cflags=-arch x86_64 -mmacosx-version-min=14.0','--extra-ldflags=-arch x86_64 -mmacosx-version-min=14.0');
  run(join(ffmpegSource,'configure'),ffmpegArgs,{cwd:ffmpegSource});run('/usr/bin/make',['-j4'],{cwd:ffmpegSource});
  const toolsRoot=join(root,'.runtime-cache',`tools-${randomUUID()}`);await mkdir(toolsRoot,{recursive:true});extract('cmake',toolsRoot);const cmake=join(toolsRoot,'cmake-4.4.4-macos-universal/CMake.app/Contents/bin/cmake');
  const cppInclude='/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1';
  const whisperArgs=['-S',whisperSource,'-B',join(whisperSource,'build-sc'),'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DGGML_METAL=OFF','-DGGML_BLAS=OFF','-DGGML_OPENMP=OFF','-DGGML_NATIVE=OFF','-DGGML_AVX=OFF','-DGGML_AVX2=OFF','-DGGML_FMA=OFF','-DGGML_F16C=OFF','-DGGML_AVX512=OFF','-DWHISPER_BUILD_TESTS=OFF','-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0',`-DCMAKE_OSX_ARCHITECTURES=${cpu}`,`-DCMAKE_CXX_FLAGS=-isystem${cppInclude} -ffile-prefix-map=${root}=SC-source -fdebug-prefix-map=${root}=SC-source`, `-DCMAKE_C_FLAGS=-ffile-prefix-map=${root}=SC-source -fdebug-prefix-map=${root}=SC-source`];
  run(cmake,whisperArgs);run(cmake,['--build',join(whisperSource,'build-sc'),'--target','whisper-cli','-j4']);
  const face=join(root,`.runtime-cache/vision/${target}/bin/sc-face-detector`);run(process.execPath,[join(root,'scripts/build-face-detector.mjs'),face,target],{env:{...process.env,SC_SWIFTC_PATH:'/usr/bin/swiftc'}});
  await mkdir(join(stage,'bin'),{recursive:true});
  for(const n of ['ffmpeg','ffprobe'])await cp(join(ffmpegSource,n),join(stage,'bin',n));
  await cp(join(whisperSource,'build-sc/bin/whisper-cli'),join(stage,'bin/whisper-cli'));await cp(face,join(stage,'bin/sc-face-detector'));
  await cp(join(root,'LICENSE'),join(stage,'licenses/SC-local-candidate.txt'));
  component('ffmpeg','9.0.2',lock.assets.ffmpegSource.url,'LGPL-2.1-or-later (GPL/nonfree/version3 disabled)',['licenses/ffmpeg/LGPL-2.1.txt','licenses/ffmpeg/LICENSE.md']);
  component('whisper','1.9.5',lock.assets.whisperSource.url,'MIT',['licenses/whisper/whisper-cpp-MIT.txt']);
  component('faceDetector','d1f3073 packaging adapter','SC project scripts/detect_faces.swift','SC public source license 1.0',['licenses/SC-local-candidate.txt']);
  for(const n of ['ffmpeg','ffprobe'])await resource(n,'bin/'+n,'ffmpeg');await resource('whisper','bin/whisper-cli','whisper');await resource('faceDetector','bin/sc-face-detector','faceDetector');
  await writeFile(join(stage,'sources/build-commands.json'),JSON.stringify({ffmpegArgs,whisperArgs:whisperArgs.map(s=>s.replaceAll(root,'<SOURCE_ROOT>')),vision:['swiftc','-target',`${cpu}-apple-macos14.0`],note:'FFmpeg source included; binaries can be replaced by compatible LGPL builds. No codesign or notarization step.'},null,2));
} else {
  await cp(join(cache,lock.assets.yunetModel.file),join(stage,'models/face_detection_yunet_2023mar.onnx'));await mkdir(join(stage,'licenses/yunet'),{recursive:true});await cp(join(cache,lock.assets.yunetLicense.file),join(stage,'licenses/yunet/MIT.txt'));
  component('yunetModel','2023mar',lock.assets.yunetModel.url,'MIT',['licenses/yunet/MIT.txt']);await resource('yunetModel','models/face_detection_yunet_2023mar.onnx','yunetModel',false);
  const native = join(root,'.runtime-cache/windows-ffmpeg');
  if (!lock.localBuilds?.ffmpeg?.files) missing.push('Windows FFmpeg fixed build and notices are not prepared.');
  else {
    await mkdir(join(stage,'bin'),{recursive:true});
    for (const [file,hash] of Object.entries(lock.localBuilds.ffmpeg.files)) {
      if (!['ffmpeg.exe','ffprobe.exe'].includes(file) || await resourceSha256(join(native,file)) !== hash) throw new Error(`Windows FFmpeg build checksum failed: ${file}`);
      await cp(join(native,file),join(stage,'bin',file));
    }
    await cp(join(native,'licenses'),join(stage,'licenses/ffmpeg-toolchain'),{recursive:true});
    await cp(join(native,'sources'),join(stage,'sources/ffmpeg-toolchain'),{recursive:true});
    component('ffmpeg','9.0.2',lock.assets.ffmpegSource.url,'LGPL-2.1-or-later; GPL/nonfree/version3 disabled', ['licenses/ffmpeg/LGPL-2.1.txt','licenses/ffmpeg/LICENSE.md']);
    component('ffmpegToolchain','Zig 0.15.2 bundled MinGW/compiler runtime',lock.localBuilds.ffmpeg.toolchainSource,'Included original notices',await licensePaths(join(stage,'licenses/ffmpeg-toolchain')));
    for (const name of ['ffmpeg','ffprobe']) await resource(name,'bin/'+name+'.exe','ffmpeg');
  }
  const expectedWhisper = lock.localBuilds?.whisper?.files?.['whisper-cli.exe'];
  if (!expectedWhisper) missing.push('Windows static CPU Whisper is not prepared.');
  else {
    if (await resourceSha256(join(native,'whisper-cli.exe')) !== expectedWhisper) throw new Error('Windows Whisper build checksum failed');
    await cp(join(native,'whisper-cli.exe'),join(stage,'bin/whisper-cli.exe'));
    component('whisper','1.9.5 / d1be6fd / static CPU',lock.assets.whisperSource.url,'MIT',['licenses/whisper/whisper-cpp-MIT.txt']);
    await resource('whisper','bin/whisper-cli.exe','whisper');
  }
  await cp(join(root,'licenses/runtime/win32-x64/microsoft'),join(stage,'licenses/microsoft'),{recursive:true});
  component('microsoftRuntime','DLLs bundled in fixed Python/NumPy distributions','Python-build-standalone and NumPy Windows wheel as pinned','Microsoft Visual C++ 2015-2022 Runtime terms',['licenses/microsoft/VC-Runtime-2015-2022-License.txt']);


}
const files=await listInventory(stage,['inventory.json'],target);const inventory={schemaVersion:1,target,complete:missing.length===0,minimumOS:lock.minimumOS,components,resources,missing,files};
await writeFile(join(stage,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
const final=join(root,'runtime',target);await mkdir(join(root,'runtime'),{recursive:true});
try{await rename(final,join(root,'.runtime-cache',`previous-runtime-${target}-${Date.now()}`));}catch(e){if(e.code!=='ENOENT')throw e;}
await rename(stage,final);
if (inventory.complete) { const lockPath = join(root,'resources/local-runtime-lock.json'); const hashes = JSON.parse(await readFile(lockPath,'utf8')); hashes[target] = await resourceSha256(join(final,'inventory.json')); await writeFile(lockPath,JSON.stringify(hashes,null,2)+'\n'); }
console.log(JSON.stringify({target,complete:inventory.complete,files:Object.keys(files).length,path:final,missing}));
