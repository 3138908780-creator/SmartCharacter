// Maintainer-only private cross build. Ordinary installation uses the assembled bundle.
import {readFile,writeFile,mkdir,cp,readdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root,prepareRuntime} from './prepare-runtime.mjs';
import {resourceSha256} from './verify-runtime-resources.mjs';
import {inspectNative} from './inspect-native.mjs';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('本维护者交叉构建路径需要 Apple Silicon macOS；普通用户使用已装配 Windows 候选。');
const recordExisting = process.argv.includes('--record-existing');
const cache=join(root,'.runtime-cache'),tools=join(cache,'tools'),downloads=join(cache,'downloads');await mkdir(tools,{recursive:true});await mkdir(downloads,{recursive:true});
const toolLock=JSON.parse(await readFile(join(root,'resources/windows-build-lock.json'),'utf8'));
function run(c,a,o={}){const r=spawnSync(c,a,{stdio:'inherit',...o});if(r.status!==0)throw new Error(`Windows 构建失败：${c}`);}
for(const a of Object.values(toolLock.tools)) {
 const file=join(downloads,a.file);try{await readFile(file);}catch {const partial=file+'.partial';run('/usr/bin/curl',['--fail','--location','--retry','2',a.url,'--output',partial]);if(await resourceSha256(partial)!==a.sha256)throw new Error('工具下载校验失败');await cp(partial,file);}
 if(await resourceSha256(file)!==a.sha256)throw new Error('工具缓存校验失败');run('/usr/bin/tar',['-xf',file,'-C',tools]);
}
const zig=join(tools,'zig-aarch64-macos-0.15.2/zig'),cmake=join(tools,'cmake-4.4.4-macos-universal/CMake.app/Contents/bin/cmake');
for(const [name,args] of Object.entries({'sc-zig-cc':'cc -target x86_64-windows-gnu','sc-zig-cxx':'c++ -target x86_64-windows-gnu','sc-zig-ar':'ar','sc-zig-ranlib':'ar s'})) {
 const flags=name.endsWith('cc')||name.endsWith('cxx')?` -ffile-prefix-map="${root}=SC-source" -fdebug-prefix-map="${root}=SC-source"`:'';
 const path=join(tools,name);await writeFile(path,`#!/bin/sh\nexec "${zig}" ${args}${flags} "$@"\n`);await chmod(path,0o755);
}
const {lock}=await prepareRuntime('win32-x64',{keys:['ffmpegSource','whisperSource']});
const build=join(cache,'build/win32-x64');await mkdir(build,{recursive:true});for(const name of ['ffmpegSource','whisperSource'])run('/usr/bin/tar',['-xf',join(downloads,lock.assets[name].file),'-C',build]);
const env={...process.env,PATH:tools+':'+process.env.PATH,ZIG_GLOBAL_CACHE_DIR:join(cache,'zig-global'),ZIG_LOCAL_CACHE_DIR:join(cache,'zig-local')};
const ffmpeg=join(build,'ffmpeg-9.0.2'),ffmpegArgs=['--disable-autodetect','--disable-shared','--enable-static','--disable-doc','--enable-debug=0','--disable-stripping','--disable-ffplay','--disable-gpl','--disable-nonfree','--disable-version3','--disable-x86asm','--enable-cross-compile','--target-os=mingw32','--arch=x86_64','--cc=sc-zig-cc','--cxx=sc-zig-cxx','--ar=sc-zig-ar'];
if (!recordExisting) {run(join(ffmpeg,'configure'),ffmpegArgs,{cwd:ffmpeg,env});run('/usr/bin/make',['-j4'],{cwd:ffmpeg,env});}
const whisperSource=join(build,'whisper.cpp-1.9.5'),whisperBuild=join(cache,recordExisting?'whisper-public-win32-x64-final':'whisper-native-win32-x64');
const whisperArgs=['-S',whisperSource,'-B',whisperBuild,'-DCMAKE_SYSTEM_NAME=Windows','-DCMAKE_SYSTEM_PROCESSOR=AMD64',`-DCMAKE_C_COMPILER=${join(tools,'sc-zig-cc')}`,`-DCMAKE_CXX_COMPILER=${join(tools,'sc-zig-cxx')}`,`-DCMAKE_AR:FILEPATH=${join(tools,'sc-zig-ar')}`,`-DCMAKE_RANLIB:FILEPATH=${join(tools,'sc-zig-ranlib')}`,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DGGML_METAL=OFF','-DGGML_BLAS=OFF','-DGGML_OPENMP=OFF','-DGGML_NATIVE=OFF','-DGGML_AVX=OFF','-DGGML_AVX2=OFF','-DGGML_FMA=OFF','-DGGML_F16C=OFF','-DGGML_AVX512=OFF','-DWHISPER_BUILD_TESTS=OFF'];
if (!recordExisting) {run(cmake,whisperArgs,{env});run(cmake,['--build',whisperBuild,'--target','whisper-cli','-j4'],{env});}
const dest=join(cache,'windows-ffmpeg');await mkdir(join(dest,'licenses'),{recursive:true});await mkdir(join(dest,'sources'),{recursive:true});
const files={};for(const [name,path] of [['ffmpeg.exe',join(ffmpeg,'ffmpeg.exe')],['ffprobe.exe',join(ffmpeg,'ffprobe.exe')],['whisper-cli.exe',join(whisperBuild,'bin/whisper-cli.exe')]]){const info=await inspectNative(path);if(info.format!=='PE'||info.arch!=='x64')throw new Error('构建目标架构错误');await cp(path,join(dest,name));files[name]=await resourceSha256(path);}
for(const [path,name] of [['LICENSE','Zig-MIT.txt'],['lib/libc/mingw/COPYING','MinGW-COPYING.txt'],['lib/libcxx/LICENSE.TXT','LLVM-libcxx-LICENSE.txt'],['lib/libcxxabi/LICENSE.TXT','LLVM-libcxxabi-LICENSE.txt'],['lib/libunwind/LICENSE.TXT','LLVM-libunwind-LICENSE.txt']])await cp(join(tools,'zig-aarch64-macos-0.15.2',path),join(dest,'licenses',name));
run('/usr/bin/tar',['-czf',join(dest,'sources/toolchain-lib-sources.tar.gz'),'-C',join(tools,'zig-aarch64-macos-0.15.2'),'lib','LICENSE'],{env:{...env,COPYFILE_DISABLE:'1'}});
await writeFile(join(dest,'sources/build-commands.json'),JSON.stringify({toolchain:toolLock,ffmpegArgs,whisperArgs:whisperArgs.map(s=>s.replaceAll(root,'<SOURCE_ROOT>')),prefixMapping:'-ffile-prefix-map=<SOURCE_ROOT>=SC-source; -fdebug-prefix-map=<SOURCE_ROOT>=SC-source',note:'Fixed unmodified FFmpeg/Whisper source; static CPU tools. Source headers and runtime library sources from the verified Zig distribution are included.'},null,2)+'\n');
lock.localBuilds={ffmpeg:{files:Object.fromEntries(Object.entries(files).filter(([n])=>n!=='whisper-cli.exe')),toolchainSource:toolLock.tools.zig.url},whisper:{files:{'whisper-cli.exe':files['whisper-cli.exe']},source:lock.assets.whisperSource.url}};
await writeFile(join(root,'desktop/runtime-locks/win32-x64.json'),JSON.stringify(lock,null,2)+'\n');console.log(files);
