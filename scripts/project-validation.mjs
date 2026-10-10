import {spawn} from 'node:child_process';
import {parseSavedProject,validateProProject} from '../lib/pro-project.ts';
import {assertCardAspect,displayVideoSize} from '../lib/card-aspect.ts';
export async function probeDisplayVideo(video,{signal}={}) {
 const raw=await new Promise((resolve,reject)=>{const child=spawn(process.env.SC_FFPROBE_PATH || (process.env.SC_RUNTIME_VERIFIED ? (()=>{throw new Error('缺少已校验的 FFprobe 组件路径')})() : 'ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=width,height:stream_tags=rotate:stream_side_data=rotation','-of','json',video],{signal,timeout:10000,windowsHide:true});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',c=>c===0?resolve(out):reject(new Error(err||'视频尺寸读取失败')));});
 const stream=JSON.parse(raw).streams?.[0];if(!stream)throw new Error('视频缺少有效尺寸');
 const rotation=Number(stream.side_data_list?.find(d=>d.rotation!==undefined)?.rotation??stream.tags?.rotate??0);
 return displayVideoSize(Number(stream.width),Number(stream.height),rotation);
}
export async function validateExportProject(project,video,options={}){
 parseSavedProject(JSON.stringify({...project,version:project.version??7,product:project.product??'SC Basic'}));validateProProject(project);
 const size=await probeDisplayVideo(video,options);assertCardAspect(size.width,size.height);
}
