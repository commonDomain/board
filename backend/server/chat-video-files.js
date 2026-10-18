import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import binaries from 'ffmpeg-ffprobe-static';
import { DATA_DIR } from './config.js';
import { HSTS_HEADER } from './http-security.js';
import { VIDEO_FORMATS,videoError } from './chat-video-model.js';

export const VIDEO_DIR=path.join(DATA_DIR,'chat-videos');
export function videoPath(id,variant,extension) {
  if(!/^[a-f0-9]{32}$/.test(id) || !['original','preview','thumb'].includes(variant) || !Object.hasOwn(VIDEO_FORMATS,extension))throw videoError(400,'视频文件标识无效');
  return path.join(VIDEO_DIR,`${id}.${variant}.${variant==='original' ? extension : variant==='preview' ? 'mp4' : 'jpg'}`);
}

function run(binary,args,timeout=300000,signal) {
  return new Promise((resolve,reject)=>{
    const process=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';
    const abort=()=>process.kill('SIGKILL');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(abort,timeout);timer.unref?.();
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    process.stdout.on('data',chunk=>{if(output.length<1024*1024)output+=chunk;});
    process.stderr.on('data',chunk=>{error=(error+chunk).slice(-4096);});
    process.once('error',()=>{cleanup();reject(videoError(503,'视频处理服务不可用，请检查 FFmpeg 配置'));});
    process.once('close',code=>{cleanup();if(code===0)resolve(output);else reject(videoError(422,signal?.aborted ? '视频处理已取消' : '视频无法处理，请检查文件是否完整或改用 MP4 格式'));});
  });
}

export async function processChatVideo(row,signal,ensureCapacity=async()=>{}) {
  const original=videoPath(row.id,'original',row.extension);
  // No network protocols, playlists or shell interpolation for untrusted media.
  const input=['-protocol_whitelist','file','-format_whitelist','mov,matroska,webm','-i',original];
  const data=JSON.parse(await run(process.env.FFPROBE_PATH || binaries.ffprobePath,['-v','error',...input,'-show_streams','-show_format','-of','json'],30000,signal));
  const stream=data.streams?.find(stream=>stream.codec_type==='video' && !stream.disposition?.attached_pic);
  const duration=Number(data.format?.duration),width=Number(stream?.width),height=Number(stream?.height);
  if(!stream || !Number.isFinite(duration) || duration<=0 || duration>4*3600 || width<2 || height<2 || width>8192 || height>8192 || width*height>34_000_000)throw videoError(422,'视频须包含可播放画面，时长不超过 4 小时，分辨率不超过 8K');
  await ensureCapacity(Math.min(512*1024**2,Math.ceil(duration*2200000/8)+1024**2));
  const handle=await fsp.open(original,'r');const head=Buffer.alloc(16);try{await handle.read(head,0,16,0);}finally{await handle.close();}
  if(row.extension==='webm' ? head.readUInt32BE(0)!==0x1a45dfa3 : head.toString('ascii',4,8)!=='ftyp')throw videoError(415,'视频实际格式与扩展名不符');
  const base=['-nostdin','-y','-v','error','-threads','2',...input,'-map','0:v:0','-map_metadata','-1'];
  const scale="scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
  await run(process.env.FFMPEG_PATH || binaries.ffmpegPath,[...base,'-map','0:a:0?','-vf',scale,'-r','30','-c:v','libx264','-threads','2','-preset','veryfast','-crf','28','-maxrate','2000k','-bufsize','4000k','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart','-fs',String(512*1024**2),videoPath(row.id,'preview',row.extension)],300000,signal);
  await run(process.env.FFMPEG_PATH || binaries.ffmpegPath,['-nostdin','-y','-v','error','-threads','2','-i',videoPath(row.id,'preview',row.extension),'-frames:v','1','-vf','scale=320:320:force_original_aspect_ratio=decrease','-q:v','4',videoPath(row.id,'thumb',row.extension)],30000,signal);
  const preview=JSON.parse(await run(process.env.FFPROBE_PATH || binaries.ffprobePath,['-v','error','-i',videoPath(row.id,'preview',row.extension),'-show_format','-show_streams','-of','json'],30000,signal));
  if(Number(preview.format.duration)<duration-1)throw videoError(422,'视频预览超过处理容量，请缩短视频后重试');
  const rotation=Math.abs(Number(stream.side_data_list?.find(side=>side.rotation!==undefined)?.rotation) || 0)%180;
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(original))hash.update(chunk);
  return {width:rotation===90 ? height : width,height:rotation===90 ? width : height,duration,sha256:hash.digest('hex')};
}

export async function removeVideoFiles(row) {
  for(const variant of ['original','preview','thumb'])await fsp.rm(videoPath(row.id,variant,row.extension),{force:true});
}

export async function streamVideo(req,res,row,variant,ticket,onFinish,authorize) {
  const file=videoPath(row.id,variant,row.extension);let stat;
  try{stat=await fsp.stat(file);}catch{throw videoError(404,'视频文件已不可用');}
  authorize?.();
  const mime=variant==='original' ? VIDEO_FORMATS[row.extension] : variant==='preview' ? 'video/mp4' : 'image/jpeg';
  const etag=`"${row.sha256 || row.id}-${variant}"`;
  const headers={'content-type':mime,'cache-control':variant==='original' ? 'private, no-store' : 'private, no-cache, no-transform','x-content-type-options':'nosniff','accept-ranges':'bytes','vary':'Cookie','content-length':stat.size,etag,...HSTS_HEADER};
  // Authorization and deletion checks happen before consulting browser validators.
  if(variant!=='original' && !req.headers.range && req.headers['if-none-match']===etag){delete headers['content-length'];res.writeHead(304,headers);res.end();return;}
  if(ticket)headers['content-disposition']=`attachment; filename="video.${row.extension}"; filename*=UTF-8''${encodeURIComponent(row.name)}`;
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){
    const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!range || !range[1] && !range[2]){res.writeHead(416,{'content-range':`bytes */${stat.size}`,...headers,'content-length':0});res.end();return;}
    if(range[1]){start=Number(range[1]);end=range[2] ? Number(range[2]) : end;}else{start=Math.max(0,stat.size-Number(range[2]));}
    end=Math.min(end,stat.size-1);
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=stat.size){res.writeHead(416,{'content-range':`bytes */${stat.size}`,...headers,'content-length':0});res.end();return;}
    status=206;headers['content-range']=`bytes ${start}-${end}/${stat.size}`;headers['content-length']=end-start+1;
  }
  // A completed full response is required before deletion; Range/HEAD never authorize it.
  if(ticket && status===200 && req.method==='GET')res.once('finish',onFinish);
  res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}
  try{await pipeline(fs.createReadStream(file,{start,end}),res);}catch(error){if(error.code!=='ERR_STREAM_PREMATURE_CLOSE')res.destroy();}
}
